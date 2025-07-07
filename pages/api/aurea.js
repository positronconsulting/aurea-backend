// pages/api/aurea.js

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
        'Access-Control-Allow-Headers': 'Content-Type, x-session-id, x-institucion, x-tipo-institucion, x-nombre, x-calificaciones, x-tipo',
      },
    });
  }

  if (req.method === 'POST') {
    try {
      const { mensaje } = await req.json();
      const sessionId = req.headers.get('x-session-id') || 'demo';
      const institucion = req.headers.get('x-institucion') || 'desconocida';
      const tipoInstitucion = req.headers.get('x-tipo-institucion') || 'sin_tipo';
      const nombre = req.headers.get('x-nombre') || 'usuario';
      const calificaciones = req.headers.get('x-calificaciones') || '';

      if (!sessionHistories.has(sessionId)) {
        sessionHistories.set(sessionId, []);
      }
      const history = sessionHistories.get(sessionId);

      const messages = [
        {
          role: 'system',
          content: `Eres AUREA, un sistema de acompañamiento emocional cálido y sin juicios. Acompañas usando herramientas de la terapia cognitivo conductual, el enfoque neurocognitivo conductual y la psicoterapia Gestalt. Haces preguntas que invitan al autoanálisis. Tu estilo es cercano, claro y humano a pesar de ser sólo un acompañante, no un psicólogo certificado.

Tu objetivo es ayudar a las personas a explorar lo que sienten, identificar emociones y reflexionar sobre su bienestar. No das diagnósticos ni consejos médicos.

Responde solo sobre temas de salud emocional. Si el usuario pide algo fuera de tu rol, indícalo con respeto.

Para mantener continuidad, recuerda solo lo esencial. No repitas todo. Sé puntual y limita tus respuestas a un máximo de 1000 caracteres.

Estás hablando con ${nombre} y estas son sus calificaciones: ${calificaciones}. Analiza su mensaje usando el DSM-5-TR, ICD-11, APA, NIH/NIMH, protocolos de TCC y la guía WHO mhGAP.

Elige solo uno de los temas enviados en las calificaciones como tema principal del mensaje. Haz preguntas de seguimiento usando técnicas de terapia cognitivo conductual que te permitan decidir si puedes cambiar la calificación.

Al final de tu respuesta, escribe tres guiones (---)

Después de los guiones:
1. Si detectas señales o palabras literales relacionadas a crisis emocional, suicidio, burnout, peligro, peligro físico, encierro, acoso, bullying, bulimia, anorexia o trastornos alimenticios, escribe exactamente: "SOS". Si no, escribe exactamente: "OK".
2. En la siguiente línea, escribe el tema detectado en una sola palabra en minúsculas.
3. En la tercera línea, si puedes cambiar la calificación, escribe: tema/nuevaCalificación/OK. Si aún no puedes, pero lo harás con más información, escribe: tema/nuevaCalificación/NO.`
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
      const rawResponse = data.choices?.[0]?.message?.content || 'Lo siento, no pude procesar tu mensaje.';
      const [respuestaLimpia, metaBloque] = rawResponse.split('---');
      const metaLíneas = (metaBloque || '').trim().split('\n');
      const indicadorSOS = metaLíneas[0]?.trim().toLowerCase();
      const tema = metaLíneas[1]?.trim().toLowerCase() || 'ninguno';
      const calificacionRaw = metaLíneas[2]?.trim() || '';
      const esSOS = indicadorSOS === 'sos';

      const respuesta = (respuestaLimpia || '').trim();

      let calificacion = null;
      let confirmado = "";
      if (calificacionRaw.includes("/")) {
        const [temaCalif, valor, flag] = calificacionRaw.split('/');
        if (temaCalif && valor && flag) {
          calificacion = parseInt(valor.trim());
          confirmado = flag.trim();
        }
      }

      const inputTokens = data.usage?.prompt_tokens || 0;
      const outputTokens = data.usage?.completion_tokens || 0;
      const totalTokens = inputTokens + outputTokens;
      const costoUSD = ((inputTokens * 0.005) + (outputTokens * 0.015)) / 1000;

      history.push({ role: 'user', content: mensaje });
      history.push({ role: 'assistant', content: respuesta });
      if (history.length > MAX_TURNS) {
        sessionHistories.set(sessionId, history.slice(-MAX_TURNS));
      }

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

      return new Response(JSON.stringify({
        respuesta,
        tema,
        sos: esSOS,
        calificacion,
        confirmado,
        fecha: new Date().toISOString().split("T")[0]
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': allowedOrigin,
        },
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: 'Error interno del servidor' }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': allowedOrigin,
        },
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Método no permitido' }), {
    status: 405,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowedOrigin,
    },
  });
}
