// pages/api/analisis/enqueue.js

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const QSTASH_URL = process.env.QSTASH_URL || "https://qstash.upstash.io";
    const TOKEN = process.env.QSTASH_TOKEN;
    const GROUP = process.env.QSTASH_URLGROUP_ANALIZAR; // p.ej. "aurea-webhook"

    if (!TOKEN || !GROUP) {
      return res.status(500).json({ ok: false, error: "QStash env vars missing" });
    }

    // El body debe contener: { tipoInstitucion, email, codigo?, correoSOS?, jobId?, requestedAt? }
    const job = req.body && typeof req.body === "object" ? req.body : {};
    if (!job.tipoInstitucion || !job.email) {
      return res.status(400).json({ ok: false, error: "Faltan tipoInstitucion o email" });
    }

    // FlowControl: paralelismo 3 bajo una misma key
    const fcKey = "AUREA_ANALIZAR";
    const fcVal = "parallelism=3";

    const url = `${QSTASH_URL}/v2/publish/${encodeURIComponent(GROUP)}`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        "Upstash-Flow-Control-Key": fcKey,
        "Upstash-Flow-Control-Value": fcVal,
      },
      body: JSON.stringify({
        // payload que consumirá tu /api/analizar-test
        ...job,
        jobId: job.jobId || `${job.tipoInstitucion}:${job.email}`,
        requestedAt: job.requestedAt || new Date().toISOString(),
      }),
    });

    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}

    if (!r.ok) {
      return res.status(r.status).json({ ok: false, error: text || "QStash publish failed" });
    }

    return res.status(200).json({ ok: true, qstash: json || text || "" });
  } catch (err) {
    console.error("enqueue error:", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
