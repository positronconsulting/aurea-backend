module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.setHeader("Content-Type", "application/json");
      return res.status(405).end(JSON.stringify({ ok: false, error: "Método no permitido" }));
    }

    const { mensaje } = req.body;

    console.log("📥 Data recibida:", mensaje);

    const respuesta = {
      ok: true,
      respuesta: `Sí lo recibí: ${mensaje || "(mensaje vacío)"}`
    };

    res.setHeader("Content-Type", "application/json");
    res.status(200).end(JSON.stringify(respuesta));

  } catch (err) {
    console.error("🔥 Error en aurea.js:", err);
    res.setHeader("Content-Type", "application/json");
    res.status(500).end(JSON.stringify({ ok: false, error: "Fallo interno" }));
  }
};
