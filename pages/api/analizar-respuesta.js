import { GoogleSpreadsheet } from "google-spreadsheet";
import nodemailer from "nodemailer";
import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Manejo del preflight CORS
export async function OPTIONS(req) {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,x-session-id,x-institucion,x-tipo",
    },
  });
}

export async function POST(req) {
  try {
    const { mensaje, historial = [], nombre = "", pregunta1 = "", pregunta2 = "" } = await req.json();

    const correo = req.headers.get("x-session-id") || "desconocido@correo.com";
    const institucion = req.headers.get("x-institucion") || "Sin Institución";
    const tipoInstitucion = req.headers.get("x-tipo") || "Social";
    const fecha = new Date().toISOString();

    // Construir historial de conversación
    const mensajes = [
      {
        role: "system",
        content: `Eres AUREA, un sistema de acompañamiento emocional cálido, humano y sin juicios. Acompañas usando herramientas de la Terapia Cognitivo Conductual, el enfoque neurocognitivo conductual, la Psicología Humanista y la psicoterapia Gestalt.

Tu estilo es cercano, claro y compasivo, aunque no eres psicólogo ni das diagnósticos ni consejos médicos. Tu objetivo es ayudar a las personas a explorar lo que sienten, identificar emociones, reflexionar sobre su bienestar y avanzar en su proceso personal.

Solo puedes hablar sobre salud emocional. Si el usuario pide algo fuera de eso (por ejemplo, temas técnicos, diagnósticos médicos o preguntas personales), respóndele con respeto que no puedes ayudar en ese tema.

Además de acompañar con tus respuestas, analiza el mensaje del usuario usando criterios del DSM-5-TR, ICD-11, APA, NIH/NIMH, protocolos de Terapia Cognitivo Conductual y la guía WHO mhGAP.

Haz una introspección guiada y natural. Si detectas señales textuales o en contexto de crisis emocional, suicidio, burnout, peligro físico, encierro, acoso, bullying, bulimia, anorexia o trastornos alimenticios, escribe exactamente: "SOS".

Devuelve también el tema detectado (una palabra), el nivel de calificación emocional (de 1 a 10), el nivel de certeza (porcentaje), y si es posible, una justificación. Si el mensaje no es emocional, responde con respeto que solo puedes ayudar en temas de salud emocional.`,
      },
      ...historial,
      { role: "user", content: mensaje },
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: mensajes,
      temperature: 0.7,
    });

    const respuesta = completion.choices[0]?.message?.content || "No tengo respuesta.";

    // Extraer datos de la respuesta
    const regexTema = /Tema\s*[:：]?\s*(.*)/i;
    const regexCalif = /Calificación\s*[:：]?\s*(\d+)/i;
    const regexCerteza = /Certeza\s*[:：]?\s*(\d+)%/i;
    const regexJust = /Justificación\s*[:：]?\s*(.*)/i;

    const tema = respuesta.match(regexTema)?.[1]?.trim() || "Sin tema";
    const nuevaCalificacion = respuesta.match(regexCalif)?.[1] || "";
    const certeza = respuesta.match(regexCerteza)?.[1] || "";
    const justificación = respuesta.match(regexJust)?.[1] || "";
    const esSOS = respuesta.includes("SOS");

    // Guardar en logCalificaciones
    await fetch("https://script.google.com/macros/s/AKfycbyh1QuRv0byLuaEWxxKmPnz_qCwifTHNsGA-I9Kh_9saEAG76MJ06K2wDj_PWQqb0xkdg/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        correo,
        nombre,
        institucion,
        tipoInstitucion,
        tema,
        calificacionAnterior: "", // si lo tienes disponible, pásalo desde el frontend
        nuevaCalificacion,
        certeza,
        justificación,
        pregunta1,
        pregunta2,
      }),
    });

    // Si es SOS, guarda en HistorialSOS y manda correo
    if (esSOS) {
      const doc = new GoogleSpreadsheet("1hES4WSal9RLQOX2xAyLM2PKC9WP07Oc48rP5wVjCqAE");
      await doc.useServiceAccountAuth({
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      });
      await doc.loadInfo();
      const sheet = doc.sheetsByTitle["HistorialSOS"];

      await sheet.addRow({
        Timestamp: fecha,
        Correo: correo,
        Institución: institucion,
        Tipo: tipoInstitucion,
        Tema: tema,
        Autorizado: "Sí", // por ahora forzado, se puede ajustar si se incluye autoriza
        Conversación: mensaje,
        Respuesta: respuesta,
      });

      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL_SOS,
          pass: process.env.EMAIL_PASS,
        },
      });

      await transporter.sendMail({
        from: `"AUREA Alertas" <${process.env.EMAIL_SOS}>`,
        to: ["alfredo@positronconsulting.com"],
        subject: `⚠️ Alerta SOS - ${institucion}`,
        text: `Mensaje: ${mensaje}\n\nRespuesta AUREA: ${respuesta}\n\nCorreo: ${correo}\nInstitución: ${institucion}\nTema detectado: ${tema}`,
      });
    }

    return new Response(JSON.stringify({
      respuesta,
      tema,
      nuevaCalificacion,
      certeza,
      justificación,
    }), {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
    });

  } catch (err) {
    console.error("🧨 Error en analizar-respuesta:", err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
    });
  }
}

