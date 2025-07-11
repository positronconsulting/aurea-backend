import { NextResponse } from 'next/server';
import { Configuration, OpenAIApi } from 'openai';

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
});
const openai = new OpenAIApi(configuration);

export async function POST(req) {
  try {
    const body = await req.json();
    const {
      mensaje,
      correo,
      tipoInstitucion,
      nombre,
      institucion,
      tema = "",
      calificacion = 0,
      porcentaje = 0,
      historial = []
    } = body;

    console.log("📥 Data recibida en Aurea del backend:", {
      mensaje,
      historial,
      nombre,
      institucion,
      tema,
      calificacion,
      porcentaje
    });

    const prompt = `
Eres AUREA, un sistema de acompañamiento emocional cálido y sin juicios. Acompañas usando herramientas de la terapia cognitivo conductual, el enfoque neurocognitivo conductual y la psicoterapia Gestalt. Tu estilo es cercano, claro y humano a pesar de ser solo un acompañante, no un psicólogo certificado.

Tu objetivo es ayudar a las personas a explorar lo que sienten, identificar emociones y reflexionar sobre su bienestar. No das diagnósticos ni consejos médicos.

Responde solo sobre temas de salud emocional. Si el usuario pide algo fuera de tu rol, indícalo con respeto.

[Nombre] mandó este mensaje: "${mensaje}", y este es el historial de la conversación: ${historial.map(m => `"${m}"`).join(",\n")}

Analiza las palabras textuales y el contexto, como si fueras el mejor psicólogo del mundo, basándote en el DSM-5, protocolos de Terapia Cognitivo Conductual y relaciónalo con un tema de estos: [${tipoInstitucion}]. Si no encuentras una relación directa, hazlo por análisis clínico al que más se acerque o al que podría relacionarse si tuvieras más información.

Utiliza el historial, las calificaciones anteriores (${calificacion}), tema previo (${tema}), porcentaje de certeza previo (${porcentaje}) y los reactivos de tests psicológicos como PHQ-9, GAD-7, C-SSRS, ASSIST, AUDIT, IAT, Rosenberg, PSS, PSQI, Escala de soledad UCLA, SCL-90-R, BAI o BDI-II para asignar una nueva calificación al tema que seleccionaste y un nuevo porcentaje de certeza.

Si el porcentaje de certeza es mayor a 90%, ofrécele un mensaje de acompañamiento. Si es menor, incluye alguna pregunta que te ayude a llegar al 100% de certeza.

IMPORTANTÍSIMO: Siempre que detectes señales o palabras literales de crisis emocional, suicidio, burnout, peligro, peligro físico, encierro, acoso, bullying, bulimia, anorexia, violación, ludopatía o trastornos alimenticios, escribe exactamente: "SOS". Si no detectas señales de este tipo, escribe exactamente: "OK".

Responde solo en formato JSON con estos campos:
{
  "mensajeUsuario": "respuesta que se muestra al usuario (menos de 1000 caracteres)",
  "temaDetectado": "tema elegido",
  "calificacion": "valor numérico",
  "porcentaje": "valor numérico",
  "SOS": "SOS o OK"
}`;

    const completion = await openai.createChatCompletion({
      model: "gpt-4",
      messages: [
        { role: "system", content: "Eres un asistente emocional." },
        { role: "user", content: prompt }
      ],
      temperature: 0.6,
      max_tokens: 500
    });

    const textoRespuesta = completion.data.choices[0].message.content;

    console.log("📤 Respuesta bruta de OpenAI:", textoRespuesta);

    const json = JSON.parse(textoRespuesta);
    return NextResponse.json(json);

  } catch (error) {
    console.error("🔥 Error en aurea.js:", error);
    return NextResponse.json({ ok: false, error: error.message });
  }
}

