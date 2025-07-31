// archivo: /pages/api/analizar-test.js

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });

  try {
    const { tipoInstitucion, correoSOS } = req.body;

    console.log("📥 tipoInstitucion recibido:", tipoInstitucion);
    if (!tipoInstitucion) {
      return res.status(400).json({ ok: false, error: "Falta tipoInstitucion" });
    }

    // === 1. Obtener respuestas desde Apps Script ===
    const appsScriptUrl = "https://script.google.com/macros/s/AKfycbxSTPQOLzlmtxcq9OYSJjr4MZZMaVfXBthHdTvt_1g91pfECM7yDrI_sQU2q5bBcG_YiQ/exec";
    const appResponse = await fetch(appsScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipoInstitucion })
    });

    const raw = await appResponse.text();
    let datos;
    try {
      datos = JSON.parse(raw);
    } catch (err) {
      console.error("❌ Respuesta de Apps Script no es JSON válido:", raw);
      return res.status(500).json({ ok: false, error: "Respuesta de Apps Script no es JSON válido" });
    }

    if (!datos.ok) {
      return res.status(500).json({ ok: false, error: datos.error || "Error al obtener respuestas" });
    }

    const { usuario, sexo, fechaNacimiento, info, respuestas } = datos;

    // === 2. Preparar prompt para OpenAI ===
    const prompt = `
A continuación se presentan las respuestas de un test de evaluación emocional. Evalúa estas respuestas de forma profesional, enfocado a especialistas en salud mental, y genera un perfil emocional clínicamente útil.

Sexo: ${sexo}
Fecha de nacimiento: ${fechaNacimiento}
Información adicional: ${info}

Respuestas:
${Object.entries(respuestas).map(([k, v]) => `• ${k} → ${v}`).join("\n")}

Devuelve un JSON con esta estructura:

{
  "perfil": "texto del perfil emocional...",
  "alertaSOS": true | false,
  "temaDetectado": "nombre del tema solo si alertaSOS es true"
}
`.trim();

    // === 3. Llamar a OpenAI ===
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    const aiData = await openaiResponse.json();

    if (!aiData || !aiData.choices || !aiData.choices.length) {
      return res.status(500).json({ ok: false, error: "Respuesta inválida de OpenAI" });
    }

    // Parsear JSON devuelto por OpenAI
    let resultadoOpenAI = {};
    try {
      resultadoOpenAI = JSON.parse(aiData.choices[0].message.content);
    } catch (err) {
      return res.status(500).json({ ok: false, error: "El mensaje de OpenAI no es JSON válido", raw: aiData.choices[0].message.content });
    }

    // 🟢 RESPUESTA SOLO DE OPENAI
    return res.status(200).json({
      ok: true,
      perfil: resultadoOpenAI.perfil,
      alertaSOS: resultadoOpenAI.alertaSOS || false,
      temaDetectado: resultadoOpenAI.temaDetectado || null,
      openaiRaw: aiData
    });

  } catch (err) {
    console.error("🔥 Error general en analizar-test:", err);
    return res.status(500).json({ ok: false, error: "Error interno en analizar-test" });
  }
}

