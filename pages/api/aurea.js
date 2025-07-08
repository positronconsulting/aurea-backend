// pages/api/aurea.js

import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { mensaje } = req.body;
    const nombre = req.headers["x-session-id"] || "usuario";
    const institucion = req.headers["x-institucion"] || "sin_institucion";
    const tipo = req.headers["x-tipo"] || "sin_tipo";
    const calificaciones = req.headers["x-calificaciones"] || "ansiedad 0, depresión 0, autoestima 0";

    const systemPrompt = `
Eres AUREA, un sistema de acompañamiento emocional cálido, humano y sin juicios. Acompañas usando herramientas de la Terapia Cognitivo Conductual y psicología humanista. Tu estilo es cercano, claro y compasivo, aunque no eres psicólogo ni das diagnósticos ni consejos médicos.

Tu objetivo es ayudar a las personas a explorar lo que sienten, identificar emociones, reflexionar sobre su bienestar y avanzar en su proceso personal. Usa solo temas de salud emocional.

Si el usuario pide algo fuera de tu rol, recuérdale con respeto que solo puedes acompañar emocionalmente.

Mantén continuidad con sus respuestas previas, pero sé puntual. No repitas todo. Limita tus respuestas a un máximo de 1000 caracteres.

Estás hablando con **${nombre}** y estas son sus calificaciones actuales: **${calificaciones}**.

Analiza el mensaje recibido con base en las palabras textuales y contextos y en DSM-5-TR y protocolos de Terapia Cognitivo Conductual y Psicoterapia Gestalt.

Tu tarea es:
1. Detectar cuál de los temas enviados es el más relevante con base en las palabras textuales y el contexto emocional.
2. Personalizar tu respuesta basándote en nombre, tema y sus calificaciones.
3. Hacer una pregunta de seguimiento que te ayude a profundizar en el tema, usando técnicas de TCC.

---

Después de tu respuesta, escribe exactamente lo siguiente, en este orden, sin explicaciones ni símbolos adicionales:

1. "SOS" si detectas señales o palabras literales relacionadas con: crisis emocional, suicidio, burnout, peligro físico, encierro, acoso, bullying o trastornos alimenticios. Si no detectas ninguna, escribe exactamente: "OK"
2. En la siguiente línea, escribe el tema emocional principal detectado (una sola palabra en minúsculas, sin puntuación al final).
3. En una o varias líneas siguientes, vas a asignar, siempre, una calificación al o los temas que se están tratando basado en el mejor test para ese tema, como puede ser PHQ-9, GAD-7, C-SSRS, ASSIST y AUDIT, IAT, Rosenberg, PSS, PSQI, Escala de soledad de UCLA, SCL-90-R, BAI y BDI-II. Puedes decidir si es suficiente información para confirmar la calificación. En caso de que sí lo sea, escribe: tema/nuevaCalificación/OK.  
Si necesitas más información antes de confirmarla, escribe: tema/nuevaCalificación/NO y haz preguntas que te ayuden a confirmar el tema.
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: mensaje }
      ],
      temperature: 0.7
    });

    const fullResponse = completion.choices[0].message.content || "";
    const [respuesta, linea1, linea2, ...resto] = fullResponse.split("---")[0].split("\n").map(l => l.trim()).filter(Boolean);

    const sos = (linea1 === "SOS");
    const tema = linea2 || "ninguno";
    let calificacion = null;
    let confirmado = "";
    let fecha = new Date().toISOString().split("T")[0];

    for (let linea of resto) {
      if (linea.includes("/") && (linea.endsWith("/OK") || linea.endsWith("/NO"))) {
        const partes = linea.split("/");
        if (partes.length === 3) {
          calificacion = parseInt(partes[1]);
          confirmado = partes[2];
          break;
        }
      }
    }

    res.status(200).json({
      respuesta: respuesta || fullResponse,
      tema,
      sos,
      calificacion,
      confirmado,
      fecha,
      raw: fullResponse
    });

  } catch (error) {
    console.error("❌ Error en API AUREA:", error);
    res.status(500).json({ error: "Error interno en el servidor", detalles: error.message });
  }
}
