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

  // 🔐 Token interno (tolera header combinado "a, b")
  const expected = (process.env.AUREA_INTERNAL_TOKEN || "").trim();
  const raw = String(req.headers["x-internal-token"] || "");
  const candidates = raw.split(",").map(s => s.trim()).filter(Boolean);
  const match = expected && candidates.includes(expected);

  console.log("[analizar-test] expected.len:", expected.length);
  console.log("[analizar-test] got.len     :", raw.length);
  console.log("[analizar-test] got.prefix  :", raw.slice(0,5));
  console.log("[analizar-test] candidates  :", candidates.length);

  if (!match) {
    return res.status(401).json({ ok:false, error:"Unauthorized" });
  }

  // ✅ Conexión OK
  return res.status(200).json({ ok:true, msg:"Token válido, conexión establecida" });
}
