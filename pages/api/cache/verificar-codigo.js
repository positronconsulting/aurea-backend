// pages/api/cache/verificar-codigo.js
// Upstash (via @vercel/kv) con namespaces + versionado global + SWR + invalidación puntual o total

import { kv } from '@vercel/kv';

const LICENCIAS_URL = 'https://script.google.com/macros/s/AKfycbzvlZIbTZEBR03VwnDyYdoX3WXFe8cd0zKsR4W-SxxJqozo4ek9wYyIbtEJKNznV10VJg/exec';
const TTL_SEC = 60 * 60;                 // 60 min "fresh"
const ADMIN_KEY = process.env.AUREA_ADMIN_KEY || '';
const CACHE_VERSION_KEY = 'aurea:cacheVersion';

async function fetchJSON(url, body, timeoutMs = 9000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort('timeout'), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch(_){}
    return { okHTTP: r.ok, status: r.status, text, json };
  } catch (err) {
    return { okHTTP:false, status:0, text:String(err), json:null };
  } finally {
    clearTimeout(id);
  }
}

// Helpers de llaves con versionado global
async function getCacheVersion() {
  let v = await kv.get(CACHE_VERSION_KEY);
  if (!v) { v = 1; await kv.set(CACHE_VERSION_KEY, v); }
  return parseInt(v, 10) || 1;
}
function keyFor(version, codigo){ return `aurea:codigo:${version}:${codigo}`; }
function staleKeyFor(version, codigo){ return `aurea:codigo:${version}:${codigo}:staleUntil`; }

export default async function handler(req, res) {
  // CORS solo para tu dominio Wix
  res.setHeader('Access-Control-Allow-Origin', 'https://www.positronconsulting.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, motivo:'Method not allowed' });

  const body = req.body || {};
  const adminKey = req.headers['x-admin-key'] || body.adminKey || '';

  // 🔐 Admin: invalidación puntual o total
  if (adminKey && adminKey === ADMIN_KEY) {
    const invalidate = (body.invalidate === true || body.invalidate === 'true');
    const invalidateAll = (body.invalidateAll === true || body.invalidateAll === 'true');

    if (invalidateAll) {
      const v = await getCacheVersion();
      await kv.set(CACHE_VERSION_KEY, v + 1); // subir versión global invalida TODO
      return res.status(200).json({ ok:true, invalidatedAll: true, newVersion: v + 1 });
    }

    if (invalidate) {
      const cod = String(body.codigo || '').trim().toUpperCase();
      if (!cod) return res.status(200).json({ ok:false, motivo:'Código vacío o inválido' });
      const v = await getCacheVersion();
      await kv.del(keyFor(v, cod));
      await kv.del(staleKeyFor(v, cod));
      return res.status(200).json({ ok:true, invalidated: cod });
    }
  }

  // Verificación normal
  const codigo = String(body.codigo || '').trim().toUpperCase();
  if (!codigo) return res.status(200).json({ ok:false, motivo:'Código vacío o inválido' });

  const nowSec = Math.floor(Date.now() / 1000);
  const v = await getCacheVersion();
  const cacheKey = keyFor(v, codigo);
  const staleKey = staleKeyFor(v, codigo);

  // 1) HIT / STALE
  const cached = await kv.get(cacheKey);
  const staleUntil = parseInt((await kv.get(staleKey)) || '0', 10);

  if (cached) {
    if (staleUntil && nowSec < staleUntil) {
      res.setHeader('AUREA-Cache', 'HIT');
      return res.status(200).json(cached);
    }
    // STALE: responder rápido y revalidar en background
    res.setHeader('AUREA-Cache', 'STALE');
    queueMicrotask(async () => {
      const r = await fetchJSON(LICENCIAS_URL, { codigo, yaRegistrado:false, intencionRegistro:false }, 9000);
      if (r.okHTTP && r.json) {
        const data = (r.json.acceso === true)
          ? {
              ok: true,
              tipoInstitucion: String(r.json.tipoInstitucion || '').toLowerCase(),
              institucion: r.json.institucion || '',
              correoSOS: r.json.correoSOS || ''
            }
          : { ok:false, motivo: r.json.motivo || 'Acceso no permitido' };
        await kv.set(cacheKey, data, { ex: TTL_SEC * 2 });   // 120 min
        await kv.set(staleKey, nowSec + TTL_SEC);            // 60 min fresh
      }
    });
    return res.status(200).json(cached);
  }

  // 2) MISS → consulta a GAS y setea caché
  const r = await fetchJSON(LICENCIAS_URL, { codigo, yaRegistrado:false, intencionRegistro:false }, 9000);
  if (!r.okHTTP || !r.json) {
    return res.status(200).json({ ok:false, motivo:`Fallo de verificación (${r.status})`, error:r.text || '' });
  }

  const data = (r.json.acceso === true)
    ? {
        ok: true,
        tipoInstitucion: String(r.json.tipoInstitucion || '').toLowerCase(),
        institucion: r.json.institucion || '',
        correoSOS: r.json.correoSOS || ''
      }
    : { ok:false, motivo: r.json.motivo || 'Acceso no permitido' };

  await kv.set(cacheKey, data, { ex: TTL_SEC * 2 });
  await kv.set(staleKey, nowSec + TTL_SEC);
  res.setHeader('AUREA-Cache', 'MISS');
  return res.status(200).json(data);
}

