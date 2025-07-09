// archivo: /pages/api/analizar-respuesta.js

import { GoogleSpreadsheet } from 'google-spreadsheet';
import nodemailer from 'nodemailer';
import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Función para enviar datos a Google Apps Script (logCalificaciones.gs)
async function registrarCalificacion(data) {
  try {
    await fetch(process.env.URL_LOG_CALIFICACIONES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch (error) {
    console.error('🧨 Error al registrar en logCalificaciones:', error.message);
  }
}

// Función para enviar correo de alerta SOS
async function enviarCorreoSOS(correoUsuario, institucion, mensaje, respuesta, consentimiento, correoSOS) {
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_POSITRON,
        pass: process.env.PASS_POSITRON,
      },
    });

    const destinatarios = [process.env.EMAIL_POSITRON];
    if (consentimiento && correoSOS) destinatarios.push(correoSOS);

    await transporter.sendMail({
      from: `"AUREA" <${process.env.EMAIL_POSITRON}>`,
      to: destinatarios,
      subject: `⚠️ Alerta SOS - ${institucion}`,
      text: `Mensaje del usuario: ${mensaje}\n\nRespuesta de AUREA: ${respuesta}`,
    });
  } catch (error) {
    console.error('❌ Error al enviar correo SOS:', error.message);
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,x-session-id,x-institucion,x-tipo,x-consentimiento,x-correo-sos",
    },
  });
}

export async function POST(req) {
  try {
    const { mensaje, nombre = "", temaAnterior = "", calificacionAnterior = "" } = await req.json();

    const correo = req.headers.get("x-session-id") || "anonimo@correo.com";
    const institucion = req.headers.get("x-institucion") || "Sin institución";
    const tipoInstitucion = req.headers.get("x-tipo") || "Social";
    const consentimiento = req.headers.get("x-consentimiento") === "true";
    const correoSOS = req.headers.get("x-correo-sos") || "";

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
      { role: "user", content: mensaje }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: historial,
      temperature: 0.7,
    });

    const raw = completion.choices[0]?.message?.content || "No tengo respuesta.";
    let respuesta = raw;

    let tema = "", nuevaCalificacion = "", certeza = "", justificacion = "";
    const calificacionRegex = /Calificación:\s*(\d+)/i;
    const certezaRegex = /Certeza:\s*(\d+%?)/i;
    const temaRegex = /Tema:\s*([^\n]+)/i;
    const justificacionRegex = /Justificación:\s*([\s\S]+?)(?:\n|$)/i;

    const cal = raw.match(calificacionRegex);
    const cer = raw.match(certezaRegex);
    const tem = raw.match(temaRegex);
    const jus = raw.match(justificacionRegex);

    if (cal) nuevaCalificacion = cal[1];
    if (cer) certeza = cer[1];
    if (tem) tema = tem[1].trim();
    if (jus) justificacion = jus[1].trim();

    if (raw.includes("SOS")) {
      await enviarCorreoSOS(correo, institucion, mensaje, respuesta, consentimiento, correoSOS);
    }

    await registrarCalificacion({
      correo,
      nombre,
      institucion,
      tipoInstitucion,
      tema,
      calificacionAnterior,
      nuevaCalificacion,
      certeza,
      justificación: justificacion,
      pregunta1: "",
      pregunta2: ""
    });

    return new Response(JSON.stringify({
      respuesta,
      tema,
      nuevaCalificacion,
      certeza,
      justificacion
    }), {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      }
    });

  } catch (error) {
    console.error('❌ Error en analizar-respuesta:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      }
    });
  }
}
