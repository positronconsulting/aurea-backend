// /api/aurea.js en Vercel (Node.js 18+)

export default async function handler(req, res) {
  // 🔐 Encabezados para evitar CORS
  res.setHeader("Access-Control-Allow-Origin", "https://www.positronconsulting.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end(); // Preflight CORS
  }

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
      calificaciones
    } = req.body;

    console.log("📥 Data recibida en Aurea del backend:", {
      mensaje,
      correo,
      tipoInstitucion,
      nombre,
      institucion,
      temas,
      calificaciones
    });

    // 🧪 Solo responder para confirmar recepción
    return res.status(200).json({
      ok: true,
      respuesta: `Sí lo recibí: ${mensaje}`
    });

  } catch (error) {
    console.error("🔥 Error en aurea.js:", error);
    return res.status(500).json({ ok: false, error: "Fallo interno en aurea.js" });
  }
}
