// archivo: /pages/api/analizar-respuesta.js

import { GoogleSpreadsheet } from "google-spreadsheet";
import nodemailer from "nodemailer";
import { OpenAI } from "openai";

const docId = process.env.SHEET_ID;
const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
const logCalificacionesURL = process.env.LOG_CALIFICACIONES_URL;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-session-id,x-institucion,x-tipo");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const { mensaje, nombre } = req.body;
  const correo = req.headers["x-session-id"] || "desconocido@correo.com";
  const institucion = req.headers["x-institucion"] || "Sin Institución";
  const tipoInstitucion = req.headers["x-tipo"] || "Social";

  try {
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

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: historial,
      temperature: 0.7,
    });

    const respuesta = completion.choices[0]?.message?.content || "No tengo respuesta.";

    let tema = respuesta.match(/TEMA: (.*)/i)?.[1]?.trim() || "";
    let calificacion = respuesta.match(/CALIFICACIÓN: (\d+)/i)?.[1] || "";
    let certeza = respuesta.match(/CERTEZA: (\d+)/i)?.[1] || "";
    let justificacion = respuesta.match(/JUSTIFICACIÓN: (.*)/i)?.[1]?.trim() || "";
    let pregunta1 = respuesta.match(/PREGUNTA 1: (.*)/i)?.[1]?.trim() || "";
    let pregunta2 = respuesta.match(/PREGUNTA 2: (.*)/i)?.[1]?.trim() || "";

    const esSOS = respuesta.includes("SOS");

    // Obtener calificación anterior
    let calificacionAnterior = "";
    try {
      const doc = new GoogleSpreadsheet(docId);
      await doc.useServiceAccountAuth({ client_email: clientEmail, private_key: privateKey });
      await doc.loadInfo();
      const sheet = doc.sheetsByTitle[tipoInstitucion];
      const rows = await sheet.getRows();
      const row = rows.find((r) => r.Correo === correo);
      calificacionAnterior = row ? row[tema] || "" : "";
    } catch (error) {
      console.error("Error buscando calificación previa:", error);
    }

    // Log de calificaciones
    try {
      await fetch(logCalificacionesURL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          correo,
          nombre,
          institucion,
          tipoInstitucion,
          tema,
          calificacionAnterior,
          nuevaCalificacion: calificacion,
          certeza,
          justificación,
          pregunta1,
          pregunta2,
        }),
      });
    } catch (error) {
      console.error("Error enviando al log:", error);
    }

    // Envío de correo SOS
    if (esSOS) {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.MAIL_SOS,
          pass: process.env.MAIL_SOS_PASS,
        },
      });

      await transporter.sendMail({
        from: `AUREA <${process.env.MAIL_SOS}>`,
        to: "alfredo@positronconsulting.com",
        subject: "🚨 Alerta SOS desde AUREA",
        text: `Mensaje del usuario:\n\n${mensaje}\n\nRespuesta de AUREA:\n\n${respuesta}`,
      });
    }

    return res.status(200).json({
      respuesta,
      tema,
      calificacion,
      certeza,
      justificacion,
      pregunta1,
      pregunta2,
      sos: esSOS,
    });
  } catch (error) {
    console.error("🧨 Error general en analizar-respuesta:", error);
    return res.status(500).json({ error: error.message });
  }
}


