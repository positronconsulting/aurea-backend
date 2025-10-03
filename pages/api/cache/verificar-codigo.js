// pages/api/cache/verificar-codigo.js
// Edge + logs detallados
export const config = { runtime: 'edge' };

const GAS_LICENCIAS = process.env.GAS_LICENCIAS;
const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

function log(step, payload) {
  try { console.log(`[verificar-codigo] ${step}`, payload || {}); } catch {}
}

function json(resBody, status = 200) {
  log('RESPUESTA', { status, resBody });
  return new Response(JSON.stringify(resBody), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

async function upstashGet(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) { log('KV_DISABLED'); return null; }
  const url = `${UPSTASH_URL}/get/${encodeURIComponent(key)}`;
  log('KV_GET', { url, key });
  const r = await fetch(url, { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } });
  const t = await r.text().catch(() => '');
  log('KV_GET_RES', { status: r.status, text: t?.slice(0, 300) });
  if (!r.ok) return null;
  let j = null; try { j = JSON.parse(t); } catch {}
  let val = null; try { val = j?.result ? JSON.parse(j.result) : null; } catch {}
  log('KV_GET_PARSED', { hit: !!val });
  return val;
}

async function upstashSetEx(key, value, ttlSec = 300) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) { log('KV_DISABLED_SET'); return; }
  const url = `${UPSTASH_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}?EX=${ttlSec}`;
  log('KV_SET', { url, key, ttlSec });
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } }).catch(e => ({ ok:false, status:0, error:String(e) }));
  log('KV_SET_RES', { ok: r?.ok, status: r?.status });
}

export default async function handler(req) {
  log('ENTRY', { method: req.method, GAS_LICENCIAS: !!GAS_LICENCIAS, hasKV: !!UPSTASH_URL && !!UPSTASH_TOKEN });
  try {
    if (req.method !== 'POST') return json({ ok:false, motivo:'Método no permitido' }, 405);
    if (!GAS_LICENCIAS)       return json({ ok:false, motivo:'Falta GAS_LICENCIAS' }, 500);

    // 1) Body → código
    let bodyRaw = '';
    try { bodyRaw = await req.text(); } catch {}
    log('BODY_RAW', { bodyRaw: bodyRaw?.slice(0, 500) });

    let body = null; try { body = JSON.parse(bodyRaw || '{}'); } catch {}
    log('BODY_JSON', { body });

    const codigo = String(body?.codigo || '').trim().toUpperCase();
    log('CODIGO_NORMALIZADO', { codigo });
    if (!codigo) return json({ ok:false, motivo:'Código vacío o inválido' }, 400);

    // 2) Cache
    const cacheKey = `lic:${codigo}`;
    const cached = await upstashGet(cacheKey);
    if (cached) {
      log('CACHE_HIT', { cacheKey, cached });
      return json(cached, 200);
    }
    log('CACHE_MISS', { cacheKey });

    // 3) Llamada a GAS
    log('GAS_POST', { url: GAS_LICENCIAS, codigo });
    const gasRes = await fetch(GAS_LICENCIAS, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ codigo })
    });

    const gasStatus = gasRes.status;
    const gasText = await gasRes.text().catch(() => '');
    log('GAS_RES', { status: gasStatus, text: gasText?.slice(0, 1000) });

    let gasJson = null; try { gasJson = JSON.parse(gasText); } catch {}
    log('GAS_JSON', { parsed: !!gasJson, gasJson });

    if (!gasRes.ok || !gasJson) {
      const r = { ok:false, motivo:`Fallo GAS (${gasStatus})`, error: gasText?.slice(0, 500) || '' };
      log('GAS_FAIL', r);
      return json(r, 502);
    }

    // 4) Validación final y armado de respuesta
    if (gasJson.acceso !== true) {
      const r = { ok:false, motivo: gasJson.motivo || 'Código no válido' };
      log('NEGATIVE_VALIDATION', r);
      await upstashSetEx(cacheKey, r, 30); // cache corto de negativos
      return json(r, 200);
    }

    const tipo = String(gasJson.tipoInstitucion || '').toLowerCase();
    const respOk = {
      ok: true,
      tipoInstitucion: tipo,                   // 'social' | 'empresa' | 'educacion'
      institucion: gasJson.institucion || '',
      correoSOS: gasJson.correoSOS || '',
      codigo
    };
    log('OK_RESPONSE', respOk);

    await upstashSetEx(cacheKey, respOk, 300); // 5 min
    return json(respOk, 200);

  } catch (err) {
    const r = { ok:false, motivo:'Error servidor', error: String(err?.message || err).slice(0, 500) };
    log('FATAL', r);
    return json(r, 500);
  }
}
