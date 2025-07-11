import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req) {
  try {
    const body = await req.json();
    console.log("📥 Data recibida en Aurea del backend:", body);

    const {
      mensaje,
      historial = [],
      nombre = "",
      institucion = "",
      tema = "",
      calificacion = "",
      porcentaje = "",
      temas = [],
      calificaciones = {}
    } = body;

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

Tu respuesta completa no debe superar los 1000 caracteres.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7
    });

    const textoRespuesta = completion.choices?.[0]?.message?.content || "";
    console.log("📩 Texto crudo de OpenAI:", textoRespuesta);

    let json;
    try {
      json = JSON.parse(textoRespuesta);
    } catch (parseError) {
      console.error("❌ Error al parsear JSON:", parseError);
      return NextResponse.json({
        ok: false,
        error: "Error al interpretar la respuesta de OpenAI"
      });
    }

    console.log("✅ JSON interpretado:", json);

    return NextResponse.json({
      ok: true,
      respuesta: json.mensajeUsuario || "🤖 Respuesta vacía.",
      ...json
    });

  } catch (error) {
    console.error("❌ Error general en AUREA:", error);
    return NextResponse.json({
      ok: false,
      error: error.message || "Error inesperado"
    });
  }
}
