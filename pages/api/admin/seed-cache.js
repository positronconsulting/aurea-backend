// ✅ Seed de Upstash con toda la BD (codigos + usuarios) desde GAS export
const ADMIN_KEY = (process.env.AUREA_ADMIN_KEY || '').trim();
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://www.positronconsulting.com';
const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

// Preferencia: si hay GAS_EXPORT_URL la usamos tal cual.
// Si no, construimos desde GAS_EXEC_BASE_URL + ?action=export&key=...
const GAS_EXPORT_URL = (process.env.GAS_EXPORT_URL || '').trim();
const GAS_EXEC_BASE_URL = (process.env.GAS_EXEC_BASE_URL || '').trim();

const TTL_OK_S  = parseInt(process.env.SEED_TTL_OK_SECONDS || '86400', 10); // 24h
const TTL_NEG_S = parseInt(process.env.SEED_TTL_NEG_SECONDS || '600', 10);  // 10m (por si luego guardas negativos)

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

  let exportUrl = GAS_EXPORT_URL;
  if (!exportUrl) {
    if (!GAS_EXEC_BASE_URL) {
      return json(res, 500, { ok:false, motivo:'GAS_EXPORT_URL o GAS_EXEC_BASE_URL no configurados' });
    }
    exportUrl = `${GAS_EXEC_BASE_URL}?action=export&key=${encodeURIComponent(ADMIN_KEY)}`;
  }

  const dumpRes = await fetch(exportUrl);
  const dumpText = await dumpRes.text().catch(()=> '');
  let dump = null; try { dump = JSON.parse(dumpText); } catch {}
  if (!dumpRes.ok || !dump?.ok) return json(res, 200, { ok:false, motivo:'Dump inválido', error: dumpText?.slice(0,200) });

  const { codigos = [], usuarios = [] } = dump;
  let okL=0, okU=0;

  for (const c of codigos) {
    const keyL = `lic:code:${(c.codigo||'').toUpperCase()}`;
    await redisSetEx(keyL, { ...c, updatedAt: Date.now() }, TTL_OK_S);
    okL++;
  }
  for (const u of usuarios) {
    const keyU = `usr:email:${(u.email||'').toLowerCase()}`;
    await redisSetEx(keyU, { ...u, updatedAt: Date.now() }, TTL_OK_S);
    okU++;
  }

  return json(res, 200, { ok:true, seededLicencias: okL, seededUsuarios: okU, ts: Date.now() });
}
