// api/cache/verificar-codigo.js
// Verifica un código con Redis como fuente principal + upstream opcional.
// NUNCA burbujea 404: siempre 200 con motivo normalizado.
// + Admin refresh para forzar recarga (X-Admin-Key)

export const config = { runtime: 'edge' };

const ORIGIN = process.env.FRONTEND_ORIGIN || '*';
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const GAS_VERIFY_URL = process.env.GAS_VERIFY_URL || ''; // opcional (si tienes un GAS que valide solo código)
const ADMIN_KEY = process.env.AUREA_ADMIN_KEY || '';

const CACHE_TTL_POS_S  = 60 * 60 * 24; // 24h
const CACHE_TTL_NEG_S  = 60 * 10;      // 10m

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
    'Cache-Control': 'public, max-age=0, must-revalidate',
    ...extra
  };
}
function json(req, status, body, extraHeaders) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(extraHeaders || {}) });
}
function normCodigo(c) { return String(c || '').trim().toUpperCase(); }

async function redisGet(key) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j || typeof j.result !== 'string' || j.result === 'null') return null;
  try { return JSON.parse(j.result); } catch { return null; }
}
async function redisSetEx(key, value, ttl) {
  if (!REDIS_URL || !REDIS_TOKEN) return false;
  const body = new URLSearchParams();
  body.set('value', JSON.stringify(value));
  body.set('ex', String(ttl));
  const r = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  return r.ok;
}
async function redisDel(key) {
  if (!REDIS_URL || !REDIS_TOKEN) return false;
  const r = await fetch(`${REDIS_URL}/del/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  });
  return r.ok;
}

function normalizeUpstream(data = {}) {
  const activo = (data.activo === true) || String(data.activo).toLowerCase() === 'true';
  const institucion = data.institucion || data.org || '';
  const tipoRaw = data.tipoInstitucion || data.tipo || '';
  const tipoInstitucion = String(tipoRaw || '').toLowerCase();
  const correoSOS = data.correoSOS || data.sos || '';
  return { ok: true, activo, institucion, tipoInstitucion, correoSOS };
}

async function callUpstream(codigo, timeoutMs = 8000) {
  if (!GAS_VERIFY_URL) return { ok: false, status: 0, data: null, raw: null };
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(GAS_VERIFY_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo }), signal: ctrl.signal
    });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
    return { ok: res.ok, status: res.status, data, raw: text };
  } finally { clearTimeout(id); }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders() });

  // Parseo
  let body = {};
  if (req.method === 'GET') {
    const { searchParams } = new URL(req.url);
    body.codigo = searchParams.get('codigo') || '';
    body.refresh = searchParams.get('refresh');
  } else if (req.method === 'POST') {
    body = await req.json().catch(() => ({}));
  } else {
    return json(req, 405, { ok: false, motivo: 'Método no permitido' });
  }

  const codigo = normCodigo(body.codigo);
  if (!codigo) return json(req, 200, { ok: false, motivo: 'Código requerido' });

  const licKey = `lic:code:${codigo}`;

  // Refresh admin
  const refreshQuery = typeof body.refresh === 'string' ? body.refresh : (new URL(req.url)).searchParams.get('refresh');
  const wantRefresh = (refreshQuery === '1' || refreshQuery === 'true' || body.refresh === true);
  const adminHeader = req.headers.get('X-Admin-Key') || '';

  if (wantRefresh) {
    if (!ADMIN_KEY || adminHeader !== ADMIN_KEY) return json(req, 200, { ok: false, motivo: 'Unauthorized refresh' });
    await redisDel(licKey);
    const up = await callUpstream(codigo);
    if (up.ok && up.data) {
      const norm = normalizeUpstream(up.data);
      const ttl = norm.activo ? CACHE_TTL_POS_S : CACHE_TTL_NEG_S;
      const payload = { ...norm, codigo };
      await redisSetEx(licKey, payload, ttl);
      return json(req, 200, payload, { 'Aurea-Cache': 'REFRESH:upstream' });
    }
    const neg = { ok: true, activo: false, motivo: 'Código inválido o inactivo', codigo };
    await redisSetEx(licKey, neg, CACHE_TTL_NEG_S);
    return json(req, 200, neg, { 'Aurea-Cache': 'REFRESH:upstream-error' });
  }

  // Normal flow
  try {
    const cached = await redisGet(licKey);
    if (cached && cached.ok === true) {
      return json(req, 200, { ...cached, codigo }, { 'Aurea-Cache': 'HIT:redis' });
    }

    const up = await callUpstream(codigo);
    if (up.ok && up.data && (up.data.ok === true || typeof up.data.activo !== 'undefined')) {
      const norm = normalizeUpstream(up.data);
      const ttl = norm.activo ? CACHE_TTL_POS_S : CACHE_TTL_NEG_S;
      const payload = { ...norm, codigo };
      await redisSetEx(licKey, payload, ttl);
      return json(req, 200, payload, { 'Aurea-Cache': 'MISS:upstream-ok' });
    }

    const neg = { ok: true, activo: false, motivo: 'Código inválido o inactivo', codigo };
    await redisSetEx(licKey, neg, CACHE_TTL_NEG_S);
    return json(req, 200, neg, { 'Aurea-Cache': 'MISS:upstream-error' });

  } catch (err) {
    const neg = { ok: true, activo: false, motivo: 'Código inválido o inactivo', codigo, error: String(err) };
    await redisSetEx(licKey, neg, CACHE_TTL_NEG_S);
    return json(req, 200, neg, { 'Aurea-Cache': 'MISS:error' });
  }
}
