// pages/api/orquestador.js — versión optimizada (verificaciones en paralelo)
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://www.positronconsulting.com';
const VERIFY_CODE_URL = process.env.VERIFY_CODE_URL || 'https://aurea-backend-two.vercel.app/api/cache/verificar-codigo';
const GAS_VER_USER_URL = process.env.AUREA_GAS_VERIFICAR_USUARIO_URL; // ← ya apunta al GAS /exec directo
const ANALIZAR_TEST_URL = process.env.ANALIZAR_TEST_URL || 'https://aurea-backend-two.vercel.app/api/analizar-test';
const AUREA_INTERNAL_TOKEN = (process.env.AUREA_INTERNAL_TOKEN || '').trim();
const GAS_PERFIL_URL = process.env.GAS_PERFIL_URL || ''; // opcional

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function json(res, status, obj) { res.status(status).json(obj); }
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function fetchJSON(url, {body, timeoutMs=9000}) {
  const ctrl = new AbortController(); const id = setTimeout(()=>ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(body||{}),
      signal: ctrl.signal
    });
    const text = await r.text().catch(()=> '');
    let j=null; try{ j = JSON.parse(text); }catch(_){}
    return { okHTTP:r.ok, status:r.status, json:j, text };
  } catch (e) {
    return { okHTTP:false, status:0, json:null, text:String(e) };
  } finally { clearTimeout(id); }
}

async function withRetry(fn, retries=1, backoff=250){
  let last=null;
  for(let i=0;i<=retries;i++){
    const res = await fn();
    if (res && (res.okHTTP || res.json)) return res;
    last = res;
    if (i<retries) await wait(backoff*(i+1));
  }
  return last;
}

export default async function handler(req, res){
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return json(res, 405, { ok:false, error:'Method Not Allowed' });

  const { action } = req.query || {};
  if ((action||'').toLowerCase() !== 'login') {
    return json(res, 400, { ok:false, error:'Acción inválida' });
  }

  const email  = String(req.body?.email  || '').trim().toLowerCase();
  const codigo = String(req.body?.codigo || '').trim().toUpperCase();
  if (!email || !codigo || !email.includes('@')) {
    return json(res, 200, { ok:false, acceso:false, motivo:'Parámetros inválidos' });
  }

  // 🔹 Lanzamos AMBAS verificaciones en paralelo (cada una con 1 reintento)
  const [licPromise, verPromise] = [
    withRetry(()=>fetchJSON(VERIFY_CODE_URL, { body:{ codigo }, timeoutMs:9000 }), 1),
    withRetry(()=>fetchJSON(GAS_VER_USER_URL, { body:{ correo: email, codigo }, timeoutMs:9000 }), 1),
  ];

  const [lic, ver] = await Promise.all([licPromise, verPromise]);

  // --- Manejo de licencia ---
  if (!lic?.okHTTP || !lic?.json?.ok) {
    return json(res, 200, { ok:false, acceso:false, motivo: lic?.json?.motivo || `Fallo verificación de código (${lic?.status||0})` });
  }
  const licData = lic.json; // { ok, tipoInstitucion, institucion, correoSOS, codigo }

  // --- Manejo de GAS usuario ---
  if (!ver?.okHTTP || !ver?.json) {
    return json(res, 200, { ok:false, acceso:false, motivo:`Fallo verificación usuario (${ver?.status||0})`, error:ver?.text||'' });
  }
  const v = ver.json;

  // Guardarraíl: si GAS dice acceso:true pero el código guardado no coincide -> negar
  const userCode = String(v?.usuario?.codigo || '').trim().toUpperCase();
  if (v?.acceso === true && userCode && userCode !== codigo) {
    return json(res, 200, { ok:false, acceso:false, motivo:'El código no corresponde a este usuario' });
  }
  if (v?.acceso !== true) {
    return json(res, 200, { ok:false, acceso:false, motivo: v?.motivo || 'Usuario no autorizado' });
  }

  // Armar usuario
  const u = v.usuario || {};
  const usuario = {
    nombre: (u.nombre||'').trim(),
    apellido: (u.apellido||'').trim(),
    sexo: u.sexo || '',
    fechaNacimiento: u.fechaNacimiento || '',
    email,
    telefono: u.telefono || '',
    correoEmergencia: u.correoEmergencia || '',
    codigo,
    institucion: v.institucion || licData.institucion || '',
    tipoInstitucion: (v.tipoInstitucion || licData.tipoInstitucion || '').toLowerCase(),
    correoSOS: v.correoSOS || licData.correoSOS || ''
  };

  // (Opcional) perfil emocional
  let perfilEmocional = null;
  if (GAS_PERFIL_URL) {
    const pe = await fetchJSON(GAS_PERFIL_URL, { body:{ email, tipoInstitucion: usuario.tipoInstitucion }, timeoutMs:8000 });
    if (pe?.okHTTP && pe?.json?.ok && pe?.json?.perfil) perfilEmocional = pe.json.perfil;
  }

  // Disparo en background a analizar-test (no bloqueante)
  (async () => {
    try {
      if (!AUREA_INTERNAL_TOKEN) return;
      await fetch(ANALIZAR_TEST_URL, {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'X-Internal-Token': AUREA_INTERNAL_TOKEN },
        body: JSON.stringify({ tipoInstitucion: usuario.tipoInstitucion, email, correoSOS: usuario.correoSOS || '', codigo })
      }).catch(()=>{});
    } catch {}
  })();

  return json(res, 200, {
    ok:true,
    acceso:true,
    usuario: { ...usuario, perfilEmocional: perfilEmocional || null },
    institucion: usuario.institucion,
    tipoInstitucion: usuario.tipoInstitucion,
    correoSOS: usuario.correoSOS
  });
}
