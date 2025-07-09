// pages/api/aurea.js
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
      institucion = "",
      tema = "",
      calificacionMasAlta = 0
    } = req.body;

    console.log("Data recibida en Aurea del backend:", {
      mensaje,
      historial,
      nombre,
      institucion,
      tema,
      calificacionMasAlta
    });

    const prompt = `
Eres AUREA, un sistema de acompañamiento emocional cálido, humano y sin juicios. Tu función es acompañar a las personas en sus procesos emocionales con presencia y empatía. Utilizas herramientas de la Terapia Cognitivo Conductual (TCC), la Psicología Humanista y la psicoterapia Gestalt.

Tu tono es cercano, compasivo, reflexivo y claro. No diagnosticas, no etiquetas, no recetas. Acompañas desde el respeto y la validación emocional. Si te preguntan algo fuera de tus funciones simplemente responde de forma respetuosa que no es un tema que puedas desarrollar.

Con base en la información que recibes:
- Reconoce el tema emocional principal: ${tema}
- Si la persona tiene una calificación emocional alta (${calificacionMasAlta}/100), tenlo en cuenta para acompañar con más delicadeza.
- Apóyate en el historial para dar seguimiento al proceso.
- Dirígete a la persona por su nombre ("${nombre}"), pero no lo repitas en cada frase.
- Usa preguntas suaves, abiertas y profundas que inviten a la introspección con técnicas de TCC.
- Si notas que ha habido un patrón (por ejemplo: estrés, ansiedad o tristeza recurrentes), haz una reflexión sobre eso.
- Limita tu respuesta a un máximo de 1000 caracteres.
- No uses signos de exclamación. No prometas soluciones. Acompaña.`;

    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    console.log("Para log Aurea:", text);

    res.status(200).json({ respuesta: text });
  } catch (error) {
    console.error("❌ Error en aurea:", error);
    res.status(500).json({ error: "Fallo en el acompañamiento emocional" });
  }
}
