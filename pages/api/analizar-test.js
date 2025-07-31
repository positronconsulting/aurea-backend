// ✅ /pages/api/analizar-test.js

import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const API_RESPUESTAS = "https://script.google.com/macros/s/AKfycbxSTPQOLzlmtxcq9OYSJjr4MZZMaVfXBthHdTvt_1g91pfECM7yDrI_sQU2q5bBcG_YiQ/exec";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const { tipoInstitucion } = req.body;

    // 1. Obtener datos desde Apps Script
    const respuestaRaw = await fetch(API_RESPUESTAS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipoInstitucion })
    });

    const datos = await respuestaRaw.json();
    if (!datos.ok) {
      return res.status(500).json({ ok: false, error: "Error al obtener respuestas del test" });
    }

    const { usuario, sexo, fechaNacimiento, info, respuestas } = datos;

    // 2. Construir prompt
    const prompt = `
Eres AUREA, la mejor psicóloga clínica del mundo. Tu tarea es analizar un test emocional con las siguientes respuestas y generar un perfil emocional centrado en el bienestar psicológico del evaluado.

Las respuestas están organizadas como "Pregunta": "Respuesta". Sé precisa, profesional y con enfoque humano. Usa lenguaje comprensible para psicólogos o profesionales de salud mental. Si detectas un riesgo, indícalo con claridad y di a qué tema se relaciona. Si no hay señales de alerta, indícalo también.

Datos demográficos:
- Sexo: ${sexo}
- Fecha de nacimiento: ${fechaNacimiento}
- Comentario libre: ${info}

Respuestas del test:
${Object.entries(respuestas).map(([k, v]) => `${k}: ${v}`).join("\n")}

Devuelve exclusivamente un objeto JSON como este:
{
  "perfil": "Texto del perfil emocional...",
  "alertaSOS": true | false,
  "temaDetectado": "Solo si hay alertaSOS"
}
    `.trim();

    // 3. Llamar a OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7
    });

    const contenido = completion.choices[0].message.content;

    let evaluacion;
    try {
      evaluacion = JSON.parse(contenido);
    } catch (error) {
      return res.status(500).json({ ok: false, error: "Respuesta de OpenAI no es JSON válido", raw: contenido });
    }

    return res.status(200).json({
      ok: true,
      ...evaluacion
    });

  } catch (err) {
    console.error("🔥 Error en analizar-test:", err);
    return res.status(500).json({ ok: false, error: "Error interno en analizar-test" });
  }
}
