// pages/api/analisis/enqueue.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const token = (process.env.QSTASH_TOKEN || "").trim();
    if (!token) return res.status(500).json({ ok: false, error: "Missing QSTASH_TOKEN" });

    // Lee el payload tal cual llega
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    // Publica al URL Group (aurea-webhook) **pasando el body**
    const url = "https://qstash.upstash.io/v2/publish/aurea-webhook";

    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch {}

    if (!r.ok) {
      return res.status(r.status).json({ ok: false, error: j?.error || text || "QStash publish error" });
    }

    return res.status(200).json({ ok: true, qstash: j ? j : { published: true } });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
