
const sessionHistories = new Map();
const MAX_TURNS = 6; // 3 interacciones completas (usuario + asistente)

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

  if (req.method === 'POST') {
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
          content: `Eres AUREA, un sistema de acompañamiento emocional. Acompañas con calidez, sin juzgar, y usando herramientas de la terapia cognitivo conductual, el enfoque neurocognitivo conductual y la psicoterapia Gestalt.

Tu objetivo es ayudar a las personas a explorar lo que sienten, identificar sus emociones y reflexionar sobre su bienestar. No das diagnósticos ni consejos médicos. Si percibes señales de crisis, invita a buscar ayuda profesional inmediata.

Actúas como un acompañante, no como un experto que da respuestas. Haces preguntas que ayudan a mirar hacia adentro. Tu estilo es cercano, claro y humano.

Responde solo sobre temas de salud emocional. Si el usuario pide algo fuera de tu rol, indícale con respeto que no puedes responder a eso.

Para mantener continuidad, recuerda mentalmente solo lo esencial. No repitas todo, conserva los puntos clave. Es de suma importancia que tus respuestas no superen los 1000 caracteres.`,
        },
        ...history,
        {
          role: 'user',
          content: mensaje,
        },
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
          messages: messages,
        }),
      });

      const data = await response.json();
      const respuesta = data.choices?.[0]?.message?.content || 'Lo siento, no pude procesar tu mensaje.';

      const inputTokens = data.usage?.prompt_tokens || 0;
      const outputTokens = data.usage?.completion_tokens || 0;
      const totalTokens = inputTokens + outputTokens;
      const costoUSD = ((inputTokens * 0.005) + (outputTokens * 0.015)) / 1000;

      // Actualiza historial
      history.push({ role: 'user', content: mensaje });
      history.push({ role: 'assistant', content: respuesta });

      if (history.length > MAX_TURNS) {
        sessionHistories.set(sessionId, history.slice(-MAX_TURNS));
      }

      // Enviar a Google Apps Script
      await fetch("https://script.google.com/macros/s/AKfycbwhooKRTdqs-Mnf3oFylF_rE2kM1AMZ_a4XUOEJQmnGew80rYvP72l_wlfgsAtfL6qVSQ/exec", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
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
