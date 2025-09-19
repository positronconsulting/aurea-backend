// pages/api/worker/analizar.js
import { verifySignature } from "@upstash/qstash/nextjs";

export const config = { api: { bodyParser: false } };

const mask = (s) => (s ? `${String(s).slice(0,5)}…(len:${String(s).length})` : "MISSING");

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data || ""));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok:false, error:"Method Not Allowed" });
  }
  try {
    const current = process.env.QSTASH_CURRENT_SIGNING_KEY;
    const next = process.env.QSTASH_NEXT_SIGNING_KEY;
    if (!current || !next) {
      return res.status(500).json({ ok:false, error:"QStash signing keys missing" });
    }

    // Verificamos firma y obtenemos el body verificado (si por algo viniera vacío, caemos al raw)
    let verifiedBody = "";
    try {
      const { body } = await verifySignature({
        req,
        currentSigningKey: current,
        nextSigningKey: next,
      });
      verifiedBody = body || "";
    } catch (e) {
      // Como fallback extremo, intentamos leer raw (no debería ser necesario si la firma falla)
      verifiedBody = await readRawBody(req);
    }

    const raw = verifiedBody && verifiedBody.length ? verifiedBody : await readRawBody(req);
    let payload = {};
    try { payload = JSON.parse(raw || "{}"); } catch { payload = {}; }

    const internalToken = (process.env.AUREA_INTERNAL_TOKEN || "").trim();
    const target = `https://aurea-backend-two.vercel.app/api/analizar-test`;

    console.log("[worker] target:", target);
    console.log("[worker] AUREA_INTERNAL_TOKEN:", mask(internalToken));
    console.log("[worker] bodyLen:", raw?.length || 0);
    console.log("[worker] payload keys:", Object.keys(payload || {}));

    const resp = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": internalToken,
      },
      body: JSON.stringify(payload || {}),
    });

    const text = await resp.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    console.log("[worker] downstream status:", resp.status);

    if (!resp.ok) {
      return res.status(resp.status).json({ ok:false, error: j?.error || text || "Downstream error" });
    }
    return res.status(200).json(j || { ok:true });
  } catch (err) {
    console.error("worker/analizar error:", err);
    return res.status(500).json({ ok:false, error: String(err?.message || err) });
  }
}

