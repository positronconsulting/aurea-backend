import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export const config = {
  runtime: 'edge',
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://www.positronconsulting.com',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-session-id, x-institucion, x-tipo',
    },
  });
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { mensaje, historial } = body;

    if (!mensaje) {
      return new Response(JSON.stringify({ error: "Mensaje vacío" }), {
        status: 400,
        headers: {
          'Access-Control-Allow-Origin': 'https://www.positronconsulting.com',
          'Content-Type': 'application/json'
        }
      });
    }

    const prompt = `
Eres AUREA, un sistema de acompañamiento emocional cálido, humano y sin juicios. Acompañas usando herramientas de la Terapia Cognitivo Conductual (TCC), psicología humanista y psicoterapia Gestalt.

No eres psicólogo ni das diagnósticos ni consejos médicos. Tu tarea es:
1. Detectar si el mensaje trata sobre salud mental y si es así, identificar el tema emocional principal.
2. Evaluar el nivel emocional en una escala de 0 a 10 (donde 0 es neutral y 10 es máximo impacto).
3. Calificar el estado actual del usuario sobre ese tema con una calificación de 0 a 100.
4. Evaluar si hay señales de crisis o peligro (bullying, suicidio, encierro, acoso, burnout, trastornos alimenticios, peligro físico, etc.). Si es así, debes escribir "SOS".
5. Si no tienes suficiente información para confirmar con certeza el tema o la calificación, haz una pregunta emocional introspectiva, de forma cálida y humana, basada en TCC y Gestalt.
6. Si tienes certeza alta, responde con acompañamiento emocional breve y profundo sobre el tema.
7. Si el mensaje no habla de salud mental, responde amablemente que solo puedes acompañar en temas emocionales o psicológicos.

Usa esta estructura JSON, sin explicaciones adicionales:

{
  "respuesta": "Tu respuesta escrita aquí",
  "tema": "una sola palabra que describa el tema (ej. ansiedad, autoestima, duelo, etc.)",
  "nuevaCalificacion": 85,
  "certeza": 91,
  "sos": true/false
}

Mensaje recibido:
"${mensaje}"

Historial previo de conversación:
"""
${historial || "Sin historial previo."}
"""
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: "Responde solo con el JSON indicado. No incluyas ningún texto fuera del objeto JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    });

    const raw = completion.choices?.[0]?.message?.content?.trim();
    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return new Response(JSON.stringify({ error: "Error al interpretar la respuesta de OpenAI", raw }), {
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': 'https://www.positronconsulting.com',
          'Content-Type': 'application/json'
        }
      });
    }

    const {
      respuesta = "",
      tema = "sin_tema",
      nuevaCalificacion = null,
      certeza = 0,
      sos = false
    } = parsed;

    const confirmado = certeza >= 90 ? "OK" : "NO";

    return new Response(JSON.stringify({
      respuesta,
      tema,
      nuevaCalificacion,
      certeza,
      confirmado,
      fecha: new Date().toISOString().split("T")[0],
      sos
    }), {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://www.positronconsulting.com',
        'Content-Type': 'application/json'
      }
    });

  } catch (err) {
    console.error("❌ Error en analizar-respuesta.js:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': 'https://www.positronconsulting.com',
        'Content-Type': 'application/json'
      }
    });
  }
}
