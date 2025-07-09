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
      const tipoInstitucion = req.headers.get('x-tipo') || 'sin_tipo';

      if (!sessionHistories.has(sessionId)) {
        sessionHistories.set(sessionId, []);
      }
      const history = sessionHistories.get(sessionId);
      const historialTexto = history.map(t => `${t.role}: ${t.content}`).join('\n');

      // 🔍 Paso 1: Analizar mensaje
      const analisis = await fetch("https://aurea-backend-two.vercel.app/api/analizar-respuesta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mensajeUsuario: mensaje,
          correo: sessionId,
          nombre: "",
          institucion,
          tipoInstitucion,
          historial: historialTexto,
          temas: [], // ← se debe completar dinámicamente desde frontend
          calificaciones: {} // ← idem
        })
      });

      const {
        respuesta: preguntaConversacional,
        tema,
        nuevaCalificacion,
        certeza,
        justificación,
        sos
      } = await analisis.json();

      let respuestaFinal = preguntaConversacional;

      // ✅ Si certeza ≥ 90%, generar respuesta de AUREA
      if (certeza >= 90 && tema && tema !== "no_emocional") {
        const messages = [
          {
            role: 'system',
            content: `Eres AUREA, un sistema de acompañamiento emocional cálido y sin juicios. Acompañas usando herramientas de la terapia cognitivo conductual, el enfoque neurocognitivo conductual y la psicoterapia Gestalt. Haces preguntas que invitan al autoanálisis. Tu estilo es cercano, claro y humano a pesar de ser sólo un acompañante, no un psicólogo certificado.

Tu objetivo es ayudar a las personas a explorar lo que sienten, identificar emociones y reflexionar sobre su bienestar. No das diagnósticos ni consejos médicos.

Responde solo sobre temas de salud emocional. Si el usuario pide algo fuera de tu rol, indícalo con respeto.

Para mantener continuidad, recuerda solo lo esencial. No repitas todo. Se puntual y limita tus respuestas a un máximo de 1000 caracteres.

Al final de tu respuesta, escribe tres guiones (---), siempre. 

Después de los guiones, IMPORTANTÍSIMO: Siempre que detectes que se muestran señales o que se usan palabras literales de crisis emocional, suicidio, burnout, peligro, peligro físico, encierro, acoso, bullying, bulimia, anoerxia o trastornos alimenticios, escribe exactamente: "SOS". Si no detectas señales de este tipo, escribe exactamente: "OK". 
En la siguiente línea, escribe el tema emocional principal detectado en una sola palabra en minúsculas (por ejemplo: suicidio, tristeza, ansiedad, culpa, miedo, duelo, enojo, estrés). Nunca pongas puntuación al final de la palabra.`
          },
          ...history,
          { role: 'user', content: mensaje }
        ];

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: "gpt-4o",
            temperature: 0.8,
            messages,
          }),
        });

        const data = await response.json();
        const raw = data.choices?.[0]?.message?.content || "";
        const [cuerpo, meta] = raw.split("---");
        const metaLíneas = (meta || "").trim().split("\n");
        const indicadorSOS = metaLíneas[0]?.trim().toLowerCase();
        const temaFinal = metaLíneas[1]?.trim().toLowerCase() || tema;

        respuestaFinal = cuerpo.trim();
        history.push({ role: "user", content: mensaje });
        history.push({ role: "assistant", content: respuestaFinal });
        if (history.length > MAX_TURNS) {
          sessionHistories.set(sessionId, history.slice(-MAX_TURNS));
        }
      }

      return new Response(JSON.stringify({
        respuesta: respuestaFinal,
        tema,
        nuevaCalificacion,
        certeza,
        justificación,
        sos
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': allowedOrigin,
        }
      });

    } catch (error) {
      console.error("💥 Error en AUREA handler:", error);
      return new Response(JSON.stringify({ error: "Error interno del servidor" }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': allowedOrigin,
        }
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Método no permitido' }), {
    status: 405,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowedOrigin,
    }
  });
}
