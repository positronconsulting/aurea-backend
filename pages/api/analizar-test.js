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

  const expected = (process.env.AUREA_INTERNAL_TOKEN || "").trim();
  const got = String(req.headers["x-internal-token"] || "").trim();

  console.log("[analizar-test] expected.len:", expected.length);
  console.log("[analizar-test] got.len     :", got.length);
  console.log("[analizar-test] got.prefix  :", got.slice(0,5));
  console.log("[analizar-test] candidates  :", expected && got && (expected === got) ? 1 : 0);

  if (!expected || got !== expected) {
    return res.status(401).json({ ok:false, error:"Unauthorized" });
  }

  // TEMP: sólo confirmamos token y echo del payload
  let payload = {};
  try { payload = req.body || {}; } catch { payload = {}; }

  return res.status(200).json({
    ok: true,
    note: "Token válido, conexión establecida",
    receivedKeys: Object.keys(payload || {})
  });
}
