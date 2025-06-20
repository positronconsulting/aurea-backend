export const config = {
  api: {
    bodyParser: true,
  },
};

import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const { mensaje } = req.body;

  if (!mensaje) {
    return res.status(400).json({ error: "Falta el mensaje" });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4", // Cambia a "gpt-3.5-turbo" si no tienes acceso a GPT-4
      messages: [
        {
          role: "system",
          content: `Eres AUREA, una inteligencia diseñada para acompañamiento emocional con fundamentos en Terapia Cognitivo Conductual, Neurocognitiva Conductual y Psicoterapia Gestalt. No das terapia clínica. Siempre te ajustas a la legislación mexicana y dejas claro que tu apoyo no sustituye atención psicológica profesional.`
        },
        {
          role: "user",
          content: mensaje
        }
      ]
    });

    const respuesta = completion.choices[0].message.content;
    return res.status(200).json({ respuesta });

  } catch (error) {
    console.error("Error al generar respuesta:", error);
    return res.status(500).json({ error: "Ocurrió un error al intentar generar una respuesta." });
  }
}
