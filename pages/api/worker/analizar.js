// pages/api/worker/analizar.js
import { verifySignature } from "@upstash/qstash/nextjs";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const current = process.env.QSTASH_CURRENT_SIGNING_KEY;
    const next = process.env.QSTASH_NEXT_SIGNING_KEY;
    if (!current || !next) {
      return res.status(500).json({ ok: false, error: "QStash signing keys missing" });
    }

    // ✅ Verifica firma y obtén el body crudo
    const { body } = await verifySignature({
      req,
      currentSigningKey: current,
      nextSigningKey: next,
    });

    const payload = JSON.parse(body || "{}");

    // Reenvía al endpoint existente (analizar-test)
    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";
    const target = `${base}/api/analizar-test`;

    const r = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

    if (!r.ok) {
      return res.status(r.status).json({ ok: false, error: text || "Downstream error" });
    }

    return res.status(200).json(json || { ok: true });
  } catch (err) {
    console.error("worker/analizar error:", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
