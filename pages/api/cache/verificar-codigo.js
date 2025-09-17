// pages/api/cache/verificar-codigo.js
// Valida un código institucional con caché, forwarding a Licencias GAS.

const LICENCIAS_URL = 'https://script.google.com/macros/s/AKfycbzvlZIbTZEBR03VwnDyYdoX3WXFe8cd0zKsR4W-SxxJqozo4ek9wYyIbtEJKNznV10VJg/exec';

const codeCache = new Map(); // code -> { data, exp }
const TTL_MS = 5 * 60 * 1000; // 5 min

function now(){ return Date.now(); }

async function fetchJSON(url, body, timeoutMs = 8000) {
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, motivo:'Method not allowed' });

  const codigo = String(req.body?.codigo || '').trim().toUpperCase();
  if (!codigo) return res.status(400).json({ ok:false, motivo:'Código vacío o inválido' });

  const cached = codeCache.get(codigo);
  if (cached && cached.exp > now()) {
    res.setHeader('AUREA-Cache', 'HIT');
    return res.status(200).json(cached.data);
  }

  const r = await fetchJSON(LICENCIAS_URL, { codigo, yaRegistrado:false, intencionRegistro:false }, 9000);
  if (!r.okHTTP || !r.json) {
    return res.status(200).json({ ok:false, motivo:`Fallo de verificación (${r.status})`, error:r.text || '' });
  }

  const data = (r.json.acceso === true)
    ? { ok:true, tipoInstitucion:String(r.json.tipoInstitucion || '').toLowerCase(), institucion:r.json.institucion || '', correoSOS:r.json.correoSOS || '' }
    : { ok:false, motivo:r.json.motivo || 'Acceso no permitido' };

  codeCache.set(codigo, { data, exp: now() + TTL_MS });
  res.setHeader('AUREA-Cache', 'MISS');
  return res.status(200).json(data);
}
