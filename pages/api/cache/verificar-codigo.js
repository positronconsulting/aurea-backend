// ✅ pages/api/cache/verificar-codigo.js
// Proxy con caché 60s al endpoint de verificación de CÓDIGO que ya tengas.
// Usa env GAS_VERIFY_URL (o GAS_LICENCIAS como fallback). GET responde ping.

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://www.positronconsulting.com';
const UPSTREAM_URL = process.env.GAS_VERIFY_URL || process.env.GAS_LICENCIAS || ''; // ← define una de estas en Vercel

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const CACHE_TTL_S = parseInt(process.env.CACHE_TTL_SECONDS || '60', 10);

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function json(res, status, obj) { res.status(status).json(obj); }
function withTimeout(p, ms){ return new Promise((resolve, reject)=>{ const id=setTimeout(()=>reject(new Error('TIMEOUT')), ms); p.then(v=>{clearTimeout(id);resolve(v);}).catch(e=>{clearTimeout(id);reject(e);}); }); }

async function redisGet(key) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
    if (!r.ok) return null;
    const j = await r.json().catch(()=>null);
    if (!j || typeof j.result !== 'string' || j.result === 'null') return null;
    try { return JSON.parse(j.result); } catch { return null; }
  } catch { return null; }
}
async function redisSetEx(key, value, ttlSec) {
  if (!REDIS_URL || !REDIS_TOKEN) return;
  try {
    const body = new URLSearchParams();
    body.set('value', JSON.stringify(value));
    body.set('ex', String(ttlSec));
    await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
  } catch {}
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return json(res, 200, { ok: true, ping: 'verificar-codigo', method: 'GET' });
  if (req.method !== 'POST') return json(res, 405, { ok: false, motivo: 'Método no permitido' });

  if (!UPSTREAM_URL) return json(res, 200, { ok:false, motivo:'Falta configurar GAS_VERIFY_URL (o GAS_LICENCIAS)' });

  const codigo = String(req.body?.codigo || '').trim().toUpperCase();
  if (!codigo) return json(res, 200, { ok:false, motivo:'Parámetros inválidos' });

  const cacheKey = `verifCodigo:${codigo}`;
  const cached = await redisGet(cacheKey);
  if (cached && typeof cached === 'object') return json(res, 200, cached);

  try {
    const r = await withTimeout(fetch(UPSTREAM_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ codigo })
    }), 8000);

    const text = await r.text().catch(()=> '');
    let data = null; try { data = text ? JSON.parse(text) : null; } catch {}

    if (!r.ok || !data) {
      const out = { ok:false, motivo: `Fallo verificación de código (${r.status||0})` };
      return json(res, 200, out);
    }

    // Passthrough/normalizado: asumimos que upstream devuelve { ok, institucion, tipoInstitucion, correoSOS, ... }
    await redisSetEx(cacheKey, data, CACHE_TTL_S);
    return json(res, 200, data);
  } catch (err) {
    const msg = String(err?.message || err);
    return json(res, 200, { ok:false, motivo: (msg==='TIMEOUT'?'Timeout verificar-codigo (8s)':'Error verificar-codigo'), error: msg });
  }
}
