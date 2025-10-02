// /api/ping.js
export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Método no permitido" });
    return res.status(200).json({ ok: true, ts: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "PING_FAIL" });
  }
}
