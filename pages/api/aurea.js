export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Método no permitido" });
  }

  try {
    console.log("✅ Endpoint AUREA llamado correctamente");

    return res.status(200).json({
      ok: true,
      mensaje: "🧪 Esto es una prueba: siempre deberías ver este mensaje"
    });

  } catch (err) {
    console.error("🔥 Error inesperado en aurea.js:", err);
    return res.status(500).json({ ok: false, error: "Error interno" });
  }
}
