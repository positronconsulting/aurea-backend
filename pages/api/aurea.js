export default async function handler(req, res) {
  // Encabezados CORS
  res.setHeader("Access-Control-Allow-Origin", "https://www.positronconsulting.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Manejo de preflight
  if (req.method === "OPTIONS") return res.status(200).end();

  // Rechazar métodos no permitidos
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
      correo,
      tipoInstitucion,
      nombre,
      institucion,
      temas,
      calificaciones,
      historial
    });

    // Validación básica
    if (!mensaje || !correo || !tipoInstitucion) {
      console.warn("❌ Faltan datos obligatorios:", { mensaje, correo, tipoInstitucion });
      return res.status(400).json({ ok: false, error: "Faltan datos requeridos" });
    }

    // Aquí podrías agregar lógica para enviar a OpenAI, Google Sheets, etc.

    // Respuesta provisional de confirmación
    return res.status(200).json({
      ok: true,
      respuesta: `Sí lo recibí: ${mensaje}`,
      institucion,
      nombre,
      temas,
      calificaciones
    });

  } catch (err) {
    console.error("🔥 Error general en aurea.js:", err);
    return res.status(500).json({ ok: false, error: "Fallo interno del servidor" });
  }
}
