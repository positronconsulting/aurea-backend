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
    const current = (process.env.QSTASH_CURRENT_SIGNING_KEY || "").trim();
    const next    = (process.env.QSTASH_NEXT_SIGNING_KEY || "").trim();
    if (!current || !next) {
      return res.status(500).json({ ok: false, error: "QStash signing keys missing" });
    }

    const { body } = await verifySignature({
      req,
      currentSigningKey: current,
      nextSigningKey: next,
    });

    // 2) Payload
    let payload = {};
    try { payload = JSON.parse(body || "{}"); } catch { payload = {}; }

    // 3) Destino fijo a prod (evita previews sin vars)
    const target = "https://aurea-backend-two.vercel.app/api/analizar-test";

    // 4) Token interno (UNA sola variante en minúsculas)
    const internalToken = (process.env.AUREA_INTERNAL_TOKEN || "").trim();

    // Logs
    console.log("[worker] target:", target);
    console.log("[worker] AUREA_INTERNAL_TOKEN:", mask(internalToken));
    console.log("[worker] bodyLen:", (body || "").length);
    console.log("[worker] payload keys:", Object.keys(payload));

    // 5) Reenvío
    const r = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-token": internalToken, // <-- SOLO una vez
      },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}

    console.log("[worker] downstream status:", r.status);

    if (!r.ok) {
      return res.status(r.status).json({ ok: false, error: text || "Downstream error" });
    }

    return res.status(200).json(json || { ok: true });
  } catch (err) {
    console.error("worker/analizar error:", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
