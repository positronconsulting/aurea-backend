const sessionHistories = new Map();
const MAX_TURNS = 6;

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const allowedOrigin = 'https://www.positronconsulting.com';

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-session-id, x-institucion',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método no permitido' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': allowedOrigin },
    });
  }

  try {
    const { mensaje } = await req.json();
    const sessionId = req.headers.get('x-session-id') || 'demo';
    const institucion = req.headers.get('x-institucion') || 'desconocida';

    if (!sessionHistories.has(sessionId)) {
      sessionHistories.set(sessionId, []);
    }
    const history = sessionHistories.get(sessionId);

    const messages = [
      {
        role: 'system',
        content: `Eres AUREA, un sistema de acompañamiento emocional cálido y sin juicios. Acompañas usando herramientas de la terapia cognitivo conductual, el enfoque neurocognitivo conductual y la psicoterapia Gestalt.

Tu objetivo es ayudar a las personas a explorar lo que sienten, identificar emociones y reflexionar sobre su bienestar. No das diagnósticos ni consejos médicos.

Actúas como acompañante, no como experto. Haces preguntas que invitan al autoanálisis. Tu estilo es cercano, claro y humano.

Responde solo sobre temas de salud emocional. Si el usuario pide algo fuera de tu rol, indícalo con respeto.

IMPORTANTE: Al final de tu respuesta, después de tres guiones "---", escribe lo siguiente:

SOS: sí o no (solo si detectas señales de crisis emocional, ideación suicida, peligro físico, encierro, acoso, bullying o trastornos alimenticios graves)

TEMA: una sola palabra que describa el tema principal del mensaje del usuario (por ejemplo: ansiedad, tristeza, bullying, pareja, familia, etc.).`,
      },
      ...history,
      { role: 'user', content: mensaje },
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        temperature: 0.8,
        messages,
      }),
    });

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || 'Lo siento, no pude procesar tu mensaje.';
    const [respuestaLimpia, analisis] = raw.split('---');
    const respuesta = respuestaLimpia.trim();

    const inputTokens = data.usage?.prompt_tokens || 0;
    const outputTokens = data.usage?.completion_tokens || 0;
    const totalTokens = inputTokens + outputTokens;
    const costoUSD = ((inputTokens * 0.005) + (outputTokens * 0.015)) / 1000;

    // Extraer datos del análisis
    let esSOS = false;
    let tema = "sin_tema";
    if (analisis) {
      const sosMatch = analisis.match(/SOS:\s*(sí|si|yes)/i);
      const temaMatch = analisis.match(/TEMA:\s*(\w+)/i);
      esSOS = !!sosMatch;
      tema = temaMatch ? temaMatch[1].toLowerCase() : "sin_tema";
    }

    // Guardar en historial en memoria
    history.push({ role: 'user', content: mensaje });
    history.push({ role: 'assistant', content: respuesta });

    if (history.length > MAX_TURNS) {
      sessionHistories.set(sessionId, history.slice(-MAX_TURNS));
    }

    // Actualizar contador de temas por institución
    await fetch("https://www.positronconsulting.com/_functions-dev/contarTema", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ institucion, tema })
    });

    // Si hay SOS, enviar alerta y guardar historial
    if (esSOS) {
      const historialFormateado = history
        .slice(-MAX_TURNS)
        .map(t => `${t.role}: ${t.content}`)
        .join("\n");

      await fetch("https://www.positronconsulting.com/_functions-dev/alertaSOS", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          correoUsuario: sessionId,
          institucion,
          mensajeUsuario: mensaje,
          respuestaAurea: respuesta,
          historial: historialFormateado,
          temaDetectado: tema
        })
      });
    }

    // Registrar consumo de tokens
    await fetch("https://script.google.com/macros/s/AKfycbwhooKRTdqs-Mnf3oFylF_rE2kM1AMZ_a4XUOEJQmnGew80rYvP72l_wlfgsAtfL6qVSQ/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        institucion,
        inputTokens,
        outputTokens,
        totalTokens,
        costoUSD
      })
    });

    return new Response(JSON.stringify({ respuesta }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': allowedOrigin,
      },
    });

  } catch (error) {
    console.error("🧨 Error en AUREA:", error);
    return new Response(JSON.stringify({ error: 'Error interno del servidor' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': allowedOrigin,
      },
    });
  }
}
