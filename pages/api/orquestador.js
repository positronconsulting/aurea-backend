// /api/orquestador/index.js  (Next.js API Route / Vercel serverless)
// Requiere Node 18 en Vercel (fetch global disponible)
export const config = {
  runtime: 'nodejs18.x', // asegura serverless, NO Edge
};

// Env vars (ajústalas en Vercel)
const ALLOWED_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://www.positronconsulting.com';

// Endpoints internos (cache layer)
const CACHE_VERIFY_USER_URL =
  process.env.CACHE_VERIFY_USER_URL ||
  process.env.AUREA_CACHE_VERIFICAR_USUARIO_URL || // por si ya la tenías así
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

// Ejecuta una función que hace fetch y la aborta a los ms indicados.
// fn debe ser (signal) => Promise<...>
function withTimeout(fn, ms, label = 'op') {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fn(ctrl.signal)
    .finally(() => clearTimeout(id))
    .catch((err) => {
      // Normalizamos el error para diagnóstico
      throw new Error(`TIMEOUT_${label}:${err?.message || String(err)}`);
    });
}

async function postJSON(url, body, signal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal,
  });
  const text = await res.text(); // siempre leemos texto para evitar throws
  let json = null;
  try { json = JSON.parse(text); } catch { /* noop */ }
  return { res, json, text };
}

// ---------- handler ----------
export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = String(req.query.action || '').toLowerCase();

  // Solo soportamos login en este orquestador
  if (action !== 'login') {
    return res.status(200).json({ ok: false, motivo: 'Invalid action' });
  }

  // Tomamos body de forma segura (Next ya parsea JSON; si no, hacemos fallback)
  const bodyIn = (req.body && typeof req.body === 'object')
    ? req.body
    : (() => {
        try { return JSON.parse(req.body || '{}'); } catch { return {}; }
      })();

  const emailRaw  = bodyIn.email ?? bodyIn.correo;
  const codigoRaw = bodyIn.codigo ?? bodyIn.code;

  const correo = String(emailRaw || '').trim().toLowerCase();
  const codigo = String(codigoRaw || '').trim().toUpperCase();

  if (!correo || !codigo || !correo.includes('@')) {
    return res.status(200).json({ ok: false, acceso: false, motivo: 'Parámetros inválidos' });
  }

  // Tiempo de espera suficiente para permitir fallback a GAS (~10–18s)
  const TIMEOUT_MS = 25000;
  const payload = { correo, codigo };

  // Pequeño helper para consultar el verificador y propagar headers útiles
  const callVerifyUsuario = async (signal) => {
    const t0 = Date.now();
    const { res: r2, json } = await postJSON(CACHE_VERIFY_USER_URL, payload, signal);

    // Propaga headers de diagnóstico si existen
    const diag = {
      'Aurea-Cache': pickHeader(r2.headers, 'Aurea-Cache'),
      'Aurea-Diag': pickHeader(r2.headers, 'Aurea-Diag'),
      'Aurea-Elapsedms': pickHeader(r2.headers, 'Aurea-Elapsedms'),
    };
    for (const [k, v] of Object.entries(diag)) {
      if (v) res.setHeader(k, v);
    }
    res.setHeader('Aurea-Proxy-Elapsedms', String(Date.now() - t0));

    return json;
  };

  // Reintento suave: hasta 2 intentos
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

      // Si el verificador dice que no hay acceso, devolvemos tal cual (Wix ya muestra mensajes)
      if (!json.ok || !json.acceso) {
        return res.status(200).json(json);
      }

      // ✅ Éxito total
      return res.status(200).json(json);
    } catch (err) {
      lastErr = err;
      // Backoff leve antes del reintento
      if (attempt === 1) await new Promise((r) => setTimeout(r, 300));
    }
  }

  // Si llegamos aquí, fue timeout u otro fallo interno
  return res.status(200).json({
    ok: false,
    acceso: false,
    motivo: 'Timeout verificar usuario',
    error: String(lastErr || 'UNKNOWN'),
  });
}
