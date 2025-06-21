import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(req, res) {
  // Habilitar CORS
res.setHeader("Access-Control-Allow-Origin", "https://positronconsulting.com");
res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Manejo del preflight (OPTIONS)
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { mensaje } = req.body;

  if (!mensaje) {
    return res.status(400).json({ error: 'Falta el mensaje' });
  }

  try {
    const respuesta = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `Eres un acompañante emocional basado en principios de Terapia Cognitivo-Conductual (TCC), Psicoterapia Gestalt y Acercamiento Neurocognitivo Conductual. No eres un terapeuta, ni brindas terapia, pero sí acompañamiento. Tu respuesta debe estar alineada con el DSM-5, respetar siempre la ley vigente en México, y nunca ofrecer diagnóstico ni intervención clínica.`
        },
        {
          role: "user",
          content: mensaje
        }
      ],
      temperature: 0.7,
      max_tokens: 300
    });

    return res.status(200).json({ respuesta: respuesta.choices[0].message.content });
  } catch (error) {
    console.error("Error al generar respuesta:", error);
    return res.status(500).json({ error: 'Ocurrió un error al intentar generar una respuesta.' });
  }
}
