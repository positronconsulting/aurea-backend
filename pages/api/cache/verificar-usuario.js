// ✅ Verificar USUARIO: lee Redis "materializado" primero; fallback a GAS; negative/positive cache.
// Respuesta normalizada: { ok, acceso, yaRegistrado, usuario, institucion, tipoInstitucion, correoSOS }

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://www.positronconsulting.com';
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const CACHE_TTL_POS_S = parseInt(process.env.CACHE_TTL_POS_S || '3600', 10); // 1h positivos
const CACHE_TTL_NEG_S = parseInt(process.env.CACHE_TTL_NEG_S || '600', 10);  // 10m negativos

// GAS (Web App /exec) — se toma de env, no hardcode
const GAS_URL = (process.env.GAS_EXEC_BASE_URL || process.env.AUREA_GAS_EXEC_URL || '').trim();

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function json(res, status, obj, cacheHeader) {
  if (cacheHeader) res.setHeader('Aurea-Cache', cacheHeader);
  res.status(status).json(obj);
}
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('TIMEOUT')), ms);
    promise.then(v => { clearTimeout(id); resolve(v); })
           .catch(e => { clearTimeout(id); reject(e); });
  });
}
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
async function redisSetEx(key, value, ttlSec) {
  if (!REDIS_URL || !REDIS_TOKEN) return;
  try {
    const body = new URLSearchParams();
    body.set('value', JSON.stringify(value));
    body.set('ex', String(ttlSec));
    await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
  } catch {}
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return json(res, 200, { ok: true, ping: 'verificar-usuario', method: 'GET' }, 'PING');
  if (req.method !== 'POST') return json(res, 405, { ok: false, motivo: 'Método no permitido' });

  if (!GAS_URL) {
    return json(res, 200, { ok:false, acceso:false, motivo:'Falta configurar GAS_EXEC_BASE_URL' }, 'CONFIG');
  }

  const correo = String(req.body?.correo || '').trim().toLowerCase();
  const codigo = String(req.body?.codigo || '').trim().toUpperCase();
  if (!correo || !codigo || !correo.includes('@')) {
    return json(res, 200, { ok: false, acceso: false, motivo: 'Parámetros inválidos' });
  }

  // 1) Intento de respuestas ya cacheadas por par correo+codigo (decision cache)
  const keyDecision = `verifUsuario:${correo}:${codigo}`;
  const cachedDecision = await redisGet(keyDecision);
  if (cachedDecision) return json(res, 200, cachedDecision, 'HIT:decision');

  // 2) Leer "BD materializada" en Redis
  const usrKey = `usr:email:${correo}`;
  const licKey = `lic:code:${codigo}`;
  const [usr, lic] = await Promise.all([redisGet(usrKey), redisGet(licKey)]);

  if (usr && lic) {
    let out = null;
    if (!lic.activo) {
      out = { ok:true, acceso:false, motivo:'Código inválido o inactivo' };
      await redisSetEx(keyDecision, out, CACHE_TTL_NEG_S);
      return json(res, 200, out, 'HIT:redis-users-lics');
    }
    if (!usr.codigo) {
      out = {
        ok:true, acceso:false, motivo:'El usuario no tiene código registrado', yaRegistrado:true,
        institucion: lic.institucion || '', tipoInstitucion: (lic.tipoInstitucion||'').toLowerCase(),
        correoSOS: lic.correoSOS || '', tienePendiente:false, usuario: { ...usr, codigo:'' }
      };
      await redisSetEx(keyDecision, out, CACHE_TTL_NEG_S);
      return json(res, 200, out, 'HIT:redis-users-lics');
    }
    if (String(usr.codigo||'').toUpperCase() !== codigo) {
      out = {
        ok:true, acceso:false, motivo:'El código no corresponde a este usuario', yaRegistrado:true,
        institucion: lic.institucion || '', tipoInstitucion: (lic.tipoInstitucion||'').toLowerCase(),
        correoSOS: lic.correoSOS || '', tienePendiente:false, usuario: { ...usr, codigo: String(usr.codigo||'').toUpperCase() }
      };
      await redisSetEx(keyDecision, out, CACHE_TTL_NEG_S);
      return json(res, 200, out, 'HIT:redis-users-lics');
    }
    // OK:
    out = {
      ok:true, acceso:true, yaRegistrado:true,
      institucion: lic.institucion || '', tipoInstitucion: (lic.tipoInstitucion||'').toLowerCase(),
      correoSOS: lic.correoSOS || '', tienePendiente:false,
      usuario: {
        nombre: usr.nombre||'', apellido: usr.apellido||'', sexo: usr.sexo||'',
        fechaNacimiento: usr.fechaNacimiento||'', email: usr.email||correo,
        telefono: usr.telefono||'', correoEmergencia: usr.correoEmergencia||'',
        codigo, testYaEnviado: false
      }
    };
    await redisSetEx(keyDecision, out, CACHE_TTL_POS_S);
    return json(res, 200, out, 'HIT:redis-users-lics');
  }

  // 3) Fallback a GAS (y luego escribimos claves en Redis)
  try {
    const r = await withTimeout(
      fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo, codigo })
      }),
      10000
    );

    const text = await r.text().catch(() => '');
    let data = null; try { data = text ? JSON.parse(text) : null; } catch {}

    if (!r.ok) {
      const out = { ok: false, acceso: false, motivo: `Fallo verificación (${r.status})`, error: text?.slice(0,200) };
      return json(res, 200, out, 'MISS:fallback-error');
    }
    if (!data || data.ok !== true) {
      const out = { ok: false, acceso: false, motivo: 'Respuesta inválida de GAS' };
      return json(res, 200, out, 'MISS:fallback-bad');
    }

    // Calentar "BD materializada" si el GAS nos dio info
    if (data.usuario && data.usuario.email) {
      const uo = data.usuario;
      await redisSetEx(`usr:email:${(uo.email||'').toLowerCase()}`, {
        email:(uo.email||'').toLowerCase(),
        nombre:uo.nombre||'', apellido:uo.apellido||'', sexo:uo.sexo||'',
        fechaNacimiento:uo.fechaNacimiento||'', telefono:uo.telefono||'',
        correoEmergencia:uo.correoEmergencia||'', codigo:String(uo.codigo||'').toUpperCase(),
        updatedAt: Date.now()
      }, CACHE_TTL_POS_S);
    }
    if (data.institucion || data.tipoInstitucion || data.correoSOS || codigo) {
      await redisSetEx(`lic:code:${codigo}`, {
        codigo, institucion: data.institucion||'', tipoInstitucion:(data.tipoInstitucion||'').toLowerCase(),
        activo: true, correoSOS: data.correoSOS||'', updatedAt: Date.now()
      }, CACHE_TTL_POS_S);
    }

    // Guardar decisión (neg/pos)
    const ttlDecision = data.acceso === true ? CACHE_TTL_POS_S : CACHE_TTL_NEG_S;
    await redisSetEx(keyDecision, data, ttlDecision);

    return json(res, 200, data, 'MISS:fallback-gas');
  } catch (err) {
    const msg = String(err?.message || err);
    const out = { ok: false, acceso: false, motivo: (msg === 'TIMEOUT' ? 'Timeout verificar-usuario (10s)' : 'Error verificar-usuario'), error: msg };
    return json(res, 200, out, 'MISS:timeout');
  }
}
