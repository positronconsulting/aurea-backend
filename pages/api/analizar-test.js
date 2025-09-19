// pages/api/analizar-test.js
export default async function handler(req, res) {
  // CORS básico
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

  // 🔎 LOGS CLAROS
  console.log("[analizar-test] expected.len:", expected.length);
  console.log("[analizar-test] got.len     :", got.length);
  console.log("[analizar-test] got.prefix  :", got.slice(0, 5) || "(empty)");

  if (!expected || got !== expected) {
    // devuelve info mínima para diagnosticar
    return res.status(401).json({
      ok:false,
      error:"Unauthorized",
      expectedLen: expected.length,
      gotLen: got.length,
      gotPrefix: got.slice(0, 5) || ""
    });
  }

  // (tu lógica o el return de prueba, lo que tengas ahora mismo)
  return res.status(200).json({ ok:true, msg:"Token válido, conexión establecida" });
}
