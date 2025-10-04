// api/cache/perfil-usuario.js
// Cachea el perfil emocional por email en Redis (Upstash).
// Llama a GAS (POST) si no existe en cache y guarda con TTL largo (180 días).

export const config = {
  runtime: 'edge'
};

const ORIGIN = process.env.FRONTEND_ORIGIN || '*';
const GAS_URL = process.env.GAS_PERFIL_USUARIO_URL;

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// TTL: 180 días
const PROFILE_TTL_SECONDS = 60 * 60 * 24 * 180;

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=0, must-revalidate',
    ...extra
  };
}

function normalizeTipo(tipoRaw) {
  const s = String(tipoRaw || '').trim().toLowerCase();
  if (s === 'empresa')   return 'Empresa';
  if (s === 'social')    return 'Social';
  if (s === 'educacion' || s === 'educación') return 'Educacion';
  // si ya viene capitalizado correcto, respétalo
  if (['Empresa','Social','Educacion'].includes(String(tipoRaw))) return String(tipoRaw);
  return 'Social'; // fallback conservador
}

async function redisGet(key) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  const url = `${REDIS_URL}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function redisSet(key, value, ttlSeconds) {
  if (!REDIS_URL || !REDIS_TOKEN) return false;
  const url = `${REDIS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}?EX=${ttlSeconds}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
  return res.ok;
}

async function callGASPerfil({ email, tipoInstitucion, nombre, institucion }, timeoutMs = 12000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = {
      correo: String(email || '').toLowerCase().trim(),
      tipoInstitucion: normalizeTipo(tipoInstitucion),
      nombre: String(nombre || '').trim(),
      institucion: String(institucion || '').trim()
    };
    const res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* noop */ }
    return { status: res.status, data, raw: text };
  } finally {
    clearTimeout(id);
  }
}

export default async function handler(req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders() });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, motivo: 'Método no permitido' }), {
      status: 405,
      headers: corsHeaders()
    });
  }

  try {
    const { email, tipoInstitucion, nombre, institucion } = await req.json().catch(() => ({}));

    const correo = String(email || '').toLowerCase().trim();
    if (!correo) {
      return new Response(JSON.stringify({ ok: false, motivo: 'Email requerido' }), {
        status: 200,
        headers: corsHeaders()
      });
    }

    const key = `prof:email:${correo}`;

    // 1) Intento cache
    const cached = await redisGet(key);
    if (cached && cached.perfilEmocional) {
      return new Response(JSON.stringify({ ok: true, ...cached }), {
        status: 200,
        headers: corsHeaders({ 'Aurea-Cache': 'HIT:perfil' })
      });
    }

    // 2) MISS → llamar GAS
    if (!GAS_URL) {
      return new Response(JSON.stringify({ ok: false, motivo: 'GAS_PERFIL_USUARIO_URL no configurado' }), {
        status: 200,
        headers: corsHeaders({ 'Aurea-Cache': 'MISS:no-gas' })
      });
    }

    const resp = await callGASPerfil({ email: correo, tipoInstitucion, nombre, institucion }, 12000);

    if (!resp.data || resp.data.ok !== true) {
      return new Response(JSON.stringify({
        ok: false,
        motivo: 'Fallo perfil',
        error: resp.raw || null
      }), {
        status: 200,
        headers: corsHeaders({ 'Aurea-Cache': 'MISS:gas-fail' })
      });
    }

    // Armar documento estándar para almacenar
    const perfilEmocional = {
      nombre: resp.data.nombre || '',
      institucion: resp.data.institucion || '',
      temas: Array.isArray(resp.data.temas) ? resp.data.temas : [],
      calificaciones: resp.data.calificaciones || {},
      ts: Date.now()
    };

    const payload = { perfilEmocional };

    // 3) Guardar en cache
    await redisSet(key, payload, PROFILE_TTL_SECONDS);

    return new Response(JSON.stringify({ ok: true, ...payload }), {
      status: 200,
      headers: corsHeaders({ 'Aurea-Cache': 'MISS:seeded' })
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, motivo: 'Error interno', error: String(err) }), {
      status: 200,
      headers: corsHeaders({ 'Aurea-Cache': 'MISS:error' })
    });
  }
}
