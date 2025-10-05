// /pages/api/orquestador.js — login intacto, chat/finalizar/autosave + logs de temas

const ORIGIN = process.env.FRONTEND_ORIGIN || 'https://www.positronconsulting.com';

// GAS URLs (tuyas)
const GAS_VERIFICAR_URL = process.env.GAS_VERIFICAR_URL
  || 'https://script.google.com/macros/s/AKfycbzqGPWKipeeHafOQAOz8_3lL0nyVkJMgbAWAD0nlti4qKQQ4RITQlRPmDCCR84UJ5zr9w/exec';

const GAS_GET_PERFIL_URL = process.env.GAS_GET_PERFIL_URL
  || 'https://script.google.com/macros/s/AKfycbwMXA7CRtOKNBNSArNq8xNH2ePchv_ydBBz6PaG4pVmGQDUzSul-WnKHl8x1aZicP_Htw/exec';

const GAS_UPDATE_PROFILE_URL = process.env.GAS_UPDATE_PROFILE_URL
  || 'https://script.google.com/macros/s/AKfycbx9aufQ1sH_VUZ3Ihmec1srGaZmOhpF3DBDVyrzg3wOOLUNpp_qLFJ_caUxr5pyzmu_1w/exec';

const GAS_LOG_CALIFICACIONES_URL = process.env.GAS_LOG_CALIFICACIONES_URL
  || 'https://script.google.com/macros/s/AKfycbyDdo0sgva6To9UaNQdKzhrSzF5967t2eA6YXi4cYJVgqeYRy7RJFHKhvhOE5vkBHkD_w/exec';

const GAS_TEMAS_INSTITUCION_URL = process.env.GAS_TEMAS_INSTITUCION_URL
  || 'https://script.google.com/macros/s/AKfycbzJ1hbX6tMRA7qmd9JTRqDNQ9m46LBLqadXQu5Z87wfTeYrxhakC4vqoVtD9zHwwVy5bw/exec';

const GAS_CONTAR_TEMA_URL = process.env.GAS_CONTAR_TEMA_URL
  || 'https://script.google.com/macros/s/AKfycbzAthTwYE4DRbGzEVxmEdd8rbaAl0SOpB9PnaOIRuOPL8DK_I8YTuPnKf6LQq9dSiG0/exec';

// Backend interno
const AUREA_CHAT_URL = process.env.AUREA_CHAT_URL
  || 'https://aurea-backend-two.vercel.app/api/aurea';

const AUREA_INTERNAL_TOKEN = process.env.AUREA_INTERNAL_TOKEN || '';

// Config
const UMBRAL_PORC = 60;
const T_VERIFY_MS = 30000;
const T_GETPERFIL_MS = 8000;
const T_CHAT_MS = 35000;
const T_LOG_MS = 12000;
const T_SAVE_MS = 15000;

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
    return { okHTTP: r.ok, status: r.status, headers: r.headers, j, text };
  } finally { clearTimeout(id); }
}
function fireAndForget(url, data, extraHeaders = {}) {
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(data || {}) }).catch(() => {});
}
function normalizePorcentaje(x) {
  if (typeof x !== 'number' || !isFinite(x)) return 0;
  if (x <= 1) return Math.round(x * 100);
  if (x > 100) return 100;
  return Math.round(x);
}
function temaValido(tema, temas11) {
  if (!tema || !Array.isArray(temas11)) return false;
  const t = String(tema).trim().toLowerCase();
  return temas11.some(x => String(x).trim().toLowerCase() === t);
}
function nowISO(){ return new Date().toISOString(); }

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(200).json({ ok:false, motivo:'POST only' });

  const action = String(req.query.action || '').toLowerCase();
  const b = parseBody(req);

  // ───────── LOGIN (igual) ─────────
  if (action === 'login') {
    try {
      const correo = String((b.email ?? b.correo) || '').trim().toLowerCase();
      const codigo = String(b.codigo || '').trim().toUpperCase();
      if (!correo || !codigo || !correo.includes('@')) {
        return res.status(200).json({ ok: false, acceso: false, motivo: 'Parámetros inválidos' });
      }
      const vr = await postJSON(GAS_VERIFICAR_URL, { correo, codigo }, T_VERIFY_MS);
      if (!vr?.okHTTP || !vr?.j?.ok || !vr?.j?.acceso) {
        return res.status(200).json(vr?.j || { ok: false, acceso: false, motivo: 'Fallo en verificación' });
      }
      const tipoInstitucion = String(vr.j.tipoInstitucion || '').toLowerCase();
      const institucion = String(vr.j.institucion || '');
      const usuario = {
        nombre: vr.j.usuario?.nombre || '',
        apellido: vr.j.usuario?.apellido || '',
        sexo: vr.j.usuario?.sexo || '',
        fechaNacimiento: vr.j.usuario?.fechaNacimiento || '',
        email: vr.j.usuario?.email || correo,
        telefono: vr.j.usuario?.telefono || '',
        correoEmergencia: vr.j.usuario?.correoEmergencia || '',
        codigo: vr.j.usuario?.codigo || codigo,
        testYaEnviado: !!vr.j.usuario?.testYaEnviado
      };
      let perfilEmocional = {};
      try {
        const pr = await postJSON(GAS_GET_PERFIL_URL, { correo: usuario.email, tipoInstitucion, institucion }, T_GETPERFIL_MS);
        if (pr?.okHTTP && pr?.j?.ok && pr.j.perfilEmocional) perfilEmocional = pr.j.perfilEmocional;
      } catch {}
      return res.status(200).json({
        ok: true,
        acceso: true,
        institucion,
        tipoInstitucion,
        correoSOS: vr.j.correoSOS || '',
        tienePendiente: !!vr.j.tienePendiente,
        usuario: { ...usuario, perfilEmocional }
      });
    } catch (err) {
      return res.status(200).json({ ok:false, acceso:false, motivo:'Error inesperado', error:String(err) });
    }
  }

  // ───────── CHAT ─────────
  if (action === 'chat') {
    const correo = String(b.email || b.correo || '').trim().toLowerCase();
    const nombre = String(b.nombre || '').trim();
    const codigo = String(b.codigo || '').trim().toUpperCase();
    const tipoInstitucion = String(b.tipoInstitucion || '').trim().toLowerCase();
    const institucion = String(b.institucion || '').trim();
    const sexo = String(b.sexo || '').trim();
    const fechaNacimiento = String(b.fechaNacimiento || '').trim();
    const mensaje = String(b.mensaje || '').trim();
    const calificaciones = b.perfilActual || b.calificaciones || {};
    const historial = Array.isArray(b.historial) ? b.historial : [];
    const sessionId = String(b.sessionId || '').trim();
    const onceTemas = Array.isArray(b.onceTemas) ? b.onceTemas : [];

    if (!correo || !codigo || !tipoInstitucion || !mensaje) {
      return res.status(200).json({ ok:false, error:'Parametros incompletos' });
    }

    const r = await postJSON(
      AUREA_CHAT_URL,
      { mensaje, correo, nombre, institucion, tipoInstitucion, sexo, fechaNacimiento, codigo, calificaciones, historial, sessionId },
      T_CHAT_MS,
      { 'X-Internal-Token': AUREA_INTERNAL_TOKEN }
    );
    if (!r?.j?.ok) {
      return res.status(200).json({ ok:false, error:r?.text || 'Fallo en aurea' });
    }

    const resp = r.j;
    const tema = String(resp.temaDetectado || '').trim();
    const calif = Number(resp.calificacion || 0);
    const porc = normalizePorcentaje(resp.porcentaje);
    const certeza = String(resp.certeza || '').trim();
    const SOS = String(resp.SOS || 'OK').toUpperCase();

    // perfilSugerido
    let perfilSugerido = (resp.perfilSugerido && typeof resp.perfilSugerido === 'object') ? resp.perfilSugerido : {};
    if (!perfilSugerido || Object.keys(perfilSugerido).length === 0) {
      if (tema && porc >= UMBRAL_PORC && temaValido(tema, onceTemas)) {
        perfilSugerido = { [tema]: calif };
      }
    }

    // Logs (best-effort)
    try {
      // Detalle por mensaje
      fireAndForget(GAS_LOG_CALIFICACIONES_URL, {
        correo, nombre, institucion, tipoInstitucion,
        mensajeUsuario: mensaje,
        tema,
        calificacionAnterior: (typeof calificaciones?.[tema] === 'number' ? calificaciones[tema] : ''),
        nuevaCalificacion: calif,
        certeza,
        justificacion: certeza,
        fecha: nowISO()
      });
      // Acumulador por institución+tema
      if (tema) fireAndForget(GAS_TEMAS_INSTITUCION_URL, { institucion, tema });
      // Conteo simple por tema
      if (tema) fireAndForget(GAS_CONTAR_TEMA_URL, {
        correo, tema, evento: 'mensaje', valor: 1, extra: { institucion }
      });
    } catch {}

    return res.status(200).json({
      ok: true,
      mensajeUsuario: String(resp.mensajeUsuario || 'Gracias por compartir.'),
      temaDetectado: tema,
      porcentaje: porc,
      calificacion: calif,
      certeza,
      SOS,
      perfilSugerido
    });
  }

  // ───────── FINALIZAR / AUTOSAVE ─────────
  if (action === 'finalizar' || action === 'autosave') {
    const correo = String(b.email || b.correo || '').trim().toLowerCase();
    const codigo = String(b.codigo || '').trim().toUpperCase();
    const tipoInstitucion = String(b.tipoInstitucion || '').trim().toLowerCase();
    const institucion = String(b.institucion || '').trim();
    const perfilCompleto = b.perfilCompleto || {};
    const notas = String(b.notas || '').trim();
    const updatedAt = String(b.updatedAt || nowISO());
    const sessionId = String(b.sessionId || '').trim();

    if (!correo || !codigo || !tipoInstitucion || !perfilCompleto || !GAS_UPDATE_PROFILE_URL) {
      return res.status(200).json({ ok:false, error:'Parametros incompletos o GAS_UPDATE_PROFILE_URL ausente' });
    }

    const payload = {
      correo, codigo, tipoInstitucion, institucion,
      perfilCompleto, notas, updatedAt, sessionId,
      modo: (action === 'autosave' ? 'AUTOSAVE' : 'FINAL')
    };

    const r = await postJSON(GAS_UPDATE_PROFILE_URL, payload, T_SAVE_MS);
    if (!r?.okHTTP) {
      return res.status(200).json({ ok:false, error:'Fallo al guardar perfil en GAS', detalle:r?.text || '' });
    }
    return res.status(200).json({ ok:true });
  }

  return res.status(200).json({ ok:false, motivo:'Invalid action' });
}
