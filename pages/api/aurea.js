import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new NextResponse(JSON.stringify({ error: 'Sólo se permite POST' }), {
      status: 405,
    });
  }

  try {
    const body = await req.json();

    const {
      mensaje = "",
      correo = "",
      tipoInstitucion = "",
      nombre = "",
      institucion = "",
      temas = [],
      calificaciones = {},
      tema = "",
      calificacion = "",
      porcentaje = ""
    } = body;

    const promptBase = `
Eres AUREA, un sistema de acompañamiento emocional cálido y sin juicios. Acompañas usando herramientas de la terapia cognitivo conductual, el enfoque neurocognitivo conductual y la psicoterapia Gestalt. Tu estilo es cercano, claro y humano a pesar de ser sólo un acompañante, no un psicólogo certificado.

Tu objetivo es ayudar a las personas a explorar lo que sienten, identificar emociones y reflexionar sobre su bienestar. No das diagnósticos ni consejos médicos.

Responde solo sobre temas de salud emocional. Si el usuario pide algo fuera de tu rol, indícalo con respeto.

[Nombre] mandó este mensaje: [mensaje]

Si fueras el mejor psicólogo del mundo, ¿qué le responderías?

Responde en formato JSON con los siguientes campos:

{
  "mensajeUsuario": "Aquí vas a escribir el mensaje que quieres mandarle al usuario",
  "temaDetectado": "el tema que hayas seleccionado",
  "calificacion": "calificación asignada",
  "porcentaje": "el porcentaje de certeza que hayas definido",
  "SOS": "SOS/OK"
}
    `.trim();

    const prompt = promptBase
      .replace("[Nombre]", nombre || "El usuario")
      .replace("[mensaje]", mensaje || "");

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7
      })
    });

    const data = await openaiRes.json();

    const totalTokens = data.usage?.total_tokens || 0;
    const inputTokens = data.usage?.prompt_tokens || 0;
    const outputTokens = data.usage?.completion_tokens || 0;
    const costoUSD = totalTokens * 0.00003;

    // Guardar tokens en Sheets
    await fetch("https://script.google.com/macros/s/AKfycbwA3XgsycDzaMJpUn-r9R0IRJdsSbmviY_lwN96w1b-lEwghaydhkDAkZaZUn5cQ3s3mQ/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionID: new Date().toISOString(),
        usuario: correo,
        Institucion: institucion,
        inputTokens,
        outputTokens,
        totalTokens,
        costoUSD
      })
    });

    const mensajePlano = data.choices?.[0]?.message?.content || "";

    return new NextResponse(
      JSON.stringify({ ok: true, mensajeUsuario: mensajePlano }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("❌ Error en aurea.js:", error);
    return new NextResponse(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
    });
  }
}


