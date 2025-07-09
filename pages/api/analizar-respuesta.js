import { OpenAI } from "openai";
import { GoogleSpreadsheet } from "google-spreadsheet";
import nodemailer from "nodemailer";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Google Sheets setup
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);
const jwt = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// Función principal
export default async function handler(req, res) {
  // Manejo CORS para cualquier método
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-id, x-institucion, x-tipo');

  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { mensaje } = req.body;
    const correo = req.headers['x-session-id'] || 'desconocido@correo.com';
    const institucion = req.headers['x-institucion'] || 'Sin institución';
    const tipoInstitucion = req.headers['x-tipo'] || 'Social';

    // Prompt
    const historial = [
      {
        role: "system",
        content: `Eres AUREA, un sistema de acompañamiento emocional cálido, humano y sin juicios. Acompañas usando herramientas de la Terapia Cognitivo Conductual, el enfoque neurocognitivo conductual, la Psicología Humanista y la psicoterapia Gestalt.

Tu estilo es cercano, claro y compasivo, aunque no eres psicólogo ni das diagnósticos ni consejos médicos. Tu objetivo es ayudar a las personas a explorar lo que sienten, identificar emociones, reflexionar sobre su bienestar y avanzar en su proceso personal.

Solo puedes hablar sobre salud emocional. Si el usuario pide algo fuera de eso (por ejemplo, temas técnicos, diagnósticos médicos o preguntas personales), respóndele con respeto que no puedes ayudar en ese tema.

Además de acompañar con tus respuestas, analiza el mensaje del usuario usando criterios del DSM-5-TR, ICD-11, APA, NIH/NIMH, protocolos de Terapia Cognitivo Conductual y la guía WHO mhGAP.

Haz una introspección guiada y natural. Si detectas señales textuales o en contexto de crisis emocional, suicidio, burnout, peligro físico, encierro, acoso, bullying, bulimia, anorexia o trastornos alimenticios, escribe exactamente: "SOS".

Devuelve también el tema detectado, el nivel de calificación emocional, el nivel de certeza, y si es posible, una justificación. Si el mensaje no es emocional, responde con respeto que solo puedes ayudar en temas de salud emocional.`
      },
      { role: "user", content: mensaje }
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: historial,
      temperature: 0.7,
      response_format: "json"
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);

    const respuesta = parsed.respuesta || "Gracias por compartir lo que sientes.";
    const tema = parsed.tema || "Sin tema";
    const nuevaCalificacion = parsed.nuevaCalificacion || "";
    const certeza = parsed.certeza || "";
    const justificacion = parsed.justificacion || "";
    const pregunta1 = parsed.pregunta || "";
    const sos = parsed.sos === "SOS";

    // Acceso a hoja y guardado
    await jwt.authorize();
    await doc.useJwtAuth(jwt);
    await doc.loadInfo();
    const hoja = doc.sheetsByTitle["logCalificaciones"];
    await hoja.addRow({
      fecha: new Date().toISOString(),
      correo,
      nombre: "",
      institucion,
      tipoInstitucion,
      tema,
      calificacionAnterior: "",
      nuevaCalificacion,
      certeza,
      justificación: justificacion,
      pregunta1,
      pregunta2: ""
    });

    // Manejo de SOS
    if (sos) {
      const hojaSOS = doc.sheetsByTitle["HistorialSOS"];
      await hojaSOS.addRow({
        timestamp: new Date().toISOString(),
        correo,
        institucion,
        tipoInstitucion,
        mensaje,
        respuesta,
        tema,
        autorizado: "sí"
      });

      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL_SOS,
          pass: process.env.EMAIL_PASS
        }
      });

      await transporter.sendMail({
        from: `"AUREA" <${process.env.EMAIL_SOS}>`,
        to: "alfredo@positronconsulting.com",
        subject: "🚨 Alerta SOS detectada",
        text: `Mensaje: ${mensaje}\nRespuesta: ${respuesta}\nCorreo: ${correo}\nInstitución: ${institucion}\nTema: ${tema}`
      });
    }

    return res.status(200).json({ respuesta });

  } catch (error) {
    console.error("🧨 Error en analizar-respuesta:", error);
    return res.status(500).json({ error: "Error interno del servidor", detalle: error.message });
  }
}
