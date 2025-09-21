// pages/api/cache/verificar-usuario.js
// Proxy con caché en memoria hacia GAS_VER_URL (+ CORS + timeout + guardarraíl de código)

// ⚙️ Leer URL de GAS desde variable de entorno (seguro y flexible)
const GAS_VER_URL = process.env.AUREA_GAS_VERIFICAR_USUARIO_URL;

const userCache = new Map(); // key -> { data, exp }
const TTL_MS = 60 * 1000; // 60s de caché en memoria

function key(correo, codigo) { return `${correo.toLowerCase()}::${codigo.toUpperCase()}`; }
function now() { return Date.now(); }

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
    let json = null; try { json = JSON.parse(text); } catch (_) {}
    return { okHTTP: r.ok, status: r.status, text, json };
  } catch (err) {
    return { okHTTP: false, status: 0, text: String(err), json: null };
  } finally {
    clearTimeout(id);
  }
}

export default async function handler(req, res) {
  // 🔐 CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://www.positronconsulting.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, acceso: false, motivo: 'Method not allowed' });

  const correo = String(req.body?.correo || '').trim().toLowerCase();
  const codigo = String(req.body?.codigo || '').trim().toUpperCase();
  if (!correo || !codigo) {
    return res.status(200).json({ ok: false, acceso: false, motivo: 'Correo y código requeridos' });
  }

  const k = key(correo, codigo);
  const cached = userCache.get(k);
  if (cached && cached.exp > now()) {
    res.setHeader('AUREA-Cache', 'HIT');
    return res.status(200).json(cached.data);
  }

  // 🚀 Llamar a GAS
  const r = await fetchJSON(GAS_VER_URL, { correo, codigo }, 9000);
  if (!r.okHTTP || !r.json) {
    return res.status(200).json({
      ok: false,
      acceso: false,
      motivo: `Fallo verificación (${r.status})`,
      error: r.text || ''
    });
  }

  const resp = r.json || {};

  // 🛡️ Guardarraíl: si GAS dice acceso:true pero el código real del usuario ≠ ingresado → forzar acceso:false
  const userCode = String(resp?.usuario?.codigo || '').trim().toUpperCase();
  if (resp?.acceso === true && userCode && userCode !== codigo) {
    resp.acceso = false;
    resp.motivo = 'El código no corresponde a este usuario';
  }

  userCache.set(k, { data: resp, exp: now() + TTL_MS });
  res.setHeader('AUREA-Cache', cached ? 'STALE' : 'MISS');
  return res.status(200).json(resp);
}

