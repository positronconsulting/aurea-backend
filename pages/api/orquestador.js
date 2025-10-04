// api/orquestador.js  (simplificado al action=login)
// Asegúrate de conservar tu resto de acciones si existen.

export const config = { runtime: 'edge' };

const ORIGIN = process.env.FRONTEND_ORIGIN || '*';
const VERIFY_CODIGO_URL = process.env.GAS_LICENCIAS || process.env.GAS_VERIFY_URL || ''; // si usas otro nombre, ajústalo
const CACHE_VERIFICAR_CODIGO = process.env.AUREA_CACHE_VERIFICAR_CODIGO_URL || 'https://aurea-backend-two.vercel.app/api/cache/verificar-codigo';
const CACHE_VERIFICAR_USUARIO = process.env.AUREA_GAS_VERIFICAR_USUARIO_URL || 'https://aurea-backend-two.vercel.app/api/cache/verificar-usuario';

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=0, must-revalidate',
    ...extra
  };
}

function json200(obj, extra) {
  return new Response(JSON.stringify(obj), { status: 200, headers: corsHeaders(extra) });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders() });

  const url = new URL(req.url);
  const action = (url.searchParams.get('action') || '').toLowerCase();

  if (action !== 'login') {
    return json200({ ok: false, motivo: 'Acción no soportada' });
  }

  let payload = {};
  try { payload = await req.json(); } catch {}
  const email = String(payload.email || '').toLowerCase().trim();
  const codigo = String(payload.codigo || '').toUpperCase().trim();

  if (!email || !codigo || !email.includes('@')) {
    return json200({ ok:false, acceso:false, motivo:'Parámetros inválidos' });
  }

  try {
    // ===== 1) Verificar CÓDIGO vía cache (nunca 404) =====
    let lic = null;
    try {
      const r = await fetch(CACHE_VERIFICAR_CODIGO, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo })
      });
      const t = await r.text();
      try { lic = t ? JSON.parse(t) : null; } catch { lic = null; }
    } catch { lic = null; }

    // Normaliza respuesta de código
    const isCodigoValido = !!(lic && lic.ok === true && lic.activo === true);
    if (!isCodigoValido) {
      return json200({ ok: false, acceso: false, motivo: 'Código no válido' });
    }

    // ===== 2) Verificar USUARIO (tu endpoint cacheado) =====
    let ver = null;
    try {
      const r2 = await fetch(CACHE_VERIFICAR_USUARIO, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo: email, codigo })
      });
      const t2 = await r2.text();
      try { ver = t2 ? JSON.parse(t2) : null; } catch { ver = null; }
    } catch { ver = null; }

    if (!ver || ver.ok !== true) {
      return json200({ ok:false, acceso:false, motivo:'Fallo verificación de usuario' });
    }
    if (ver.acceso !== true) {
      // Passthrough de motivos más comunes para el frontend
      return json200({
        ok:false, acceso:false,
        motivo: ver.motivo || 'Acceso denegado',
        institucion: ver.institucion || (lic && lic.institucion) || '',
        tipoInstitucion: ver.tipoInstitucion || (lic && lic.tipoInstitucion) || '',
        correoSOS: ver.correoSOS || (lic && lic.correoSOS) || ''
      });
    }

    // ===== 3) Éxito =====
    // Normaliza y arma respuesta final
    const usuario = ver.usuario || {};
    return json200({
      ok: true,
      acceso: true,
      usuario,
      institucion: ver.institucion || (lic && lic.institucion) || '',
      tipoInstitucion: (ver.tipoInstitucion || (lic && lic.tipoInstitucion) || '').toLowerCase(),
      correoSOS: ver.correoSOS || (lic && lic.correoSOS) || ''
    });

  } catch (err) {
    return json200({ ok:false, acceso:false, motivo:'Error interno', error:String(err) });
  }
}
