// pages/api/analizar-test.js
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Internal-Token");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ ok:false, error:"Method Not Allowed" });
  }

  // 🔐 Token interno
  const expected = (process.env.AUREA_INTERNAL_TOKEN || "").trim();
  const got = String(req.headers["x-internal-token"] || "").trim();

  // Logs para ver exactamente qué compara
  console.log("🔐 [TEST] expected:", expected);
  console.log("🔐 [TEST] got     :", got);

  if (!expected || got !== expected) {
    return res.status(401).json({ ok:false, error:"Unauthorized", expected, got });
  }

  // ✅ Si llegamos aquí, el worker pasó el token correctamente
  return res.status(200).json({ ok:true, msg:"Token válido, conexión establecida" });
}
