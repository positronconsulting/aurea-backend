// ✅ pages/api/admin/seed-cache.js — baja dump del GAS y puebla Upstash
const ADMIN_KEY = (process.env.AUREA_ADMIN_KEY || '').trim();
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://www.positronconsulting.com';
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const GAS_EXPORT_URL = process.env.GAS_EXPORT_URL || ''; // ej: https://.../exec?action=export&key=XXXX
const TTL_OK_S  = parseInt(process.env.SEED_TTL_OK_SECONDS || '86400', 10); // 24h para positivos
const TTL_NEG_S = parseInt(process.env.SEED_TTL_NEG_SECONDS || '600', 10);  // 10m para negativos (si los metes)

function cors(res){
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');
}
function json(res, status, obj){ res.status(status).json(obj); }

async function redisSetEx(key, value, ttlSec) {
  if(!REDIS_URL||!REDIS_TOKEN) throw new Error('Upstash no configurado');
  const body = new URLSearchParams();
  body.set('value', JSON.stringify(value));
  body.set('ex', String(ttlSec));
  const r = await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!r.ok) throw new Error('fallo redis set');
}

export default async function handler(req, res){
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return json(res, 405, { ok:false, motivo:'Method Not Allowed' });

  const key = req.headers['x-admin-key'] || req.query.key || '';
  if (!ADMIN_KEY || key !== ADMIN_KEY) return json(res, 401, { ok:false, motivo:'Unauthorized' });
  if (!GAS_EXPORT_URL) return json(res, 500, { ok:false, motivo:'GAS_EXPORT_URL no configurado' });

  const dumpRes = await fetch(GAS_EXPORT_URL);
  const dumpText = await dumpRes.text().catch(()=> '');
  let dump = null; try { dump = JSON.parse(dumpText); } catch {}
  if (!dumpRes.ok || !dump?.ok) return json(res, 200, { ok:false, motivo:'Dump inválido', error: dumpText?.slice(0,200) });

  const { codigos = [], usuarios = [] } = dump;

  // Esquema de claves:
  // Licencias: lic:code:<CODIGO> -> { codigo, institucion, tipoInstitucion, activo, correoSOS, updatedAt }
  // Usuarios : usr:email:<lower> -> { email, nombre, apellido, sexo, fechaNacimiento, telefono, correoEmergencia, codigo, updatedAt }

  let okL=0, okU=0;

  for (const c of codigos) {
    const keyL = `lic:code:${(c.codigo||'').toUpperCase()}`;
    const val = { ...c, updatedAt: Date.now() };
    await redisSetEx(keyL, val, TTL_OK_S);
    okL++;
  }
  for (const u of usuarios) {
    const keyU = `usr:email:${(u.email||'').toLowerCase()}`;
    const val = { ...u, updatedAt: Date.now() };
    await redisSetEx(keyU, val, TTL_OK_S);
    okU++;
  }

  return json(res, 200, { ok:true, seededLicencias: okL, seededUsuarios: okU, ts: Date.now() });
}
