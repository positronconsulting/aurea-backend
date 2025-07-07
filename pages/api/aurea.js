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
        'Access-Control-Allow-Headers': 'Content-Type, x-session-id, x-institucion, x-tipo',
      },
    });
  }

  if (req.method === 'POST') {
    try {
      const { mensaje } = await req.json();
      const sessionId = req.headers.get('x-session-id') || 'demo';
      const institucion = req.headers.get('x-institucion') || 'desconocida';
      const tipoInstitucion = req.headers.get('x-tipo') || 'Empresa';

      if (!sessionHistories.has(sessionId)) {
        sessionHistories.set(sessionId, []);
      }

      const history = sessionHistories.get(sessionId);

      const messages = [
        {
          role: 'system',
          content: `Eres AUREA, un sistema de acompañamiento emocional cálido, humano y sin juicios. Acompañas usando herramientas de la Terapia Cognitivo Conductual, el enfoque neurocognitivo conductual y la psicoterapia Gestalt. Haces preguntas que invitan al autoanálisis y la introspección. Tu estilo es cercano, claro y compasivo, aunque no eres psicólogo ni das diagnósticos ni consejos médicos.

Tu objetivo es ayudar a las personas a explorar lo que sienten, identificar emociones, reflexionar sobre su bienestar y avanzar en su proceso personal. Usa solo temas de salud emocional.

Si el usuario pide algo fuera de tu rol, recuérdale con respeto que solo puedes acompañar emocionalmente.

Mantén continuidad con sus respuestas previas, pero sé puntual. No repitas todo. Limita tus respuestas a un máximo de 1000 caracteres.

Estás hablando con **${nombre}** y estas son sus calificaciones actuales: **${calificaciones}**.

Analiza el mensaje recibido con base en:
DSM-5-TR, ICD-11, APA, NIH/NIMH, protocolos de Terapia Cognitivo Conductual y la guía WHO mhGAP.

Tu tarea es:
1. Detectar cuál de los temas enviados es el más relevante con base en las palabras textuales y el contexto emocional.
2. Personalizar tu respuesta basándote en ese tema y sus calificaciones.
3. Hacer una pregunta de seguimiento que te ayude a decidir si puedes ajustar la calificación de ese tema, usando técnicas de TCC.

---

Después de tu respuesta, escribe exactamente lo siguiente, en este orden, sin explicaciones ni símbolos adicionales:

1. `"SOS"` si detectas señales o palabras literales relacionadas con: crisis emocional, suicidio, burnout, peligro físico, encierro, acoso, bullying, bulimia, anorexia o trastornos alimenticios. Si no detectas ninguna, escribe exactamente: `"OK"`
2. En la siguiente línea, escribe el **tema emocional principal** detectado (una sola palabra en minúsculas, sin puntuación al final).
3. En una o varias líneas siguientes, si puedes cambiar la calificación, escribe: `tema/nuevaCalificación/OK`  
   Si necesitas más información antes de cambiarla, escribe: `tema/nuevaCalificación/NO`
`
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
      const esSOS = indicadorSOS === 'sos';

      const actualizaciones = metaLíneas.slice(2).map(l => {
        const [tema, nuevaCalificacion, confirmado] = l.split('/');
        return {
          tema: tema?.trim()?.toLowerCase(),
          nuevaCalificacion: parseInt(nuevaCalificacion),
          confirmado: confirmado?.trim()
        };
      }).filter(e => e.tema && e.nuevaCalificacion);

      const fecha = new Date().toISOString().split("T")[0];

      // Enviar actualizaciones a Google Sheets
      for (const act of actualizaciones) {
        await fetch("https://script.google.com/macros/s/AKfycbx5ZkBinF7aYeo2uskXiPTM8m6lHa6BRi1MslMc76m9FPiKdUkEDkbvEKh9fLVVWAMbWg/exec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            correo: sessionId,
            institucion,
            tipoInstitucion,
            tema: act.tema,
            nuevaCalificacion: act.nuevaCalificacion,
            confirmado: act.confirmado,
            fecha
          })
        });
      }

      const respuesta = (respuestaLimpia || '').trim();

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

