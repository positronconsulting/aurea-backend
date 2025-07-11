module.exports = async (req, res) => {
  // 🔐 Evita errores de CORS
  res.setHeader("Access-Control-Allow-Origin", "https://www.positronconsulting.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // 🛑 Preflight request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ❌ Método no permitido
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const { mensaje } = req.body;

    console.log("📥 Recibí el mensaje:", mensaje);

    // ✅ Respuesta confirmando recepción
    return res.status(200).json({
      ok: true,
      respuesta: `Mensaje recibido: ${mensaje}`
    });

  } catch (error) {
    console.error("🔥 Error en aurea.js:", error);
    return res.status(500).json({ ok: false, error: "Error interno del servidor" });
  }
};
