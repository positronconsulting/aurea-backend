// archivo: /pages/api/analizar-respuesta.js

import { GoogleSpreadsheet } from 'google-spreadsheet';
import nodemailer from 'nodemailer';

export async function OPTIONS() {
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
    const { mensaje, respuesta, tema, calificacionAnterior, nuevaCalificacion, certeza, justificación, pregunta1, pregunta2 } = await req.json();
    const correo = req.headers.get("x-session-id") || "desconocido@correo.com";
    const institucion = req.headers.get("x-institucion") || "Sin Institución";
    const tipoInstitucion = req.headers.get("x-tipo") || "Social";

    const fecha = new Date().toISOString();

    const logData = {
      fecha,
      correo,
      institucion,
      tipoInstitucion,
      tema,
      calificacionAnterior,
      nuevaCalificacion,
      certeza,
      justificación,
      pregunta1,
      pregunta2,
    };

    await fetch("https://script.google.com/macros/s/AKfycbyh1QuRv0byLuaEWxxKmPnz_qCwifTHNsGA-I9Kh_9saEAG76MJ06K2wDj_PWQqb0xkdg/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(logData),
    });

    if (respuesta.includes("SOS")) {
      // 1. Enviar correo
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL_SOS,
          pass: process.env.EMAIL_PASS,
        },
      });

      await transporter.sendMail({
        from: `"AUREA" <${process.env.EMAIL_SOS}>`,
        to: `alfredo@positronconsulting.com`,
        subject: `⚠️ Alerta SOS - ${correo}`,
        text: `Mensaje: ${mensaje}\n\nRespuesta: ${respuesta}`,
      });

      // 2. Guardar en HistorialSOS
      const doc = new GoogleSpreadsheet(process.env.SHEET_ID);
      await doc.useServiceAccountAuth({
        client_email: process.env.GS_CLIENT_EMAIL,
        private_key: process.env.GS_PRIVATE_KEY.replace(/\\n/g, "\n"),
      });
      await doc.loadInfo();

      const hojaHistorial = doc.sheetsByTitle["HistorialSOS"];
      await hojaHistorial.addRow({
        Timestamp: fecha,
        Institución: institucion,
        Correo: correo,
        Respuesta: respuesta,
        Tema: tema,
        Autorizado: "No",
      });

      // 3. Registrar tema en TemasInstitución
      const hojaTemas = doc.sheetsByTitle["TemasInstitución"];
      await hojaTemas.loadHeaderRow();
      const filas = await hojaTemas.getRows();

      const filaExistente = filas.find(row => row.Institución === institucion && row.Tema === tema);
      if (filaExistente) {
        filaExistente.Menciones = parseInt(filaExistente.Menciones) + 1;
        await filaExistente.save();
      } else {
        await hojaTemas.addRow({ Institución: institucion, Tema: tema, Menciones: 1 });
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
    });

  } catch (err) {
    console.error("🧨 Error en analizar-respuesta:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
    });
  }
}


