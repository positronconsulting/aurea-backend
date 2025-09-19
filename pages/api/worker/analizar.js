// pages/api/worker/analizar.js
import { verifySignature } from "@upstash/qstash/nextjs";

export const config = { api: { bodyParser: false } };

const mask = (s) => (s ? `${String(s).slice(0,4)}…(len:${String(s).length})` : "MISSING");

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    // 1) Verificar firma QStash
    const current = process.env.QSTASH_CURRENT_SIGNING_KEY;
    const next = process.env.QSTASH_NEXT_SIGNING_KEY;
    if (!current || !next) {
      return res.status(500).json({ ok: false, error: "QStash signing keys missing" });
    }

    const { body } = await verifySignature({
      req,
      currentSigningKey: current,
      nextSigningKey: next,
    });

    // Payload entrante (opcional log de tamaño)
    const payload = JSON.parse(body || "{}");
    console.log("[worker] payload keys:", Object.keys(payload));

    // 2) Forward interno
    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";
    const target = `${base}/api/analizar-test`;

    const internalToken = (process.env.AUREA_INTERNAL_TOKEN || "").trim();
    console.log("[worker] target:", target);
    console.log("[worker] AUREA_INTERNAL_TOKEN:", mask(internalToken));

    const r = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": internalToken,
      },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    console.log("[worker] downstream status:", r.status, "body keys:", json ? Object.keys(json) : text.slice(0,120));

    if (!r.ok) {
      return res.status(r.status).json({ ok: false, error: text || "Downstream error" });
    }

    return res.status(200).json(json || { ok: true });
  } catch (err) {
    console.error("worker/analizar error:", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

