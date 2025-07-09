/// pages/api/analizar-respuesta.js
import { GoogleGenerativeAI } from "@google/generative-ai";

export const config = {
  runtime: "nodejs",
};

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_SHEETS_API_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end("Método no permitido");

  try {
    const {
      mensaje,
      historial = [],
      nombre = "",
      correo = "",
      institucion = "",
      tipoInstitucion = "",
      temas = [],
      calificaciones = {}
    } = req.body;

    console.log("Data recibida en Analizar del backend:", {
      mensaje,
      historial,
      nombre,
      correo,
      institucion,
      tipoInstitucion,
      temas,
      calificaciones
    });

    const prompt = `
Eres un psicólogo clínico especializado en salud mental digital. Tu tarea es identificar el tema emocional principal del siguiente mensaje del usuario y asignar una calificación emocional del 1 al 100 basada en instrumentos psicológicos como:
PHQ-9, GAD-7, C-SSRS, ASSIST, AUDIT, IAT, Rosenberg, PSS, PSQI, Escala de Soledad UCLA, SCL-90-R, BAI, BDI-II.

Debes también evaluar la certeza de tu análisis (1 a 100) y justificar brevemente tu decisión. Considera el contexto del historial de conversación y el perfil emocional previo del usuario.

Lista de temas válidos:
${temas.join(", ")}

Historial reciente:
${historial.join("\n")}

Nuevo mensaje:
${mensaje}

Perfil previo:
${JSON.stringify(calificaciones)}

Responde en el siguiente formato JSON:
{
  "tema": "(uno de los temas válidos, en minúsculas)",
  "nuevaCalificacion": (número entre 1 y 100),
  "certeza": (número entre 1 y 100),
  "justificacion": "(una oración breve y profesional)",
  "respuesta": "(mensaje cálido con reflexión, max. 1000 caracteres con una pregunta que te lleve a profundizar y mejorar la certeza del análisis.)",
  "sos": true | false
}`;

    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    console.log("Respuesta de Gemini:", text);

    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}") + 1;
    const jsonRaw = text.substring(jsonStart, jsonEnd);
    const parsed = JSON.parse(jsonRaw);

    console.log("Para log Analizar:", parsed);

    res.status(200).json(parsed);
  } catch (error) {
    console.error("❌ Error en analizar-respuesta:", error);
    res.status(500).json({ error: "Fallo en el análisis emocional" });
  }
}

