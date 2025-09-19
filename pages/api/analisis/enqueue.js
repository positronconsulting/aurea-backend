// pages/api/analisis/enqueue.js
export default async function handler(req, res) {
  // CORS básico
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ ok:false, error:"Method Not Allowed" });
  }

  try {
    const token = (process.env.QSTASH_TOKEN || "").trim();
    if (!token) return res.status(500).json({ ok:false, error:"Falta QSTASH_TOKEN" });

    // Tomamos el body TAL CUAL y lo reenviamos a QStash
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    // Si quieres, aquí podrías validar campos mínimos:
    // const { tipoInstitucion, email } = payload;

    const urlGroup = "aurea-webhook"; // tu URL Group en QStash
    const r = await fetch(`https://qstash.upstash.io/v2/publish/${encodeURIComponent(urlGroup)}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    if (!r.ok) {
      return res.status(r.status).json({ ok:false, error: j?.error || text || "QStash publish error" });
    }
    return res.status(200).json({ ok:true, qstash: j });
  } catch (err) {
    return res.status(500).json({ ok:false, error: String(err?.message || err) });
  }
}

