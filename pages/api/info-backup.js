// /pages/api/info-backup.js
const ORIGIN = process.env.FRONTEND_ORIGIN || 'https://www.positronconsulting.com';

const GAS_UPDATE_PROFILE_URL = process.env.GAS_UPDATE_PROFILE_URL
  || 'https://script.google.com/macros/s/AKfycbx9aufQ1sH_VUZ3Ihmec1srGaZmOhpF3DBDVyrzg3wOOLUNpp_qLFJ_caUxr5pyzmu_1w/exec';

const GAS_LOG_CALIFICACIONES_URL = process.env.GAS_LOG_CALIFICACIONES_URL
  || 'https://script.google.com/macros/s/AKfycbxX1DxhOCvnYJx--A-HsS0n6c-NSThpu67HX7-KCY5IMaVUGHQZGBmXui0xgfQHFZmizw/exec';

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Internal-Token');
}
function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}
async function postJSON(url, data, timeoutMs = 12000, extraHeaders = {}) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(data || {}),
      signal: ctrl.signal,
    });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    return { okHTTP: r.ok, status: r.status, j, text };
  } finally { clearTimeout(id); }
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(200).json({ ok:false, motivo:'POST only' });

  const b = parseBody(req);
  const op = String(b.op || '').toLowerCase();

  try {
    if (op === 'perfil-guardar') {
      if (!GAS_UPDATE_PROFILE_URL) return res.status(200).json({ ok:false, error:'GAS_UPDATE_PROFILE_URL vacío' });
      const r = await postJSON(GAS_UPDATE_PROFILE_URL, b.payload || {}, 15000);
      return res.status(200).json({ ok: !!r.okHTTP, detalle:r.text || '', j:r.j || null });
    }

    if (op === 'log-calificacion') {
      const r = await postJSON(GAS_LOG_CALIFICACIONES_URL, b.payload || {}, 12000);
      return res.status(200).json({ ok: !!r.okHTTP, detalle:r.text || '', j:r.j || null });
    }

    if (op === 'temas11') {
      const tipo = String(b.tipoInstitucion || '').toLowerCase();
      // Puedes mover esto a Sheets si lo prefieres; por ahora devuelvo un set común de 11
      const comunes = [
        'Suicidios','Depresión','Ansiedad','Violencia Intrafamiliar','Aislamiento Social',
        'Burnout','Abuso sexual','Violencia de Género','Psicosis','Trastornos de Conducta','Consumo Sustancias'
      ];
      return res.status(200).json({ ok:true, tipo, temas: comunes });
    }

    return res.status(200).json({ ok:false, motivo:'op inválida' });
  } catch (err) {
    return res.status(200).json({ ok:false, error:String(err).slice(0,300) });
  }
}

