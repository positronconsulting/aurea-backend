module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const { mensaje } = req.body;

    console.log("📥 Data recibida:", mensaje);

    return res.status(200).json({
      ok: true,
      respuesta: `Sí lo recibí: ${mensaje}`
    });

  } catch (err) {
    console.error("🔥 Error:", err);
    return res.status(500).json({ ok: false, error: "Fallo interno" });
  }
};
