// api/cache/verificar-codigo.js
// Verifica un código con Redis como fuente principal + upstream opcional.
// Nunca burbujea 404: siempre 200 con motivo normalizado.

export const config = { runtime: 'edge' };

const ORIGIN = process.env.FRONTEND_ORIGIN || '*';
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const GAS_VERIFY_URL = process.env.GAS_VERIFY_URL || ''; // opcional

// TTLs
const CACHE_TTL_POS_S  = 60 * 60 * 24;      // 24h para positivos
const CACHE_TTL_NEG_S  = 60 * 10;           // 10m para negativos

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=0, must-revalidate',
    ...extra
  };
}

function json(res, status, body, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: corsHeaders(extraHeaders || {})
  });
}

function normCodigo(c) {
  return String(c || '').trim().toUpperCase();
}

async function redisGet(key) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  const url = `${REDIS_URL}/get/${encodeURIComponent(key)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
  if (!r.ok) return null;
  const t = await r.text();
  if (!t) return null;
  try { return JSON.parse(t); } catch { return null; }
}

async function redisSetEx(key, val, ttl) {
  if (!REDIS_URL || !REDIS_TOKEN) return false;
  const url = `${REDIS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(val))}?EX=${ttl}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
  return r.ok;
}

function normalizeUpstream(data = {}) {
  // Acepta distintas formas y las normaliza
  const activo = (data.activo === true) || String(data.activo).toLowerCase() === 'true';
  const institucion = data.institucion || data.org || '';
  const tipoRaw = data.tipoInstitucion || data.tipo || '';
  const tipoInstitucion = String(tipoRaw || '').toLowerCase();
  const correoSOS = data.correoSOS || data.sos || '';

  return {
    ok: true,
    activo,
    institucion,
    tipoInstitucion, // guardamos en minúsculas
    correoSOS
  };
}

async function callUpstream(codigo, timeoutMs = 8000) {
  if (!GAS_VERIFY_URL) return { ok: false, status: 0, data: null, raw: null };
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(GAS_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo }),
      signal: controller.signal
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    return { ok: res.ok, status: res.status, data, raw: text };
  } finally {
    clearTimeout(id);
  }
}

export default async function handler(req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders() });
  }

  // Permitimos GET para diagnósticos simples (p.ej. ?codigo=BETA)
  let body = {};
  if (req.method === 'GET') {
    const { searchParams } = new URL(req.url);
    body.codigo = searchParams.get('codigo') || '';
  } else if (req.method === 'POST') {
    body = await req.json().catch(() => ({}));
  } else {
    return json(req, 405, { ok: false, motivo: 'Método no permitido' });
  }

  const codigo = normCodigo(body.codigo);
  if (!codigo) {
    return json(req, 200, { ok: false, motivo: 'Código requerido' });
  }

  const licKey = `lic:code:${codigo}`;

  try {
    // 1) Redis first
    const cached = await redisGet(licKey);
    if (cached && cached.ok === true) {
      // Puede ser activo:true o activo:false (negative cache)
      return json(req, 200, { ...cached, codigo }, { 'Aurea-Cache': 'HIT:redis' });
    }

    // 2) Upstream (opcional)
    const up = await callUpstream(codigo);

    if (up.ok && up.data && (up.data.ok === true || typeof up.data.activo !== 'undefined')) {
      // Normalizamos
      const norm = normalizeUpstream(up.data);
      // Guardamos positivo o negativo según "activo"
      const ttl = norm.activo ? CACHE_TTL_POS_S : CACHE_TTL_NEG_S;
      const payload = { ...norm, codigo };
      await redisSetEx(licKey, payload, ttl);
      return json(req, 200, payload, { 'Aurea-Cache': 'MISS:upstream-ok' });
    }

    // 3) Upstream falló (404, timeout, lo que sea) → normalizamos a negativo controlado
    const neg = { ok: true, activo: false, motivo: 'Código inválido o inactivo', codigo };
    await redisSetEx(licKey, neg, CACHE_TTL_NEG_S); // negative cache corto
    return json(req, 200, neg, { 'Aurea-Cache': 'MISS:upstream-error' });

  } catch (err) {
    // Falla inesperada → también normalizamos
    const neg = { ok: true, activo: false, motivo: 'Código inválido o inactivo', codigo, error: String(err) };
    await redisSetEx(licKey, neg, CACHE_TTL_NEG_S);
    return json(req, 200, neg, { 'Aurea-Cache': 'MISS:error' });
  }
}
