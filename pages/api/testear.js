// pages/api/testear.js

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.positronconsulting.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end(); // Preflight
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const { mensaje } = req.body;
    console.log("🎯 LLEGÓ A testear.js:", mensaje);

    return res.status(200).json({
      ok: true,
      respuesta: `Sí llegó a testear.js con: ${mensaje}`
    });
  } catch (err) {
    console.error("🔥 Error en testear.js:", err);
    return res.status(500).json({ ok: false, error: "Error interno en testear.js" });
  }
}
