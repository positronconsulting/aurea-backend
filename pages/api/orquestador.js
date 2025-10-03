// pages/api/orquestador.js
// Orquestador de login (CORS + verificación de código + verificación de usuario + disparo de análisis)
// Alineado con: verificar-codigo (cache/licencias), verificar-usuario (GAS), analizar-test (Vercel)

// ============================
// 🔧 Config (variables de entorno)
// ============================
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'https://www.positronconsulting.com';

// Endpoints existentes (ya los tienes):
// - Licencias / cache (Vercel): pages/api/cache/verificar-codigo.js
const VERIFY_CODE_URL = process.env.VERIFY_CODE_URL || 'https://aurea-backend-two.vercel.app/api/cache/verificar-codigo';
// - Verificación de usuario (GAS) proxied en Vercel o directo a GAS si prefieres:
const GAS_VER_USER_URL = process.env.AUREA_GAS_VERIFICAR_USUARIO_URL;
// - Perfil emocional por email (opcional, si tienes un GAS que devuelva columnas B..P):
const GAS_PERFIL_URL = process.env.GAS_PERFIL_URL || ''; // si no lo tienes aún, deja vacío y lo omitimos
// - Analizar test (tu endpoint local ya existente)
const ANALIZAR_TEST_URL = process.env.ANALIZAR_TEST_URL || 'https://aurea-backend-two.vercel.app/api/analizar-test';
// - Token interno para /analizar-test
const AUREA_INTERNAL_TOKEN = (process.env.AUREA_INTERNAL_TOKEN || '').trim();

// ============================
// 🛠 Utilidades
// ============================
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, status, obj) {
  res.status(status).json(obj);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJSON(url, { method = 'POST', headers = {}, body = {}, timeoutMs = 10000 } = {}) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: method === 'GET' ? undefined : JSON.stringify(body || {}),
      signal: ctrl.signal
    });
    const text = await r.text().catch(() => '');
    let j = null; try { j = JSON.parse(text); } catch (_e) {}
    return { okHTTP: r.ok, status: r.status, text, json: j };
  } catch (err) {
    return { okHTTP: false, status: 0, text: String(err), json: null };
  } finally {
    clearTimeout(id);
  }
}

// ============================
// 🚪 Handler principal
// ============================
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return json(res, 405, { ok:false, error:'Method Not Allowed' });

  const { action } = req.query || {};
  if (String(action || '').toLowerCase() !== 'login') {
    return json(res, 400, { ok:false, error:'Acción inválida' });
  }

  const email  = String(req.body?.email  || '').trim().toLowerCase();
  const codigo = String(req.body?.codigo || '').trim().toUpperCase();
  if (!email || !codigo || !email.includes('@')) {
    return json(res, 200, { ok:false, acceso:false, motivo:'Parámetros inválidos' });
  }

  // 1) Verificar CÓDIGO (licencias) – usa tu endpoint cache/verificar-codigo (con Upstash)
  //    (No re-implementamos lógica; solo consumimos)
  //    Ref: archivo "verificar-codigo.js" (Edge + cache Upstash)
  //    ✔️ Devuelve: { ok:true, tipoInstitucion, institucion, correoSOS, codigo } si válido
  let lic = null;
  for (let i = 0; i < 2; i++) {
    lic = await fetchJSON(VERIFY_CODE_URL, { body: { codigo }, timeoutMs: 9000 });
    if (lic?.okHTTP && lic?.json) break;
    await sleep(300);
  }
  if (!lic?.okHTTP || !lic?.json?.ok) {
    return json(res, 200, {
      ok: false, acceso: false,
      motivo: lic?.json?.motivo || `Fallo verificación de código (${lic?.status || 0})`
    });
  }
  const licData = lic.json; // esperado: ok, tipoInstitucion, institucion, correoSOS, codigo  // :contentReference[oaicite:4]{index=4}

  // 2) Verificar USUARIO vs GAS (tu único punto de verdad)
  //    Ref: "verificar-usuario.js" (proxy a GAS + guardarraíl de código)
  //    ✔️ Esperamos { ok:true, acceso:true, usuario:{...}, tipoInstitucion, institucion, correoSOS }
  let ver = null;
  for (let i = 0; i < 2; i++) {
    ver = await fetchJSON(GAS_VER_USER_URL, { body: { correo: email, codigo }, timeoutMs: 9000 });
    if (ver?.okHTTP && ver?.json) break;
    await sleep(300);
  }
  if (!ver?.okHTTP || !ver?.json) {
    return json(res, 200, {
      ok:false, acceso:false,
      motivo:`Fallo verificación usuario (${ver?.status || 0})`, error: ver?.text || ''
    });
  }
  const v = ver.json; // :contentReference[oaicite:5]{index=5}

  // Guardarraíl: si GAS dice acceso:true pero el código guardado no coincide -> negar (igual que tu proxy)
  const userCode = String(v?.usuario?.codigo || '').trim().toUpperCase();
  if (v?.acceso === true && userCode && userCode !== codigo) {
    return json(res, 200, { ok:false, acceso:false, motivo:'El código no corresponde a este usuario' });
  }

  if (v?.acceso !== true) {
    return json(res, 200, { ok:false, acceso:false, motivo: v?.motivo || 'Usuario no autorizado' });
  }

  // 3) Armar usuario y (opcional) traer perfil emocional de las hojas Social/Empresa/Educacion
  const u = v.usuario || {};
  const usuario = {
    nombre: (u.nombre || '').trim(),
    apellido: (u.apellido || '').trim(),
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

  let perfilEmocional = null;
  if (GAS_PERFIL_URL) {
    // Este GAS debe devolver las columnas B..P para el email (según Social/Empresa/Educacion que corresponda).
    // Si aún no lo tienes, deja GAS_PERFIL_URL en blanco y este paso se omite.
    const pe = await fetchJSON(GAS_PERFIL_URL, {
      body: { email, tipoInstitucion: usuario.tipoInstitucion },
      timeoutMs: 9000
    });
    if (pe?.okHTTP && pe?.json?.ok && pe?.json?.perfil) {
      perfilEmocional = pe.json.perfil;
    }
  }

  // 4) Disparar análisis en background si pudiera faltar "X" en AW
  //    No bloqueamos el login. /analizar-test hará la verificación fina y marcará AW+licencia.
  //    Ref: "analizar-test.js" (usa su propio GAS para detectar pendiente, marcar X y enviar correos)
  //    Body esperado por /analizar-test: { tipoInstitucion, email, correoSOS, codigo } + X-Internal-Token
  (async () => {
    try {
      if (!AUREA_INTERNAL_TOKEN) return; // sin token, no disparamos
      await fetch(ANALIZAR_TEST_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': AUREA_INTERNAL_TOKEN
        },
        body: JSON.stringify({
          tipoInstitucion: usuario.tipoInstitucion,
          email,
          correoSOS: usuario.correoSOS || '',
          codigo
        })
      }).catch(() => {});
    } catch { /* silencioso */ }
  })(); // :contentReference[oaicite:6]{index=6}

  // 5) Responder a /login exactamente como espera tu código
  //    (ver procesoLogin.txt: guarda nombre, edad, institucion, tipoInstitucion, SOS, emergencia, perfilEmocional, etc.)
  return json(res, 200, {
    ok: true,
    acceso: true,
    usuario: {
      ...usuario,
      perfilEmocional: perfilEmocional || null
    },
    institucion: usuario.institucion,
    tipoInstitucion: usuario.tipoInstitucion,
    correoSOS: usuario.correoSOS
  });
}
