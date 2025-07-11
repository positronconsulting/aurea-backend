import { NextResponse } from 'next/server';
import { Configuration, OpenAIApi } from 'openai';

export const config = { runtime: 'nodejs' };

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const {
      mensaje,
      correo,
      nombre,
      institucion,
      tipoInstitucion,
      temas,
      calificaciones,
      tema,
      calificacion,
      porcentaje
    } = req.body;

    const historial = []; // En este baby step aún está vacío, luego lo conectamos.

    const prompt = `
Eres AUREA, un sistema de acompañamiento emocional cálido y sin juicios. Acompañas usando herramientas de la terapia cognitivo conductual, el enfoque neurocognitivo conductual y la psicoterapia Gestalt. Tu estilo es cercano, claro y humano a pesar de ser sólo un acompañante, no un psicólogo certificado.

Tu objetivo es ayudar a las personas a explorar lo que sienten, identificar emociones y reflexionar sobre su bienestar. No das diagnósticos ni consejos médicos.

Responde solo sobre temas de salud emocional. Si el usuario pide algo fuera de tu rol, indícalo con respeto.

${nombre} mandó este mensaje: ${mensaje}, y este es el historial de la conversación: ${JSON.stringify(historial)}. Analiza las palabras textuales y el contexto, como si fueras el mejor psicólogo del mundo, basándote en el DSM-5, protocolos de Terapia Cognitivo Conductual y relaciónalo con un tema de estos: ${temas.join(", ")}. Si no encuentras una relación directa, hazlo por análisis clínico al que más se acerque o que podría relacionarse si tuvieras más información.

Utiliza también las calificaciones anteriores: ${JSON.stringify(calificaciones)}, el tema previo: ${tema}, la calificación previa: ${calificacion} y el porcentaje de certeza previo: ${porcentaje}. Usa referencias como PHQ-9, GAD-7, C-SSRS, ASSIST, AUDIT, IAT, Rosenberg, PSS, PSQI, UCLA, SCL-90-R, BAI o BDI-II para asignar una calificación al nuevo tema que selecciones, y un porcentaje de certeza. Si tu porcentaje es mayor a 90%, ofrece un mensaje de acompañamiento. Si es menor a 90%, ofrece el mismo mensaje pero agrega una pregunta que te ayude a aumentar tu certeza en futuras respuestas.

IMPORTANTÍSIMO: Siempre que detectes señales o palabras literales de crisis emocional, suicidio, burnout, peligro, peligro físico, encierro, acoso, bullying, bulimia, anorexia, violación, ludopatía o trastornos alimenticios, escribe exactamente: "SOS". Si no detectas señales de este tipo, escribe exactamente: "OK".

Usa este formato JSON:

{
  "mensajeUsuario": "Aquí va la respuesta de AUREA",
  "temaDetectado": "tema que hayas detectado",
  "calificacion": "calificación asignada del 1 al 100",
  "porcentaje": "porcentaje de certeza del 1 al 100",
  "SOS": "SOS o OK"
}
`.trim();

    console.log("📤 PROMPT enviado a OpenAI:", prompt);

    const completion = await openai.createChatCompletion({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });

    const raw = completion.data.choices[0].message.content;
    console.log("📩 RESPUESTA raw:", raw);

    let respuestaParseada = {};
    try {
      respuestaParseada = JSON.parse(raw);
    } catch (error) {
      console.error("❌ Error al parsear JSON de la IA:", error);
      return res.status(500).json({ ok: false, error: "Error de formato en la respuesta de OpenAI" });
    }

    return res.status(200).json({ ok: true, ...respuestaParseada });

  } catch (err) {
    console.error("🔥 Error general en aurea.js:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}


