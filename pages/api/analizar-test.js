// ✅ /pages/api/analizar-test.js

const API_RESPUESTAS = "https://script.google.com/macros/s/AKfycbxSTPQOLzlmtxcq9OYSJjr4MZZMaVfXBthHdTvt_1g91pfECM7yDrI_sQU2q5bBcG_YiQ/exec";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const { tipoInstitucion } = req.body;

    if (!tipoInstitucion) {
      return res.status(400).json({ ok: false, error: "Falta tipoInstitucion" });
    }

    const respuestaRaw = await fetch(API_RESPUESTAS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipoInstitucion })
    });

    const datos = await respuestaRaw.json();

    return res.status(200).json({
      ok: true,
      datos
    });

  } catch (error) {
    console.error("🔥 Error en analizar-test:", error);
    return res.status(500).json({ ok: false, error: "Error interno al consultar respuestas" });
  }
}
