// ✅ Verificar CÓDIGO: lee Redis "materializado" primero; fallback a upstream; cache 2m negativos/positivos
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://www.positronconsulting.com';
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const CACHE_TTL_POS_S = parseInt(process.env.CACHE_TTL_POS_CODE_S || '120', 10); // 2m
const CACHE_TTL_NEG_S = parseInt(process.env.CACHE_TTL_NEG_CODE_S || '120', 10); // 2m

// Upstream (si quisieras validar contra otro GAS específico de códigos)
const UPSTREAM_URL = process.env.GAS_VERIFY_URL || process.env.GAS_LICENCIAS || '';

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function json(res, status, obj, cacheHeader) {
  if (cacheHeader) res.setHeader('Aurea-Cache', cacheHeader);
  res.status(status).json(obj);
}
function withTimeout(p, ms){ return new Promise((resolve, reject)=>{ const id=setTimeout(()=>reject(new Error('TIMEOUT')), ms); p.then(v=>{clearTimeout(id);resolve(v);}).catch(e=>{clearTimeout(id);reject(e);}); }); }

async function redisGet(key) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
    if (!r.ok) return null;
    const j = await r.json().catch(()=>null);
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
  if (req.method === 'GET') return json(res, 200, { ok: true, ping: 'verificar-codigo', method: 'GET' }, 'PING');
  if (req.method !== 'POST') return json(res, 405, { ok: false, motivo: 'Método no permitido' });

  const codigo = String(req.body?.codigo || '').trim().toUpperCase();
  if (!codigo) return json(res, 200, { ok:false, motivo:'Parámetros inválidos' });

  // 1) Redis materializado
  const licKey = `lic:code:${codigo}`;
  const lic = await redisGet(licKey);
  if (lic) {
    if (!lic.activo) return json(res, 200, { ok:true, motivo:'Código inválido o inactivo', activo:false }, 'HIT:redis');
    return json(res, 200, {
      ok:true, activo:true,
      institucion: lic.institucion || '',
      tipoInstitucion: (lic.tipoInstitucion||'').toLowerCase(),
      correoSOS: lic.correoSOS || '',
      codigo
    }, 'HIT:redis');
  }

  // 2) Fallback a upstream (opcional)
  if (!UPSTREAM_URL) {
    // si no hay upstream definido, devolvemos inválido y cacheamos corto
    const out = { ok:true, motivo:'Código inválido o inactivo', activo:false };
    await redisSetEx(licKey, { ...out, codigo }, CACHE_TTL_NEG_S);
    return json(res, 200, out, 'MISS:no-upstream');
  }

  try {
    const r = await withTimeout(fetch(UPSTREAM_URL, {
      method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ codigo })
    }), 8000);
    const text = await r.text().catch(()=> '');
    let data = null; try { data = text ? JSON.parse(text) : null; } catch {}

    if (!r.ok || !data) {
      const out = { ok:false, motivo: `Fallo verificación de código (${r.status||0})` };
      return json(res, 200, out, 'MISS:upstream-error');
    }

    // Normaliza y escribe en redis
    if (data.activo === false || data.ok === false) {
      const out = { ok:true, motivo:'Código inválido o inactivo', activo:false };
      await redisSetEx(licKey, { ...out, codigo }, CACHE_TTL_NEG_S);
      return json(res, 200, out, 'MISS:upstream-neg');
    }

    const normalized = {
      ok:true,
      activo:true,
      institucion: data.institucion || '',
      tipoInstitucion: (data.tipoInstitucion || '').toLowerCase(),
      correoSOS: data.correoSOS || '',
      codigo
    };
    await redisSetEx(licKey, normalized, CACHE_TTL_POS_S);
    return json(res, 200, normalized, 'MISS:upstream-pos');
  } catch (err) {
    const msg = String(err?.message || err);
    return json(res, 200, { ok:false, motivo: (msg==='TIMEOUT'?'Timeout verificar-codigo (8s)':'Error verificar-codigo'), error: msg }, 'MISS:timeout');
  }
}
