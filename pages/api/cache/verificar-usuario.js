// ✅ pages/api/cache/verificar-usuario.js
// Proxy robusto hacia GAS (/exec), con caché Upstash 60s, CORS y GET ping.

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://www.positronconsulting.com';

// ⚠️ TU GAS WEB APP (exec) — el que nos diste:
const GAS_URL = 'https://script.google.com/macros/s/AKfycbwDMJb1IJ5H-rFOqg2F-PMQKtUclaD5Z7pFPAraeHpE9VB8srzuAtV4ui9Gb9SnlzDgmA/exec';

// Upstash Redis REST (opcional pero recomendado)
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const CACHE_TTL_S = parseInt(process.env.CACHE_TTL_SECONDS || '60', 10);

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function json(res, status, obj) { res.status(status).json(obj); }
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('TIMEOUT')), ms);
    promise.then(v => { clearTimeout(id); resolve(v); })
           .catch(e => { clearTimeout(id); reject(e); });
  });
}

async function redisGet(key) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
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
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });
  } catch {}
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return json(res, 200, { ok: true, ping: 'verificar-usuario', method: 'GET' });
  if (req.method !== 'POST') return json(res, 405, { ok: false, motivo: 'Método no permitido' });

  const correo = String(req.body?.correo || '').trim().toLowerCase();
  const codigo = String(req.body?.codigo || '').trim().toUpperCase();
  if (!correo || !codigo || !correo.includes('@')) {
    return json(res, 200, { ok: false, acceso: false, motivo: 'Parámetros inválidos' });
  }

  const cacheKey = `verifUsuario:${correo}:${codigo}`;
  const cached = await redisGet(cacheKey);
  if (cached && typeof cached === 'object') return json(res, 200, cached);

  try {
    const r = await withTimeout(
      fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo, codigo })
      }),
      10000
    );

    const text = await r.text().catch(() => '');
    let data = null; try { data = text ? JSON.parse(text) : null; } catch {}

    if (!r.ok) {
      const out = { ok: false, acceso: false, motivo: `Fallo verificación (${r.status})`, error: text?.slice(0,200) };
      return json(res, 200, out);
    }
    if (!data || data.ok !== true) {
      const out = { ok: false, acceso: false, motivo: 'Respuesta inválida de GAS' };
      return json(res, 200, out);
    }

    const out = {
      ok: true,
      acceso: data.acceso === true,
      yaRegistrado: !!data.yaRegistrado,
      usuario: data.usuario || null,
      institucion: data.institucion || null,
      tipoInstitucion: data.tipoInstitucion || null,
      correoSOS: data.correoSOS || null
    };

    await redisSetEx(cacheKey, out, CACHE_TTL_S);
    return json(res, 200, out);
  } catch (err) {
    const msg = String(err?.message || err);
    const out = { ok: false, acceso: false, motivo: (msg === 'TIMEOUT' ? 'Timeout verificar-usuario (10s)' : 'Error verificar-usuario'), error: msg };
    return json(res, 200, out);
  }
}
