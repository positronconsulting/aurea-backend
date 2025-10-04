// Serverless (Node) – 30s timeout + 1 retry con backoff
// Ruta: /api/cache/verificar-usuario
//
// Requiere env:
//  - FRONTEND_ORIGIN
//  - UPSTASH_REDIS_REST_URL
//  - UPSTASH_REDIS_REST_TOKEN
//  - GAS_EXEC_BASE_URL (GAS verificarUsuarioYCodigo.gs → POST {correo,codigo})
//
// Respuesta siempre 200 con {ok, acceso, motivo, ...} para no romper el cliente.

const ORIGIN = process.env.FRONTEND_ORIGIN || 'https://www.positronconsulting.com';

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const GAS_URL     = (process.env.GAS_EXEC_BASE_URL || '').trim();

const CACHE_TTL_POS_S = parseInt(process.env.CACHE_TTL_POS_S || '3600', 10); // 1h
const CACHE_TTL_NEG_S = parseInt(process.env.CACHE_TTL_NEG_S || '600', 10);  // 10m

function cors(res, extra = {}) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  Object.entries(extra).forEach(([k, v]) => res.setHeader(k, v));
}
function j200(res, obj, extraHeaders = {}) {
  cors(res, extraHeaders);
  res.status(200).json(obj);
}
function j405(res) {
  cors(res);
  res.status(405).json({ ok: false, motivo: 'Método no permitido' });
}

// -------- Utils --------
function normEmail(x)  { return String(x || '').trim().toLowerCase(); }
function normCodigo(x) { return String(x || '').trim().toUpperCase(); }

async function parseBody(req) {
  // Next/Vercel serverless: puede venir ya parseado como JSON
  if (req.body && typeof req.body === 'object') return req.body;
  const ct = String(req.headers['content-type'] || '');
  try {
    if (ct.includes('application/json')) {
      return req.body || {};
    }
  } catch {}
  // Fallback: leer crudo
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return {}; }
  } catch { return {}; }
  return {};
}

// Upstash REST (GET/SETEX)
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

// Fetch a GAS con timeout y 1 retry
async function callGASWithRetry(correo, codigo) {
  const ATTEMPTS = 2;      // 1 intento + 1 retry
  const TIMEOUT1 = 30000;  // 30s primer intento
  const TIMEOUT2 = 30000;  // 30s segundo intento
  const BACKOFF  = 5000;   // 5s entre intentos

  const attempt = async (ms) => callGAS(correo, codigo, ms);

  let lastErr = null;
  // intento #1
  try {
    const r1 = await attempt(TIMEOUT1);
    if (r1.okHttp && r1.data && r1.data.ok === true) return { ...r1, attempt: 1, timeoutMs: TIMEOUT1 };
    // si HTTP ok pero data inválida, guardamos razón y seguimos a retry
    lastErr = new Error(`Bad data (status=${r1.status})`);
  } catch (e) { lastErr = e; }

  // backoff
  await new Promise(r => setTimeout(r, BACKOFF));

  // intento #2
  try {
    const r2 = await attempt(TIMEOUT2);
    if (r2.okHttp && r2.data && r2.data.ok === true) return { ...r2, attempt: 2, timeoutMs: TIMEOUT2 };
    lastErr = new Error(`Bad data (status=${r2.status})`);
    return { ...r2, attempt: 2, timeoutMs: TIMEOUT2 };
  } catch (e2) {
    lastErr = e2;
    return { okHttp: false, status: 0, data: null, raw: String(e2?.message || e2), attempt: 2, timeoutMs: TIMEOUT2, error: e2 };
  }
}

function abortableFetch(url, opts = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: ctrl.signal })
    .finally(() => clearTimeout(id));
}

async function callGAS(correo, codigo, timeoutMs) {
  if (!GAS_URL) return { okHttp: false, status: 0, data: null, raw: 'Missing GAS_EXEC_BASE_URL' };
  const res = await abortableFetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correo, codigo })
  }, timeoutMs);

  const raw = await res.text();
  let data = null; try { data = raw ? JSON.parse(raw) : null; } catch {}
  return { okHttp: res.ok, status: res.status, data, raw };
}

// ---------- Handler ----------
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return j200(res, null);
  if (req.method === 'GET') return j200(res, { ok: true, ping: 'verificar-usuario', method: 'GET' }, { 'Aurea-Cache': 'PING' });
  if (req.method !== 'POST') return j405(res);

  const started = Date.now();
  try {
    // 1) Parseo robusto
    const body = await parseBody(req);
    const lower = Object.keys(body || {}).reduce((a,k) => (a[k.toLowerCase()] = body[k], a), {});
    const correo = normEmail(lower.correo || lower.email);
    const codigo = normCodigo(lower.codigo);

    if (!correo || !codigo || !correo.includes('@')) {
      return j200(res, { ok: false, acceso: false, motivo: 'Parámetros inválidos' });
    }

    // 2) Decision cache
    const keyDecision = `verifUsuario:${correo}:${codigo}`;
    const dec = await redisGet(keyDecision);
    if (dec) {
      return j200(res, dec, {
        'Aurea-Cache': 'HIT:decision',
        'Aurea-Diag': 'served-from-decision-cache'
      });
    }

    // 3) usr + lic cache
    const [usr, lic] = await Promise.all([
      redisGet(`usr:email:${correo}`),
      redisGet(`lic:code:${codigo}`)
    ]);

    if (usr && lic) {
      let out = null;
      if (!lic.activo) {
        out = { ok: true, acceso: false, motivo: 'Código inválido o inactivo' };
        await redisSetEx(keyDecision, out, CACHE_TTL_NEG_S);
        return j200(res, out, { 'Aurea-Cache': 'HIT:usr-lic', 'Aurea-Diag': 'lic-inactivo' });
      }
      if (!usr.codigo) {
        out = {
          ok: true, acceso: false, motivo: 'El usuario no tiene código registrado', yaRegistrado: true,
          institucion: lic.institucion || '', tipoInstitucion: (lic.tipoInstitucion || '').toLowerCase(),
          correoSOS: lic.correoSOS || '', tienePendiente: false, usuario: { ...usr, codigo: '' }
        };
        await redisSetEx(keyDecision, out, CACHE_TTL_NEG_S);
        return j200(res, out, { 'Aurea-Cache': 'HIT:usr-lic', 'Aurea-Diag': 'usr-sin-codigo' });
      }
      if (String(usr.codigo || '').toUpperCase() !== codigo) {
        out = {
          ok: true, acceso: false, motivo: 'El código no corresponde a este usuario', yaRegistrado: true,
          institucion: lic.institucion || '', tipoInstitucion: (lic.tipoInstitucion || '').toLowerCase(),
          correoSOS: lic.correoSOS || '', tienePendiente: false,
          usuario: { ...usr, codigo: String(usr.codigo || '').toUpperCase() }
        };
        await redisSetEx(keyDecision, out, CACHE_TTL_NEG_S);
        return j200(res, out, { 'Aurea-Cache': 'HIT:usr-lic', 'Aurea-Diag': 'usr-codigo-mismatch' });
      }
      out = {
        ok: true, acceso: true, yaRegistrado: true,
        institucion: lic.institucion || '', tipoInstitucion: (lic.tipoInstitucion || '').toLowerCase(),
        correoSOS: lic.correoSOS || '', tienePendiente: false,
        usuario: {
          nombre: usr.nombre || '', apellido: usr.apellido || '', sexo: usr.sexo || '',
          fechaNacimiento: usr.fechaNacimiento || '', email: usr.email || correo,
          telefono: usr.telefono || '', correoEmergencia: usr.correoEmergencia || '',
          codigo, testYaEnviado: false
        }
      };
      await redisSetEx(keyDecision, out, CACHE_TTL_POS_S);
      return j200(res, out, {
        'Aurea-Cache': 'HIT:usr-lic',
        'Aurea-Diag': 'resolved-from-user-lic-cache'
      });
    }

    // 4) Fallback a GAS (30s + retry)
    const gas = await callGASWithRetry(correo, codigo);

    // Error duro de red / timeout en ambos intentos
    if (!gas.okHttp) {
      return j200(res, {
        ok: false, acceso: false,
        motivo: gas.raw === 'The operation was aborted'
          ? `Timeout verificar-usuario (${gas.timeoutMs}ms)`
          : 'Error verificar-usuario',
        error: gas.raw || 'network-error'
      }, {
        'Aurea-Cache': 'MISS:timeout',
        'Aurea-Diag': 'fallback-gas-failed',
        'Aurea-GAS-URL': GAS_URL,
        'Aurea-GAS-Timeout': String(gas.timeoutMs || 0),
        'Aurea-Attempt': String(gas.attempt || 0)
      });
    }

    // HTTP ok pero data inválida
    if (!gas.data || gas.data.ok !== true) {
      return j200(res, {
        ok: false, acceso: false, motivo: 'Respuesta inválida de GAS'
      }, {
        'Aurea-Cache': 'MISS:fallback-bad',
        'Aurea-Diag': 'fallback-gas-bad-data',
        'Aurea-GAS-Status': String(gas.status),
        'Aurea-Attempt': String(gas.attempt || 0)
      });
    }

    // Calentar caches de apoyo
    try {
      if (gas.data.usuario && gas.data.usuario.email) {
        const u = gas.data.usuario;
        await redisSetEx(`usr:email:${(u.email || '').toLowerCase()}`, {
          email: (u.email || '').toLowerCase(),
          nombre: u.nombre || '', apellido: u.apellido || '', sexo: u.sexo || '',
          fechaNacimiento: u.fechaNacimiento || '', telefono: u.telefono || '',
          correoEmergencia: u.correoEmergencia || '', codigo: String(u.codigo || '').toUpperCase(),
          updatedAt: Date.now()
        }, CACHE_TTL_POS_S);
      }
      if (gas.data.institucion || gas.data.tipoInstitucion || gas.data.correoSOS || codigo) {
        await redisSetEx(`lic:code:${codigo}`, {
          codigo,
          institucion: gas.data.institucion || '',
          tipoInstitucion: (gas.data.tipoInstitucion || '').toLowerCase(),
          activo: true,
          correoSOS: gas.data.correoSOS || '',
          updatedAt: Date.now()
        }, CACHE_TTL_POS_S);
      }
    } catch {}

    const ttl = gas.data.acceso === true ? CACHE_TTL_POS_S : CACHE_TTL_NEG_S;
    await redisSetEx(keyDecision, gas.data, ttl);

    return j200(res, gas.data, {
      'Aurea-Cache': 'MISS:fallback-gas',
      'Aurea-Diag': `fallback-gas-attempt-${gas.attempt||1}`,
      'Aurea-GAS-Status': String(gas.status),
      'Aurea-ElapsedMs': String(Date.now() - started)
    });

  } catch (err) {
    const msg = String(err?.message || err);
    return j200(res, {
      ok: false, acceso: false,
      motivo: msg === 'The operation was aborted'
        ? 'Timeout verificar-usuario (handler)'
        : 'Error verificar-usuario (handler)',
      error: msg
    }, {
      'Aurea-Cache': 'MISS:exception',
      'Aurea-Diag': 'handler-exception'
    });
  }
}
