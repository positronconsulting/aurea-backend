// /pages/api/orquestador.js  (Next.js Pages Router - Vercel Serverless)
// Si quisieras fijar runtime (opcional): export const config = { runtime: 'nodejs' };

const ALLOWED_ORIGIN =
  process.env.FRONTEND_ORIGIN || 'https://www.positronconsulting.com';

// Endpoints internos (capa de caché que ya tienes en Vercel)
const CACHE_VERIFY_USER_URL =
  process.env.CACHE_VERIFY_USER_URL ||
  process.env.AUREA_CACHE_VERIFICAR_USUARIO_URL ||
  'https://aurea-backend-two.vercel.app/api/cache/verificar-usuario';

const CACHE_VERIFY_CODE_URL =
  process.env.CACHE_VERIFY_CODE_URL ||
  process.env.AUREA_CACHE_VERIFICAR_CODIGO_URL ||
  'https://aurea-backend-two.vercel.app/api/cache/verificar-codigo';

// ---------- utils ----------
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function pickHeader(h, name) {
  try { return h.get(name) || null; } catch { return null; }
}

// Ejecuta una función que usa fetch y la aborta a los ms indicados.
// fn debe ser (signal) => Promise<...>
function withTimeout(fn, ms, label = 'op') {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fn(ctrl.signal)
    .finally(() => clearTimeout(id))
    .catch((err) => {
      throw new Error(`TIMEOUT_${label}:${err?.message || String(err)}`);
    });
}

async function postJSON(url, body, signal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(body || {}),
    signal,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* noop */ }
  return { res, json, text };
}

// ---------- handler ----------
export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = String(req.query.action || '').toLowerCase();
  if (action !== 'login') {
    return res.status(200).json({ ok:false, motivo:'Invalid action' });
  }

  // Body seguro (Next ya parsea JSON; fallback si viniera como string)
  const bodyIn = (req.body && typeof req.body === 'object')
    ? req.body
    : (() => { try { return JSON.parse(req.body || '{}'); } catch { return {}; } })();

  const emailRaw  = bodyIn.email ?? bodyIn.correo;
  const codigoRaw = bodyIn.codigo ?? bodyIn.code;

  const correo = String(emailRaw || '').trim().toLowerCase();
  const codigo = String(codigoRaw || '').trim().toUpperCase();

  if (!correo || !codigo || !correo.includes('@')) {
    return res.status(200).json({ ok:false, acceso:false, motivo:'Parámetros inválidos' });
    // 👆 Esto evita el "Parámetros inválidos" que viste cuando el body estaba vacío/mal formado
  }

  const TIMEOUT_MS = 25000; // deja respirar a la capa de caché y su fallback a GAS
  const payload = { correo, codigo };

  const callVerifyUsuario = async (signal) => {
    const t0 = Date.now();
    const { res: r2, json } = await postJSON(CACHE_VERIFY_USER_URL, payload, signal);

    // Propaga headers de diagnóstico si existen (útiles en Wix logs)
    const diag = {
      'Aurea-Cache':     pickHeader(r2.headers, 'Aurea-Cache'),
      'Aurea-Diag':      pickHeader(r2.headers, 'Aurea-Diag'),
      'Aurea-Elapsedms': pickHeader(r2.headers, 'Aurea-Elapsedms'),
    };
    for (const [k,v] of Object.entries(diag)) { if (v) res.setHeader(k, v); }
    res.setHeader('Aurea-Proxy-Elapsedms', String(Date.now() - t0));

    return json;
  };

  // Reintento suave: 2 intentos máx.
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const json = await withTimeout(
        (signal) => callVerifyUsuario(signal),
        TIMEOUT_MS,
        `verificar-usuario#${attempt}`
      );

      if (!json || typeof json.ok !== 'boolean') {
        throw new Error(`Respuesta inválida de cache/verificar-usuario (attempt ${attempt})`);
      }

      if (!json.ok || !json.acceso) {
        // Devuelve tal cual para que Wix muestre el motivo correcto
        return res.status(200).json(json);
      }

      // ✅ Éxito total
      return res.status(200).json(json);
    } catch (err) {
      lastErr = err;
      if (attempt === 1) await new Promise(r => setTimeout(r, 300));
    }
  }

  // Fallo definitivo (timeout/abort/etc.)
  return res.status(200).json({
    ok: false,
    acceso: false,
    motivo: 'Timeout verificar usuario',
    error: String(lastErr || 'UNKNOWN'),
  });
}
