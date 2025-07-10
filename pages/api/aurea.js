export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    const {
      mensaje,
      correo,
      tipoInstitucion,
      nombre,
      institucion,
      temas,
      calificaciones,
      historial
    } = req.body;

    console.log("📥 Data recibida en Aurea del backend:", {
      mensaje,
      historial,
      nombre,
      institucion,
      temas,
      calificaciones
    });

    // 👇 Confirmación simple
    return res.status(200).json({
      ok: true,
      respuesta: `Sí lo recibí: ${mensaje}`
    });

  } catch (err) {
    console.error("🔥 Error general en aurea.js:", err);
    return res.status(500).json({ ok: false, error: "Fallo interno" });
  }
}
