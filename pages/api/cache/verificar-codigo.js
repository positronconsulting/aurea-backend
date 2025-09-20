// pages/api/cache/verificar-codigo.js
// KV compartido (@vercel/kv) + versionado global + SWR + invalidación puntual/total
// Maneja el 302 de GAS: POST a /exec → si 302, GET a Location
// Incluye telemetría silenciosa a un GAS (no bloquea la respuesta)

import { kv } from '@vercel/kv';

const LICENCIAS_URL = 'https://script.google.com/macros/s/AKfycbzvlZIbTZEBR03VwnDyYdoX3WXFe8cd0zKsR4W-SxxJqozo4ek9wYyIbtEJKNznV10VJg/exec'; // GAS Licencias (tu URL)
const TELEMETRIA_URL = 'https://script.google.com/macros/s/AKfycbyqV0EcaUb_o8c91zF4kJ7Spm2gX4ofSXcwGaN-_yzz14wgnuiNeGwILIQIKwfvzOSW1Q/exec'; // <-- Pega aquí tu GAS de telemetría

const TTL_SEC = 60 * 60; // 60 min "fresh"
const ADMIN_KEY = process.env.AUREA_ADMIN_KEY || '';
const CACHE_VERSION_KEY = 'aurea:cacheVersion';

// --- fetch que respeta el flujo de GAS (POST → 302 → GET)
async function fetchJSON(url, body, timeoutMs = 18000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort('timeout'), timeoutMs);
  try {
    // 1) POST al /exec
    let r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      redirect: 'manual',          // no sigas auto
      signal: ctrl.signal
    });

    // 2) Si 301/302/303 → GET a Location (sin body)
    if ([301, 302, 303].includes(r.status)) {
      const loc = r.headers.get('location');
      if (loc) {
        r = await fetch(loc, { method: 'GET', signal: ctrl.signal });
      }
    }

    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch (_) {}
    return { okHTTP: r.ok, status: r.status, text, json };
  } catch (err) {
    return { okHTTP: false, status: 0, text: String(err), json: null };
  } finally {
    clearTimeout(id);
  }
}

// --- helpers de caché versionado
async function getCacheVersion() {
  let v = await kv.get(CACHE_VERSION_KEY);
  if (!v) { v = 1; await kv.set(CACHE_VERSION_KEY, v); }
  return parseInt(v, 10) || 1;
}
function keyFor(version, codigo) { return `aurea:codigo:${version}:${codigo}`; }
function staleKeyFor(version, codigo) { return `aurea:codigo:${version}:${codigo}:staleUntil`; }

// --- telemetría silenciosa
async function logTelemetry({ codigo, cacheHeader, ok, motivo, tiempoMs }) {
  if (!TELEMETRIA_URL) return;
  try {
    await fetch(TELEMETRIA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fecha: new Date().toISOString(),
        codigo,
        cache: cacheHeader || 'NONE',
        motivo: motivo || '',
        ok: !!ok,
        tiempoMs: Math.max(0, tiempoMs | 0)
      })
    });
  } catch (_) { /* nunca romper respuesta por telemetría */ }
}

export default async function handler(req, res) {
  const start = Date.now();

  // CORS solo tu dominio
  res.setHeader('Access-Control-Allow-Origin', 'https://www.positronconsulting.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, motivo: 'Method not allowed' });

  const body = req.body || {};
  const adminKey = req.headers['x-admin-key'] || body.adminKey || '';

  // 🔐 Admin: invalidación puntual o total
  if (adminKey && adminKey === ADMIN_KEY) {
    const invalidate = (body.invalidate === true || body.invalidate === 'true');
    const invalidateAll = (body.invalidateAll === true || body.invalidateAll === 'true');

    if (invalidateAll) {
      const v = await getCacheVersion();
      await kv.set(CACHE_VERSION_KEY, v + 1); // invalida TODO
      const data = { ok: true, invalidatedAll: true, newVersion: v + 1 };
      await logTelemetry({
        codigo: 'ALL',
        cacheHeader: 'ADMIN',
        ok: true,
        motivo: 'invalidateAll',
        tiempoMs: Date.now() - start
      });
      return res.status(200).json(data);
    }
    if (invalidate) {
      const cod = String(body.codigo || '').trim().toUpperCase();
      if (!cod) {
        const data = { ok: false, motivo: 'Código vacío o inválido' };
        await logTelemetry({
          codigo: '',
          cacheHeader: 'ADMIN',
          ok: false,
          motivo: data.motivo,
          tiempoMs: Date.now() - start
        });
        return res.status(200).json(data);
      }
      const v = await getCacheVersion();
      await kv.del(keyFor(v, cod));
      await kv.del(staleKeyFor(v, cod));
      const data = { ok: true, invalidated: cod };
      await logTelemetry({
        codigo: cod,
        cacheHeader: 'ADMIN',
        ok: true,
        motivo: 'invalidate',
        tiempoMs: Date.now() - start
      });
      return res.status(200).json(data);
    }
  }

  // Verificación normal
  const codigo = String(body.codigo || '').trim().toUpperCase();
  if (!codigo) {
    const data = { ok: false, motivo: 'Código vacío o inválido' };
    await logTelemetry({
      codigo: '',
      cacheHeader: 'NONE',
      ok: false,
      motivo: data.motivo,
      tiempoMs: Date.now() - start
    });
    return res.status(200).json(data);
  }

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
      await logTelemetry({
        codigo,
        cacheHeader: 'HIT',
        ok: cached?.ok ?? true,
        motivo: cached?.motivo || '',
        tiempoMs: Date.now() - start
      });
      return res.status(200).json(cached);
    }
    // STALE → responde rápido y revalida en background
    res.setHeader('AUREA-Cache', 'STALE');
    queueMicrotask(async () => {
      let r = await fetchJSON(LICENCIAS_URL, { codigo, yaRegistrado: false, intencionRegistro: false }, 18000);
      if ((!r.okHTTP || !r.json) && /timeout|aborted/i.test(r.text || '')) {
        await new Promise((rs) => setTimeout(rs, 200 + Math.floor(Math.random() * 300)));
        r = await fetchJSON(LICENCIAS_URL, { codigo, yaRegistrado: false, intencionRegistro: false }, 18000);
      }
      if (r.okHTTP && r.json) {
        const fresh = (r.json.acceso === true)
          ? {
              ok: true,
              tipoInstitucion: String(r.json.tipoInstitucion || '').toLowerCase(),
              institucion: r.json.institucion || '',
              correoSOS: r.json.correoSOS || ''
            }
          : { ok: false, motivo: r.json.motivo || 'Acceso no permitido' };
        await kv.set(cacheKey, fresh, { ex: TTL_SEC * 2 });   // 120m
        await kv.set(staleKey, nowSec + TTL_SEC);             // 60m fresh
      }
    });
    await logTelemetry({
      codigo,
      cacheHeader: 'STALE',
      ok: cached?.ok ?? true,
      motivo: cached?.motivo || '',
      tiempoMs: Date.now() - start
    });
    return res.status(200).json(cached);
  }

  // 2) MISS → consulta GAS (con un reintento breve si timeout)
  let r = await fetchJSON(LICENCIAS_URL, { codigo, yaRegistrado: false, intencionRegistro: false }, 18000);
  if ((!r.okHTTP || !r.json) && /timeout|aborted/i.test(r.text || '')) {
    await new Promise((rs) => setTimeout(rs, 200 + Math.floor(Math.random() * 300)));
    r = await fetchJSON(LICENCIAS_URL, { codigo, yaRegistrado: false, intencionRegistro: false }, 18000);
  }
  if (!r.okHTTP || !r.json) {
    const data = { ok: false, motivo: `Fallo de verificación (${r.status})`, error: r.text || '' };
    res.setHeader('AUREA-Cache', 'MISS');
    await logTelemetry({
      codigo,
      cacheHeader: 'MISS',
      ok: false,
      motivo: data.motivo,
      tiempoMs: Date.now() - start
    });
    return res.status(200).json(data);
  }

  const data = (r.json.acceso === true)
    ? {
        ok: true,
        tipoInstitucion: String(r.json.tipoInstitucion || '').toLowerCase(),
        institucion: r.json.institucion || '',
        correoSOS: r.json.correoSOS || ''
      }
    : { ok: false, motivo: r.json.motivo || 'Acceso no permitido' };

  await kv.set(cacheKey, data, { ex: TTL_SEC * 2 });
  await kv.set(staleKey, nowSec + TTL_SEC);
  res.setHeader('AUREA-Cache', 'MISS');

  await logTelemetry({
    codigo,
    cacheHeader: 'MISS',
    ok: data?.ok ?? false,
    motivo: data?.motivo || '',
    tiempoMs: Date.now() - start
  });
  return res.status(200).json(data);
}
