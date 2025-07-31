// archivo: /pages/api/analizar-test.js

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Manejar preflight
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const { tipoInstitucion, correoSOS } = req.body;

    console.log("📥 tipoInstitucion recibido:", tipoInstitucion);
    console.log("📥 correoSOS recibido:", correoSOS);

    if (!tipoInstitucion) {
      return res.status(400).json({ ok: false, error: "Falta tipoInstitucion" });
    }

    // 📡 Apps Script: Obtener respuestas del test
    const appsScriptUrl = "https://script.google.com/macros/s/AKfycbxSTPQOLzlmtxcq9OYSJjr4MZZMaVfXBthHdTvt_1g91pfECM7yDrI_sQU2q5bBcG_YiQ/exec";

    const response = await fetch(appsScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipoInstitucion })
    });

    const raw = await response.text();
    let data;

    try {
      data = JSON.parse(raw);
    } catch (err) {
      console.error("❌ Respuesta de Apps Script no es JSON válido:", raw);
      return res.status(500).json({ ok: false, error: "Respuesta de Apps Script no es JSON válido" });
    }

    console.log("✅ Respuesta de Apps Script recibida correctamente");
    return res.status(200).json(data);

  } catch (err) {
    console.error("🔥 Error interno en analizar-test:", err);
    return res.status(500).json({ ok: false, error: "Error interno en analizar-test" });
  }
}

