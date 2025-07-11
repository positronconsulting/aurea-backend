// pages/api/aurea.js

import { v4 as uuidv4 } from 'uuid';

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.positronconsulting.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const { mensaje, correo, tipoInstitucion, nombre, institucion } = req.body;

    console.log("📥 Data recibida en Aurea del backend:", {
      mensaje,
      correo,
      tipoInstitucion,
      nombre,
      institucion
    });

    const sessionID = uuidv4();
    const apiKey = process.env.OPENAI_API_KEY;

    const openAiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "Eres AUREA, una inteligencia artificial especializada en acompañamiento emocional. Responde de forma breve, cálida y empática."
          },
          {
            role: "user",
            content: mensaje
          }
        ],
        temperature: 0.7,
        max_tokens: 200
      })
    });

    const data = await openAiResponse.json();

    if (!data.choices || !data.choices[0]?.message?.content) {
      console.error("⚠️ Error en respuesta de OpenAI:", data);
      return res.status(500).json({ ok: false, error: "Error al procesar respuesta de AUREA" });
    }

    const respuestaAurea = data.choices[0].message.content.trim();
    const usage = data.usage || {};
    const costoUSD = usage.total_tokens ? usage.total_tokens * 0.00001 : 0;

    // Registro en Google Sheets
    const sheetPayload = {
      sessionID,
      usuario: correo,
      institucion,
      inputTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
      costoUSD: parseFloat(costoUSD.toFixed(6))
    };

    await fetch("https://script.google.com/macros/s/AKfycbwA3XgsycDzaMJpUn-r9R0IRJdsSbmviY_lwN96w1b-lEwghaydhkDAkZaZUn5cQ3s3mQ/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sheetPayload)
    });

    console.log("📊 Tokens registrados:", sheetPayload);

    return res.status(200).json({
      ok: true,
      respuesta: respuestaAurea
    });

  } catch (err) {
    console.error("🔥 Error en aurea.js:", err);
    return res.status(500).json({ ok: false, error: "Error interno en aurea.js" });
  }
}
