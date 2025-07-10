export default async function handler(req, res) {
  console.log("🎯 SÍ ENTRÉ A AUREA.JS");
  console.log("📦 Data recibida:", req.body);

  return res.status(200).json({
    ok: true,
    respuesta: `Sí lo recibí: ${req.body?.mensaje || "sin mensaje"}`
  });
}
