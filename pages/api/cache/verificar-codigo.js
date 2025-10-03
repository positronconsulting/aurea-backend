// pages/api/cache/verificar-codigo.js
// Valida código contra GAS_LICENCIAS y cachea en Upstash (TTL 300s)

export const config = { runtime: 'edge' };

const GAS_LICENCIAS = process.env.GAS_LICENCIAS;
const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function upstashGet(key) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  const r = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  if (!r.ok) return null;
  const data = await r.json().catch(() => null);
  return data?.result ? JSON.parse(data.result) : null;
}

async function upstashSetEx(key, value, ttlSec = 300) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return;
  await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}?EX=${ttlSec}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    method: 'POST'
  }).catch(() => {});
}

function json(resBody, status = 200) {
  return new Response(JSON.stringify(resBody), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

export default async function handler(req) {
  try {
    if (req.method !== 'POST') return json({ ok:false, motivo:'Método no permitido' }, 405);
    if (!GAS_LICENCIAS) return json({ ok:false, motivo:'Falta GAS_LICENCIAS' }, 500);

    const body = await req.json().catch(() => ({}));
    const codigo = String(body?.codigo || '').trim().toUpperCase();
    if (!codigo) return json({ ok:false, motivo:'Código vacío o inválido' }, 400);

    const cacheKey = `lic:${codigo}`;
    const cached = await upstashGet(cacheKey);
    if (cached) return json(cached, 200);

    // Consulta a GAS de Licencias
    const gasRes = await fetch(GAS_LICENCIAS, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ codigo })
    });

    const text = await gasRes.text();
    let data; try { data = JSON.parse(text); } catch { data = null; }
    if (!gasRes.ok || !data) {
      return json({ ok:false, motivo:`Fallo GAS (${gasRes.status})`, error:text?.slice(0,200) || '' }, 502);
    }

    // GAS responde { acceso, institucion, tipoInstitucion, correoSOS } ó { acceso:false, motivo }
    if (data.acceso !== true) {
      const resp = { ok:false, motivo: data.motivo || 'Código no válido' };
      // (Opcional) cache corto de negativos para evitar hammering
      await upstashSetEx(cacheKey, resp, 30);
      return json(resp, 200);
    }

    const tipo = String(data.tipoInstitucion || '').toLowerCase();
    const respOk = {
      ok: true,
      tipoInstitucion: tipo,            // 'social' | 'empresa' | 'educacion'
      institucion: data.institucion || '',
      correoSOS: data.correoSOS || '',
      codigo
    };

    await upstashSetEx(cacheKey, respOk, 300); // 5 minutos
    return json(respOk, 200);

  } catch (err) {
    return json({ ok:false, motivo:'Error servidor', error: String(err?.message || err).slice(0,200) }, 500);
  }
}
