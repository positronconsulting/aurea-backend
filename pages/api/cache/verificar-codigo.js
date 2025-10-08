// /api/cache/verificar-codigo.js
// Versión robusta con:
// - Header Aurea-Upstream para depurar a qué URL pegó
// - Manejo correcto de refresh & cache
// - Normalización tolerante (tipoInstitucion variantes) y activo por defecto
// - Nunca marca "inactivo" por error de upstream: reporta ok:false

export const config = { runtime: 'edge' };

const ALLOWED_ORIGIN = 'https://www.positronconsulting.com';
const GAS_VERIFY_URL = process.env.GAS_VERIFY_URL; // <-- AJUSTA EN VERCEL
const ADMIN_KEY = process.env.AUREA_ADMIN_KEY || '';

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

async function upstashGet(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  // upstash REST devuelve { result: "..." }
  if (!json || typeof json.result === 'undefined') return null;
  try { return JSON.parse(json.result); } catch { return json.result; }
}

async function upstashSetEx(key, value, ttlSec = 600) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return;
  await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}?EX=${ttlSec}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  }).catch(() => {});
}

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
    ...extra,
  };
}

function jsonResponse(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

function normalizeUpstream(data = {}, codigo = '') {
  // Variantes aceptadas
  const tipoRaw =
    data.tipoInstitucion ??
    data.tipo_institucion ??
    data.TipoInstitucion ??
    data.TIPO_INSTITUCION ??
    data.tipo ??
    data.Tipo ??
    '';

  const tipoInstitucion = String(tipoRaw || '').toLowerCase().trim();

  const institucion = data.institucion || data.org || '';
  const correoSOS = data.correoSOS ?? data.sos ?? data.correo_sos ?? '';

  // El upstream "bueno" no manda 'activo'. Regla:
  // activo = true si ok:true y tipoInstitucion válido; si no, false.
  const ok = data.ok === true;
  const activo =
    typeof data.activo === 'boolean'
      ? data.activo
      : (ok && !!tipoInstitucion);

  return {
    ok: true,
    activo,
    tipoInstitucion,
    institucion,
    correoSOS,
    codigo,
  };
}

async function fetchUpstream(codigo, signal) {
  if (!GAS_VERIFY_URL) {
    throw new Error('GAS_VERIFY_URL not configured');
  }

  const res = await fetch(GAS_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Upstream ${res.status}`);
    err.meta = { status: res.status, body: text.slice(0, 500) };
    throw err;
  }
  const json = await res.json();
  return json;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  // Permitir GET simple para health-check
  if (req.method === 'GET') {
    return jsonResponse(200, { ok: true, service: 'verificar-codigo', upstream: !!GAS_VERIFY_URL });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method Not Allowed' });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { ok: false, error: 'Invalid JSON body' });
  }

  const codigo = String(body?.codigo || '').trim();
  if (!codigo) {
    return jsonResponse(400, { ok: false, error: 'Missing "codigo"' });
  }

  const url = new URL(req.url);
  const wantsRefresh = url.searchParams.get('refresh') === '1';

  // Si piden refresh, validar llave
  if (wantsRefresh) {
    const adminKey = req.headers.get('x-admin-key') || '';
    if (!ADMIN_KEY || adminKey !== ADMIN_KEY) {
      return jsonResponse(
        401,
        { ok: false, error: 'Unauthorized refresh' },
        { 'Aurea-Cache': 'REFRESH:unauthorized' }
      );
    }
  }

  const cacheKey = `aurea:codigo:${codigo}`;
  if (!wantsRefresh) {
    const cached = await upstashGet(cacheKey);
    if (cached && cached.ok) {
      return jsonResponse(200, cached, { 'Aurea-Cache': 'HIT:redis' });
    }
  }

  // Llamar upstream con timeout
  let upstreamJson;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 12_000);

  try {
    upstreamJson = await fetchUpstream(codigo, ac.signal);
  } catch (err) {
    clearTimeout(t);
    const meta = err?.meta || {};
    // Importante: NO marcar inactivo por error de upstream.
    // Devolvemos ok:false para que el cliente distinga “error” de “código inválido”.
    return jsonResponse(
      200,
      { ok: false, error: 'upstream_error', details: meta, codigo },
      {
        'Aurea-Cache': wantsRefresh ? 'REFRESH:upstream-error' : 'MISS:upstream-error',
        'Aurea-Upstream': GAS_VERIFY_URL || 'undefined',
      }
    );
  } finally {
    clearTimeout(t);
  }

  // Normalizar
  const normalized = normalizeUpstream(upstreamJson, codigo);

  // Si upstream explícitamente dijo ok:false o no hay tipoInstitucion, puede ser inválido
  if (upstreamJson.ok === false || !normalized.tipoInstitucion) {
    // Cachear negativo por poco tiempo (evita golpes) y responder
    await upstashSetEx(cacheKey, { ok: true, activo: false, motivo: 'Código inválido o inactivo', codigo }, 120);
    return jsonResponse(
      200,
      { ok: true, activo: false, motivo: 'Código inválido o inactivo', codigo },
      {
        'Aurea-Cache': wantsRefresh ? 'REFRESH:upstream-ok-negative' : 'MISS:upstream-ok-negative',
        'Aurea-Upstream': GAS_VERIFY_URL || 'undefined',
      }
    );
  }

  // Cachear positivo
  await upstashSetEx(cacheKey, normalized, 600);
  return jsonResponse(
    200,
    normalized,
    {
      'Aurea-Cache': wantsRefresh ? 'REFRESH:upstream-ok' : 'MISS:upstream-ok',
      'Aurea-Upstream': GAS_VERIFY_URL || 'undefined',
    }
  );
}

