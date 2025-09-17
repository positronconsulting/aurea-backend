// pages/api/cache/verificar-usuario.js
// Proxy con caché a GAS_VER_URL para (correo, codigo) + CORS + timeout

const GAS_VER_URL = 'https://script.google.com/macros/s/AKfycbwjm2DGC8Q_MJ3KwWWF1GupLu6lX7g_9kylrUk_OAzjYUSls4Esvg0FXoxKv7ya3miIYA/exec';

const userCache = new Map(); // key -> { data, exp }
const TTL_MS = 60 * 1000; // 60s

function key(correo, codigo){ return `${correo.toLowerCase()}::${codigo.toUpperCase()}`; }
function now(){ return Date.now(); }

async function fetchJSON(url, body, timeoutMs = 9000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort('timeout'), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch(_){}
    return { okHTTP: r.ok, status: r.status, text, json };
  } catch (err) {
    return { okHTTP:false, status:0, text:String(err), json:null };
  } finally {
    clearTimeout(id);
  }
}

export default async function handler(req, res) {
  // 🔐 CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://www.positronconsulting.com'); // o '*'
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, acceso:false, motivo:'Method not allowed' });

  const correo = String(req.body?.correo || '').trim().toLowerCase();
  const codigo = String(req.body?.codigo || '').trim().toUpperCase();
  if (!correo || !codigo) return res.status(200).json({ ok:false, acceso:false, motivo:'Correo y código requeridos' });

  const k = key(correo, codigo);
  const cached = userCache.get(k);
  if (cached && cached.exp > now()) {
    res.setHeader('AUREA-Cache', 'HIT');
    return res.status(200).json(cached.data);
  }

  const r = await fetchJSON(GAS_VER_URL, { correo, codigo }, 9000);
  if (!r.okHTTP || !r.json) {
    return res.status(200).json({ ok:false, acceso:false, motivo:`Fallo verificación (${r.status})`, error:r.text || '' });
  }

  userCache.set(k, { data: r.json, exp: now() + TTL_MS });
  res.setHeader('AUREA-Cache', 'MISS');
  return res.status(200).json(r.json);
}

