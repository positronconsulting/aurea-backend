// pages/api/worker/analizar.js
import { Receiver } from "@upstash/qstash/nodejs";

export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

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

    const receiver = new Receiver({ currentSigningKey: current, nextSigningKey: next });

    const signature = req.headers["upstash-signature"];
    if (!signature) {
      return res.status(401).json({ ok: false, error: "Missing Upstash-Signature" });
    }

    const raw = await readRawBody(req);

    // Verifica firma (throws si no coincide)
    await receiver.verify({ signature, body: raw });

    // Parseamos el payload ya verificado
    const payload = JSON.parse(raw || "{}");

    // Reenvía al endpoint existente de tu sistema (analizar-test)
    const base =
      process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";
    const target = `${base}/api/analizar-test`;

    const r = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}

    // Si tu /api/analizar-test devuelve 2xx, QStash lo considera deliverado
    if (!r.ok) {
      return res.status(r.status).json({ ok: false, error: text || "Downstream error" });
    }

    return res.status(200).json(json || { ok: true });
  } catch (err) {
    console.error("worker/analizar error:", err);
    // 500 => QStash reintentará con backoff
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
