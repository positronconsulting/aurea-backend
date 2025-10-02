// pages/api/orquestador.js
// Orquestador único AUREA (registro, login, chat, finalizar, diag_gas)
// ENV requeridas (Vercel):
// FRONTEND_ORIGIN=https://www.positronconsulting.com
// OPENAI_API_KEY=...
// UPSTASH_REDIS_REST_URL=...
// UPSTASH_REDIS_REST_TOKEN=...
// SENDGRID_API_KEY=...
// GAS_VERIFY_URL=...
// GAS_UPDATE_PROFILE_URL=...
// GAS_LOGS_URL=...
// GAS_TEMAS_URL=...
// GAS_HISTORIAL_URL=...
// GAS_TELEMETRIA_URL=...

export default async function handler(req, res) {
  const ORIGIN = process.env.FRONTEND_ORIGIN || 'https://www.positronconsulting.com';
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Debug, X-Debug-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido' });

  const t0 = Date.now();
  const action = (req.query && req.query.action) || (req.body && req.body.action) || null;
  const body = req.body || {};
  const routeLabel = `orq/${action || 'none'}`;

  // --- Helpers ---
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  async function fetchTimeout(url, options = {}, timeoutMs = 12000, retries = 1, backoff = 500) {
    for (let i = 0; i <= retries; i++) {
      const ctrl = new AbortController();
      const id = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetch(url, { ...options, signal: ctrl.signal });
        clearTimeout(id);
        if (!r.ok && (r.status >= 500 || r.status === 429)) throw new Error(`HTTP ${r.status}`);
        return r;
      } catch (e) {
        clearTimeout(id);
        if (i === retries) throw e;
        await wait(backoff * Math.pow(2, i));
      }
    }
  }

  // --- Redis ---
  const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
  const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  const TTL_MAIN = 60 * 60;
  const TTL_BACKUP = 24 * 60 * 60;

  async function rGet(key) {
    if (!REDIS_URL || !REDIS_TOKEN) return null;
    const r = await fetch(`${REDIS_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    const j = await r.json();
    if (j?.result == null) return null;
    try { return JSON.parse(j.result); } catch { return j.result; }
  }
  async function rSet(key, value, ttlSec = TTL_MAIN) {
    if (!REDIS_URL || !REDIS_TOKEN) return false;
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    await fetch(`${REDIS_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(payload)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    await fetch(`${REDIS_URL}/expire/${encodeURIComponent(key)}/${ttlSec}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    return true;
  }

  // --- GAS ---
  const GAS = {
    VERIFY: process.env.GAS_VERIFY_URL,
    UPDATE: process.env.GAS_UPDATE_PROFILE_URL,
    LOGS: process.env.GAS_LOGS_URL,
    TEMAS: process.env.GAS_TEMAS_URL,
    HIST: process.env.GAS_HISTORIAL_URL,
    TEL: process.env.GAS_TELEMETRIA_URL
  };

  // --- Fallback de temas locales ---
  const DEFAULT_TEMAS = {
    social: (process.env.DEFAULT_TEMAS_SOCIAL || 'Ansiedad|Depresión|Estrés|Autoestima|Relaciones|Duelo|Ira|Hábitos|Sueño|Motivación|Comunicación')
      .split('|').map(s => s.trim()).filter(Boolean),
    empresa: (process.env.DEFAULT_TEMAS_EMPRESA || 'Burnout|Estrés laboral|Liderazgo|Trabajo en equipo|Comunicación|Productividad|Conflictos|Cambio|Motivación|Toma de decisiones|Tiempo')
      .split('|').map(s => s.trim()).filter(Boolean),
    educacion: (process.env.DEFAULT_TEMAS_EDUCACION || 'Ansiedad académica|Procrastinación|Hábitos de estudio|Sueño|Atención|Memoria|Autoeficacia|Relaciones|Bullying|Autocuidado|Motivación')
      .split('|').map(s => s.trim()).filter(Boolean),
  };

  async function obtenerTemas(tipoInstitucion) {
    const key = `temas:${String(tipoInstitucion || '').toLowerCase()}`;
    let temas = await rGet(key);
    if (Array.isArray(temas) && temas.length) return temas;

    try {
      if (GAS.TEMAS) {
        const r = await fetchTimeout(GAS.TEMAS, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tipoInstitucion })
        }, 12000, 1);
        let data = null;
        try { data = await r.json(); } catch {}
        let lista = [];
        if (Array.isArray(data?.temas)) lista = data.temas;
        else if (Array.isArray(data?.lista)) lista = data.lista;
        else if (data && typeof data === 'object') {
          const k = String(tipoInstitucion || '').toLowerCase();
          if (Array.isArray(data[k])) lista = data[k];
        }
        lista = (lista || []).map(x => String(x || '').trim()).filter(Boolean);
        if (lista.length) {
          await rSet(key, lista, TTL_MAIN);
          return lista;
        }
      }
    } catch (_) {}

    const fb = DEFAULT_TEMAS[String(tipoInstitucion || '').toLowerCase()] || [];
    if (fb.length) await rSet(key, fb, TTL_MAIN);
    return fb;
  }

  // --- Diagnóstico GAS ---
  if (action === 'diag_gas') {
    const out = {};
    async function probe(name, url, sampleBody) {
      if (!url) { out[name] = { ok:false, error:'ENV missing' }; return; }
      try {
        const r = await fetchTimeout(url, {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify(sampleBody || {})
        }, 8000, 0);
        const text = await r.text();
        out[name] = { status: r.status, ok: r.ok, body: text.slice(0, 300) };
      } catch (e) {
        out[name] = { ok:false, error: e?.message || String(e) };
      }
    }
    await probe('GAS_TEMAS', GAS.TEMAS, { tipoInstitucion: 'social' });
    await probe('GAS_VERIFY', GAS.VERIFY, { email: 'diag@aurea', codigo: 'TEST' });
    await probe('GAS_UPDATE', GAS.UPDATE, { modo:'PING' });
    await probe('GAS_LOGS', GAS.LOGS, { ping:true });
    await probe('GAS_HIST', GAS.HIST, { ping:true });
    await probe('GAS_TEL', GAS.TEL, { ping:true });
    return res.status(200).json({ ok:true, diag: out });
  }

  // -------------------------
  // El resto de tu lógica (registro, login, chat, finalizar) se queda igual
  // -------------------------

  return res.status(400).json({ ok: false, error: 'action inválida' });
}

