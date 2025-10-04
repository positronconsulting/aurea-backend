// /api/orquestador.js — orquesta el login con un único endpoint (para Wix)
// Intenta primero tu wrapper cacheado (verificar-usuario) y si no, cae a GAS.
// Responde SIEMPRE 200 con estructura estable para Wix.

export const config = { runtime: 'edge' };

const ORIGIN = process.env.FRONTEND_ORIGIN || '*';

// 1) Wrapper cacheado (recomendado): /api/cache/verificar-usuario (Vercel)
// 2) Fallback directo: GAS_EXEC_BASE_URL (GAS verificarUsuarioYCodigo)
const VERIFY_USUARIO_URL =
  process.env.AUREA_GAS_VERIFICAR_USUARIO_URL || // apunta a /api/cache/verificar-usuario
  process.env.GAS_EXEC_BASE_URL ||                // último recurso: GAS /exec
  '';

function cors(extra = {}) {
  return {
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=0, must-revalidate',
    ...extra,
  };
}

function j200(obj, extra) {
  return new Response(JSON.stringify(obj), { status: 200, headers: cors(extra) });
}

async function postJSON(url, data, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data || {}),
      signal: ctrl.signal,
    });
    const txt = await res.text();
    let json = null;
    try { json = txt ? JSON.parse(txt) : null; } catch {}
    return { okHttp: res.ok, json, status: res.status, raw: txt };
  } finally {
    clearTimeout(t);
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors() });

  const url = new URL(req.url);
  const action = (url.searchParams.get('action') || '').toLowerCase();
  if (action !== 'login') return j200({ ok: false, motivo: 'Acción no soportada' });

  let body = {};
  try { body = await req.json(); } catch {}
  const email = String(body.email || '').trim().toLowerCase();
  const codigo = String(body.codigo || '').trim().toUpperCase();
  if (!email || !email.includes('@') || !codigo) {
    return j200({ ok: false, acceso: false, motivo: 'Parámetros inválidos' });
  }
  if (!VERIFY_USUARIO_URL) {
    return j200({ ok: false, acceso: false, motivo: 'Config inválida (VERIFY_USUARIO_URL vacío)' });
  }

  // 1 intento + 1 reintento corto si hay timeout/error
  let resp = null;
  try {
    resp = await postJSON(VERIFY_USUARIO_URL, { correo: email, codigo }, 12000);
    if (!resp.okHttp || !resp.json) throw new Error('bad first attempt');
  } catch {
    try {
      resp = await postJSON(VERIFY_USUARIO_URL, { correo: email, codigo }, 12000);
    } catch {
      return j200({ ok: false, acceso: false, motivo: 'Timeout verificar usuario' });
    }
  }

  const data = resp.json;
  if (!data || data.ok !== true) {
    return j200({ ok: false, acceso: false, motivo: (data && data.motivo) || 'Fallo verificación de usuario' });
  }

  if (data.acceso !== true) {
    return j200({
      ok: false, acceso: false, motivo: data.motivo || 'Acceso denegado',
      institucion: data.institucion || '',
      tipoInstitucion: (data.tipoInstitucion || '').toLowerCase(),
      correoSOS: data.correoSOS || '',
    });
  }

  return j200({
    ok: true, acceso: true,
    usuario: data.usuario || {},
    institucion: data.institucion || '',
    tipoInstitucion: (data.tipoInstitucion || '').toLowerCase(),
    correoSOS: data.correoSOS || '',
  });
}
