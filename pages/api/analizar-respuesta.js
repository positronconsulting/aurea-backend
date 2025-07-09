export const config = {
  runtime: 'nodejs',
};

import { OpenAI } from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req) {
  const allowedOrigin = 'https://www.positronconsulting.com';

  // Manejo de CORS
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

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método no permitido' }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': allowedOrigin,
      },
    });
  }

  try {
    const body = await req.json();
    const {
      mensaje,
      historial = [],
      nombre = "",
      correo = "",
      institucion = "",
      tipoInstitucion = "Empresa",
      temas = [],
      calificaciones = {}
    } = body;

    console.log("📩 Mensaje recibido para analizar:", mensaje);
    console.log("🧠 Contexto:", { nombre, correo, institucion, tipoInstitucion });

    const prompt = `Eres un analista psicológico que evalúa mensajes de usuarios para un sistema de acompañamiento emocional. Analizas mensajes en contexto clínico, considerando antecedentes recientes, nombre del usuario y temas previamente abordados.

Tu análisis combina criterios del DSM-5-TR, CIE-11, guías de la APA y el NIH/NIMH, además de protocolos de Terapia Cognitivo-Conductual, Psicoterapia Humanista y la guía WHO mhGAP.

Usa escalas clínicas reconocidas como PHQ-9, GAD-7, C-SSRS, ASSIST, AUDIT, IAT, Rosenberg, PSS, PSQI, Escala de Soledad UCLA, SCL-90-R, BAI y BDI-II para fundamentar la calificación emocional del 1 al 100. Tu justificación debe incluir el nombre del test en que se basa.

Instrucciones:

1. Identifica el tema emocional principal del mensaje. Debe ser uno de los siguientes: ${temas.join(", ")}.
2. Asigna una calificación emocional del 1 al 100 al tema detectado.
3. Estima tu nivel de certeza en porcentaje (de 0 a 100).
4. Justifica brevemente tu respuesta con base en indicadores clínicos o patrones del lenguaje observados.
5. Si la certeza es menor al 90%, incluye una pregunta emocional conversacional (cálida, abierta, humanista) para profundizar. Esta pregunta se usará para obtener más información en un segundo mensaje.
6. Si detectas palabras literales o contexto de crisis emocional, suicidio, peligro, acoso, bullying, bulimia, anorexia o autolesiones, marca "sos" como true.
7. Si el nivel de certeza es menor a 90%, no clasifiques como SOS por falta de evidencia clínica. Solo lanza SOS si hay señales claras.

Debes responder en formato JSON exacto, sin texto adicional. Ejemplo:

{
  "tema": "ansiedad",
  "nuevaCalificacion": 78,
  "certeza": 86,
  "sos": false,
  "pregunta": "¿Sientes que estas preocupaciones te están quitando energía últimamente?",
  "justificacion": "El discurso refleja tensión, anticipación negativa y patrones cognitivos del GAD-7"
}

Nombre: ${nombre}
Historial reciente:
${historial.join('\n')}

Mensaje actual del usuario:
${mensaje}
    `.trim();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.5,
      messages: [{ role: "user", content: prompt }],
    });

    const rawResponse = completion.choices?.[0]?.message?.content?.trim();
    console.log("🧠 Respuesta bruta de OpenAI:", rawResponse);

    let parsed;
    try {
      parsed = JSON.parse(rawResponse);
    } catch (err) {
      console.error("❌ Error al parsear JSON:", err.message);
      return new Response(JSON.stringify({ error: "Error al interpretar respuesta de OpenAI", raw: rawResponse }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': allowedOrigin },
      });
    }

    const {
      tema = "sin_tema",
      nuevaCalificacion = null,
      certeza = 0,
      sos = false,
      pregunta = "",
      justificacion = ""
    } = parsed;

    console.log("✅ Resultado analizado:", { tema, nuevaCalificacion, certeza, sos, pregunta });

    return new Response(JSON.stringify({
      tema,
      nuevaCalificacion,
      certeza,
      sos,
      pregunta,
      justificacion,
      respuesta: rawResponse
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': allowedOrigin,
      },
    });

  } catch (error) {
    console.error("🔥 Error general en analizar-respuesta.js:", error.message);
    return new Response(JSON.stringify({ error: "Error interno del servidor" }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': allowedOrigin,
      },
    });
  }
}
