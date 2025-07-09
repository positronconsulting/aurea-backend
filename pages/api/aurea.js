
// archivo: /pages/api/aurea.js

import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-session-id,x-institucion,x-tipo");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-session-id,x-institucion,x-tipo");

  const { mensaje } = req.body;
  const correo = req.headers["x-session-id"] || "desconocido@correo.com";
  const institucion = req.headers["x-institucion"] || "Sin Institución";
  const tipoInstitucion = req.headers["x-tipo"] || "Social";

  const historial = [
    {
      role: "system",
      content: `Eres AUREA, un sistema de acompañamiento emocional cálido, humano y sin juicios. Acompañas usando herramientas de la Terapia Cognitivo Conductual, el enfoque neurocognitivo conductual, la Psicología Humanista y la psicoterapia Gestalt.

Tu estilo es cercano, claro y compasivo, aunque no eres psicólogo ni das diagnósticos ni consejos médicos. Tu objetivo es ayudar a las personas a explorar lo que sienten, identificar emociones, reflexionar sobre su bienestar y avanzar en su proceso personal.

Solo puedes hablar sobre salud emocional. Si el usuario pide algo fuera de eso (por ejemplo, temas técnicos, diagnósticos médicos o preguntas personales), respóndele con respeto que no puedes ayudar en ese tema.

Además de acompañar con tus respuestas, analiza el mensaje del usuario usando criterios del DSM-5-TR, ICD-11, APA, NIH/NIMH, protocolos de Terapia Cognitivo Conductual y la guía WHO mhGAP.

Haz una introspección guiada y natural. Si detectas señales textuales o en contexto de crisis emocional, suicidio, burnout, peligro físico, encierro, acoso, bullying, bulimia, anorexia o trastornos alimenticios, escribe exactamente: "SOS".

Devuelve también el tema detectado, el nivel de calificación emocional, el nivel de certeza, y si es posible, una justificación. Si el mensaje no es emocional, responde con respeto que solo puedes ayudar en temas de salud emocional.`,
    },
    { role: "user", content: mensaje },
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: historial,
      temperature: 0.7,
    });

    const respuesta = completion.choices[0]?.message?.content || "No tengo respuesta.";

    return res.status(200).json({ respuesta });
  } catch (error) {
    console.error("🧨 Error en /api/aurea:", error);
    return res.status(500).json({ error: "Error al generar la respuesta." });
  }
}
