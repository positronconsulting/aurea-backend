// /api/cache/verificar-usuario.js (Edge)
// - Acepta {correo, codigo} o {email, codigo}. Case-insensitive.
// - Parsea seguro: JSON o texto (si el cliente manda Content-Type mal).
// - Redis-first (usr + lic + decision), fallback a GAS_EXEC_BASE_URL.
// - Nunca tira 404: siempre 200 con motivo estable.

// ⛳ Runtime
export const config = { runtime: 'edge' };

// 🌍 CORS / headers base
const ORIGIN = process.env.FRONTEND_ORIGIN || 'https://www.positronconsulting.com';
function cors(h = {}) {
  return {
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=0, must-revalidate',
    ...h
  };
}
function j200(obj, h) { return new Response(JSON.stringify(obj), { status: 200, headers: cors(h) }); }
function j405() { return new Response(JSON.stringify({ ok:false, motivo:'Método no permitido' }), { status: 405, headers: cors() }); }

// 🧰 Utils
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const GAS_URL     = (process.env.GAS_EXEC_BASE_URL || '').trim();

const CACHE_TTL_POS_S = parseInt(process.env.CACHE_TTL_POS_S || '3600', 10); // 1h
const CACHE_TTL_NEG_S = parseInt(process.env.CACHE_TTL_NEG_S || '600', 10);  // 10m

async function redisGet(key) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    if (!j || typeof j.result !== 'string' || j.result === 'null') return null;
    try { return JSON.parse(j.result); } catch { return null; }
  } catch { return null; }
}
async function redisSetEx(key, value, exSec) {
  if (!REDIS_URL || !REDIS_TOKEN) return;
  try {
    const body = new URLSearchParams();
    body.set('value', JSON.stringify(value));
    body.set('ex', String(exSec));
    await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });
  } catch {}
}
function normEmail(x)  { return String(x||'').trim().toLowerCase(); }
function normCodigo(x) { return String(x||'').trim().toUpperCase(); }

async function parseBody(req) {
  // Intenta JSON normal
  try {
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const j = await req.json();
      return j && typeof j === 'object' ? j : {};
    }
  } catch {}
  // Si no fue JSON, lee como texto e intenta parsear
  try {
    const t = await req.text();
    if (!t) return {};
    try { return JSON.parse(t); } catch { return {}; }
  } catch { return {}; }
}

async function callGAS(correo, codigo, timeoutMs = 10000) {
  if (!GAS_URL) return { okHttp:false, status:0, data:null, raw:null };
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correo, codigo }),
      signal: ctrl.signal
    });
    const raw = await res.text();
    let data = null; try { data = raw ? JSON.parse(raw) : null; } catch {}
    return { okHttp: res.ok, status: res.status, data, raw };
  } finally { clearTimeout(id); }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: cors() });
  if (req.method === 'GET')     return j200({ ok:true, ping:'verificar-usuario', method:'GET' }, { 'Aurea-Cache': 'PING' });
  if (req.method !== 'POST')    return j405();

  // 1) Parsear body robusto
  const body = await parseBody(req);
  // Aceptar correo/email con cualquier casing
  const keys = Object.keys(body || {}).reduce((a,k) => (a[k.toLowerCase()] = body[k], a), {});
  const correo = normEmail(keys.correo || keys.email);
  const codigo = normCodigo(keys.codigo);

  if (!correo || !codigo || !correo.includes('@')) {
    return j200({ ok:false, acceso:false, motivo:'Parámetros inválidos' });
  }

  // 2) Decision cache primero
  const keyDecision = `verifUsuario:${correo}:${codigo}`;
  const dec = await redisGet(keyDecision);
  if (dec) return j200(dec, { 'Aurea-Cache': 'HIT:decision' });

  // 3) Si tenemos usr+lic en cache, resolvemos sin ir a GAS
  const [usr, lic] = await Promise.all([
    redisGet(`usr:email:${correo}`),
    redisGet(`lic:code:${codigo}`)
  ]);

  if (usr && lic) {
    let out = null;
    if (!lic.activo) {
      out = { ok:true, acceso:false, motivo:'Código inválido o inactivo' };
      await redisSetEx(keyDecision, out, CACHE_TTL_NEG_S);
      return j200(out, { 'Aurea-Cache': 'HIT:usr-lic' });
    }
    if (!usr.codigo) {
      out = {
        ok:true, acceso:false, motivo:'El usuario no tiene código registrado', yaRegistrado:true,
        institucion: lic.institucion || '', tipoInstitucion: (lic.tipoInstitucion||'').toLowerCase(),
        correoSOS: lic.correoSOS || '', tienePendiente:false, usuario: { ...usr, codigo:'' }
      };
      await redisSetEx(keyDecision, out, CACHE_TTL_NEG_S);
      return j200(out, { 'Aurea-Cache': 'HIT:usr-lic' });
    }
    if (String(usr.codigo||'').toUpperCase() !== codigo) {
      out = {
        ok:true, acceso:false, motivo:'El código no corresponde a este usuario', yaRegistrado:true,
        institucion: lic.institucion || '', tipoInstitucion: (lic.tipoInstitucion||'').toLowerCase(),
        correoSOS: lic.correoSOS || '', tienePendiente:false,
        usuario: { ...usr, codigo: String(usr.codigo||'').toUpperCase() }
      };
      await redisSetEx(keyDecision, out, CACHE_TTL_NEG_S);
      return j200(out, { 'Aurea-Cache': 'HIT:usr-lic' });
    }
    out = {
      ok:true, acceso:true, yaRegistrado:true,
      institucion: lic.institucion || '', tipoInstitucion: (lic.tipoInstitucion||'').toLowerCase(),
      correoSOS: lic.correoSOS || '', tienePendiente:false,
      usuario: {
        nombre: usr.nombre||'', apellido: usr.apellido||'', sexo: usr.sexo||'',
        fechaNacimiento: usr.fechaNacimiento||'', email: usr.email||correo,
        telefono: usr.telefono||'', correoEmergencia: usr.correoEmergencia||'',
        codigo, testYaEnviado:false
      }
    };
    await redisSetEx(keyDecision, out, CACHE_TTL_POS_S);
    return j200(out, { 'Aurea-Cache': 'HIT:usr-lic' });
  }

  // 4) Fallback a GAS
  try {
    const r = await callGAS(correo, codigo, 10000);
    if (!r.okHttp) {
      return j200({ ok:false, acceso:false, motivo:`Fallo verificación (${r.status||0})`, error:(r.raw||'').slice(0,200) }, { 'Aurea-Cache':'MISS:fallback-error' });
    }
    if (!r.data || r.data.ok !== true) {
      return j200({ ok:false, acceso:false, motivo:'Respuesta inválida de GAS' }, { 'Aurea-Cache':'MISS:fallback-bad' });
    }

    // Calentar materiales
    if (r.data.usuario && r.data.usuario.email) {
      const u = r.data.usuario;
      await redisSetEx(`usr:email:${(u.email||'').toLowerCase()}`, {
        email:(u.email||'').toLowerCase(),
        nombre:u.nombre||'', apellido:u.apellido||'', sexo:u.sexo||'',
        fechaNacimiento:u.fechaNacimiento||'', telefono:u.telefono||'',
        correoEmergencia:u.correoEmergencia||'', codigo:String(u.codigo||'').toUpperCase(),
        updatedAt: Date.now()
      }, CACHE_TTL_POS_S);
    }
    if (r.data.institucion || r.data.tipoInstitucion || r.data.correoSOS || codigo) {
      await redisSetEx(`lic:code:${codigo}`, {
        codigo, institucion:r.data.institucion||'',
        tipoInstitucion:(r.data.tipoInstitucion||'').toLowerCase(),
        activo:true, correoSOS:r.data.correoSOS||'', updatedAt: Date.now()
      }, CACHE_TTL_POS_S);
    }

    const ttl = r.data.acceso === true ? CACHE_TTL_POS_S : CACHE_TTL_NEG_S;
    await redisSetEx(keyDecision, r.data, ttl);
    return j200(r.data, { 'Aurea-Cache':'MISS:fallback-gas' });

  } catch (err) {
    const msg = String(err?.message || err);
    return j200({ ok:false, acceso:false, motivo:(msg==='The user aborted a request.'||msg==='TIMEOUT'?'Timeout verificar-usuario (10s)':'Error verificar-usuario'), error: msg }, { 'Aurea-Cache':'MISS:timeout' });
  }
}
