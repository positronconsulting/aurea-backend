// pages/api/cache/verificar-usuario.js
// Proxy con caché en memoria a GAS_VER_URL (+ CORS + timeout) y guardarraíl de código-usuario.

// ⚙️ Lee URL de GAS desde env, con fallback (para emergencia local)
const GAS_VER_URL = process.env.AUREA_GAS_VERIFICAR_USUARIO_URL
  || 'https://script.google.com/macros/s/REEMPLAZA_CON_TU_FALLBACK/exec';

// CORS (puedes también leer de env)
const ALLOWED_ORIGIN = process.env.AUREA_ALLOWED_ORIGIN || 'https://www.positronconsulting.com';

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
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, acceso:false, motivo:'Method not allowed' });

  const correo = String(req.body?.correo || '').trim().toLowerCase();
  const codigo = String(req.body?.codigo || '').trim().toUpperCase();
  if (!correo || !codigo) {
    return res.status(200).json({ ok:false, acceso:false, motivo:'Correo y código requeridos' });
  }

  const k = key(correo, codigo);
  const cached = userCache.get(k);
  if (cached && cached.exp > now()) {
    res.setHeader('AUREA-Cache', 'HIT');
    return res.status(200).json(cached.data);
  }

  // 🔎 GAS
  const r = await fetchJSON(GAS_VER_URL, { correo, codigo }, 9000);
  if (!r.okHTTP || !r.json) {
    return res.status(200).json({ ok:false, acceso:false, motivo:`Fallo verificación (${r.status})`, error:r.text || '' });
  }

  // 🛡️ Guardarraíl: si viene acceso:true pero el código real del usuario ≠ código ingresado, forzamos acceso:false
  const resp = r.json || {};
  const userCode = String(resp?.usuario?.codigo || '').trim().toUpperCase();
  if (resp?.acceso === true && userCode && userCode !== codigo) {
    resp.acceso = false;
    resp.motivo = 'El código no corresponde a este usuario';
  }

  userCache.set(k, { data: resp, exp: now() + TTL_MS });
  res.setHeader('AUREA-Cache', cached ? 'STALE' : 'MISS');
  return res.status(200).json(resp);
}

