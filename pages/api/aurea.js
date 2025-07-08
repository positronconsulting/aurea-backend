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
        'Access-Control-Allow-Headers': 'Content-Type, x-session-id, x-institucion, x-preguntas',
      },
    });
  }

  if (req.method === 'POST') {
    try {
      const { mensaje } = await req.json();
      const sessionId = req.headers.get('x-session-id') || 'demo';
      const institucion = req.headers.get('x-institucion') || 'desconocida';
      const preguntasExtra = req.headers.get('x-preguntas') || '';

      if (!sessionHistories.has(sessionId)) {
        sessionHistories.set(sessionId, []);
      }

      const history = sessionHistories.get(sessionId);

      const messages = [
        {
          role: 'system',
          content: `Eres AUREA, un sistema de acompañamiento emocional cálido, humano y sin juicios. Acompañas usando herramientas de la Terapia Cognitivo Conductual, el enfoque neurocognitivo conductual y la psicoterapia Gestalt.

Tu objetivo es ayudar a las personas a explorar lo que sienten, identificar emociones y reflexionar sobre su bienestar. No das diagnósticos ni consejos médicos. Pero sí haces preguntas que les ayude a introspectar con herramientas de TCC.

Tu estilo es cercano, claro y compasivo. Si el usuario pide algo fuera de tu rol, indícalo con respeto.

Responde solo sobre salud emocional. Limita tu respuesta a un máximo de 1000 caracteres.

Al final de tu respuesta, escribe siempre tres guiones (---)

Después, en una nueva línea escribe "SOS" si detectas señales de crisis (suicidio, burnout, peligro, encierro, acoso, bullying o trastornos alimenticios). Si no, escribe "OK".

En la siguiente línea escribe el tema emocional principal detectado (una palabra en minúsculas, como: ansiedad, estrés, miedo, duelo, etc.). Si no hay uno claro, escribe "ninguno".`,
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
          temperature: 0.7,
          messages,
        }),
      });

      const data = await response.json();
      const rawResponse = data.choices?.[0]?.message?.content || 'Lo siento, no pude procesar tu mensaje.';

      const [respuestaLimpia, metaBloque] = rawResponse.split('---');
      const metaLíneas = (metaBloque || '').trim().split('\n');
      const indicadorSOS = metaLíneas[0]?.trim().toLowerCase();
      const tema = metaLíneas[1]?.trim().toLowerCase() || 'ninguno';
      const esSOS = indicadorSOS === 'sos';

      let respuesta = (respuestaLimpia || '').trim();

      // Añadir preguntas sugeridas si existen
      if (preguntasExtra) {
        try {
          const parsed = JSON.parse(preguntasExtra);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const preguntas = parsed.map(p => `🔹 ${p}`).join('\n');
            respuesta += `\n\n¿Te gustaría reflexionar también sobre esto?\n${preguntas}`;
          }
        } catch (_) {
          console.warn("⚠️ No se pudieron interpretar las preguntas extra.");
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

      // Estadística de tokens
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

      // Contar tema si hay
      if (tema && tema !== "ninguno") {
        await fetch("https://www.positronconsulting.com/_functions/contarTema", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ institucion, tema })
        });
      }

      // Enviar alerta SOS si aplica
      if (esSOS) {
        await fetch("https://www.positronconsulting.com/_functions/alertaSOS", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            correoUsuario: sessionId,
            institucion,
            mensajeUsuario: mensaje,
            respuestaAurea: respuesta,
            temaDetectado: tema
          })
        });
      }

      return new Response(JSON.stringify({ respuesta, tema, sos: esSOS }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': allowedOrigin,
        },
      });

    } catch (error) {
      console.error("❌ Error interno en AUREA:", error);
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
