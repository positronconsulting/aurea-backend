// pages/api/analizar-respuesta.js

import { NextResponse } from 'next/server';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import OpenAI from 'openai';
import { JWT } from 'google-auth-library';
import nodemailer from 'nodemailer';

export async function OPTIONS(req) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-session-id, x-institucion, x-tipo'
    }
  });
}

export async function POST(req) {
  try {
    const body = await req.json();

    const {
      mensaje,
      historial = [],
      nombre,
      correo,
      institucion,
      tipoInstitucion,
      temas,
      calificaciones
    } = body;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const prompt = `
Eres un analista psicológico que evalúa mensajes para un sistema de acompañamiento emocional. Usa criterios del DSM-5-TR, CIE-11, guías de la APA, NIH/NIMH, TCC y la guía WHO mhGAP. Responde con enfoque de la Terapia Cognitivo-Conductual y Psicología Humanista.

Tareas:
1. Identifica cuál de los siguientes temas está siendo tratado: ${temas.join(', ')}.
2. Asigna una calificación del 1 al 10 al tema detectado.
3. Da un porcentaje de certeza de tu respuesta (0-100).
4. Si detectas palabras literales o contexto de crisis emocional, suicidio, burnout, peligro, peligro físico, encierro, acoso, bullying, bulimia, anorexia o trastornos alimenticios, responde: SOS.
5. Sugiere UNA pregunta conversacional con enfoque humanista para profundizar el análisis y aumentar la certeza.
6. Especifica qué tipo de instrumento psicológico (ej. PHQ-9, GAD-7, etc.) utilizaste para justificar tu respuesta.

Formato de respuesta JSON:

{
  "tema": "Ansiedad",
  "nuevaCalificacion": 6,
  "certeza": 82,
  "sos": false,
  "pregunta": "¿Sientes que esta preocupación ha interferido con tu día a día?",
  "justificacion": "Basado en criterios del GAD-7 y observaciones del discurso"
}

Historial reciente:
${historial.join('\n')}

Mensaje actual:
${mensaje}
`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4
    });

    const respuesta = completion.choices[0]?.message?.content?.trim();

    let datos;
    try {
      datos = JSON.parse(respuesta);
    } catch (err) {
      return NextResponse.json({ error: 'Error al parsear la respuesta de OpenAI', raw: respuesta }, { status: 500 });
    }

    const {
      tema,
      nuevaCalificacion,
      certeza,
      sos,
      pregunta,
      justificacion
    } = datos;

    // Log en hoja logCalificaciones
    const servicioCuenta = new JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const doc = new GoogleSpreadsheet(process.env.SHEET_ID, servicioCuenta);
    await doc.loadInfo();

    const hojaLog = doc.sheetsByTitle['logCalificaciones'];
    await hojaLog.addRow({
      Fecha: new Date().toISOString(),
      Correo: correo,
      Nombre: nombre,
      Institucion: institucion,
      Tipo: tipoInstitucion,
      Tema: tema,
      CalificacionAnterior: calificaciones?.[tema] ?? '',
      NuevaCalificacion: nuevaCalificacion,
      Certeza: certeza,
      Justificacion: justificacion
    });

    if (sos === true || (typeof sos === 'string' && sos.toUpperCase() === 'SOS')) {
      const hojaSOS = doc.sheetsByTitle['HistorialSOS'];
      await hojaSOS.addRow({
        Timestamp: new Date().toISOString(),
        Institucion: institucion,
        Correo: correo,
        Mensaje: mensaje,
        Respuesta: respuesta,
        Historial: historial.join('\n'),
        Tema: tema,
        Autorizado: '' // Se llenará en sistemaAurea si da consentimiento
      });

      // Envío de correo automático a Positron
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.ALERTA_EMAIL,
          pass: process.env.ALERTA_EMAIL_PASS
        }
      });

      await transporter.sendMail({
        from: `"Alerta SOS AUREA" <${process.env.ALERTA_EMAIL}>`,
        to: 'alfredo@positronconsulting.com',
        subject: `🚨 SOS detectado: ${tema}`,
        html: `
          <p><strong>Usuario:</strong> ${nombre} (${correo})</p>
          <p><strong>Institución:</strong> ${institucion}</p>
          <p><strong>Tema detectado:</strong> ${tema}</p>
          <p><strong>Mensaje del usuario:</strong></p>
          <p>${mensaje}</p>
          <p><strong>Respuesta de AUREA:</strong></p>
          <p>${respuesta}</p>
        `
      });
    }

    return NextResponse.json({
      tema,
      nuevaCalificacion,
      certeza,
      pregunta,
      respuesta,
      sos: sos === true || sos === 'SOS'
    }, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('❌ Error en analizar-respuesta:', error);
    return NextResponse.json({ error: 'Error interno del servidor', detalle: error.message }, { status: 500 });
  }
}
