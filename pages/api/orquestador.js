// /pages/api/orquestador.js  — Flujo login “rápido + invisible”
//
// 1) Valida código+usuario en GAS (y relación email↔código).
// 2) Adjunta perfil emocional desde /api/cache/perfil-usuario (si está en cache).
// 3) Responde de inmediato a Wix (para /sistemaaurea).
// 4) Si el test NO ha sido enviado (AW vacío) => dispara POST a /api/analizar-test (fire-and-forget).

// ── C O N F I G ────────────────────────────────────────────────────────────────
const ORIGIN = process.env.FRONTEND_ORIGIN || 'https://www.positronconsulting.com';

// GAS (verificación unificada de código/usuario + banderas AW)
const GAS_VERIFICAR_URL = process.env.AUREA_GAS_VERIFICAR_USUARIO_URL; // <== requerido

// Cache de perfil emocional (rápido; consulta Redis y sólo si falta llama a GAS)
const PERFIL_CACHE_URL =
  process.env.PERFIL_CACHE_URL || 'https://aurea-backend-two.vercel.app/api/cache/perfil-usuario';

// Análisis y envío por correo (se lanza en segundo plano)
const ANALIZAR_TEST_URL =
  process.env.ANALIZAR_TEST_URL || 'https://aurea-backend-two.vercel.app/api/analizar-test';
const AUREA_INTERNAL_TOKEN = process.env.AUREA_INTERNAL_TOKEN || '';

// Timeouts “amables”
const T_VERIFY_MS = 20000;   // GAS verificar
const T_PERFIL_MS = 2500;    // perfil cache (no bloquear)
const T_FIRE_MS   = 4000;    // disparo analizar-test

// ── U T I L S ─────────────────────────────────────────────────────────────────
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

// Lanza una petición “fire-and-forget” (no espera el resultado, no bloquea la respuesta)
function fireAndForget(url, data, extraHeaders = {}) {
  // Intenta pero no await; errores se silencian.
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(data || {}),
  }).catch(() => {});
}

// ── H A N D L E R ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // action=login (desde Wix)
  const action = String(req.query.action || '').toLowerCase();
  if (req.method !== 'POST' || action !== 'login') {
    return res.status(200).json({ ok: false, motivo: 'Invalid action' });
  }

  // Body de Wix: { email, codigo }
  const body = parseBody(req);
  const correo = String((body.email ?? body.correo) || '').trim().toLowerCase();
  const codigo = String((body.codigo ?? body.code) || '').trim().toUpperCase();

  if (!correo || !codigo || !correo.includes('@')) {
    return res.status(200).json({ ok: false, acceso: false, motivo: 'Parámetros inválidos' });
  }
  if (!GAS_VERIFICAR_URL) {
    return res.status(200).json({ ok: false, acceso: false, motivo: 'AUREA_GAS_VERIFICAR_USUARIO_URL no configurado' });
  }

  const t0 = Date.now();

  // 1) VERIFICAR CÓDIGO + USUARIO (y relación) en GAS
  let gas;
  try {
    gas = await postJSON(
      GAS_VERIFICAR_URL,
      { correo, codigo },
      T_VERIFY_MS
    );
  } catch (e) {
    return res.status(200).json({
      ok: false, acceso: false, motivo: 'Timeout verificar usuario', error: String(e || 'TIMEOUT')
    });
  }

  // Si GAS devuelve error/denegado, propagamos tal cual (Wix ya sabe mostrar el motivo)
  if (!gas?.j || typeof gas.j.ok !== 'boolean') {
    return res.status(200).json({ ok: false, acceso: false, motivo: 'Respuesta inválida de GAS' });
  }
  if (!gas.j.ok || !gas.j.acceso) {
    return res.status(200).json(gas.j);
  }

  // gas.j trae: institucion, tipoInstitucion, correoSOS, tienePendiente, usuario{..., testYaEnviado}
  const baseOut = {
    ok: true,
    acceso: true,
    institucion: gas.j.institucion || '',
    tipoInstitucion: String(gas.j.tipoInstitucion || '').toLowerCase(),
    correoSOS: gas.j.correoSOS || '',
    tienePendiente: !!gas.j.tienePendiente,
    usuario: {
      nombre: gas.j.usuario?.nombre || '',
      apellido: gas.j.usuario?.apellido || '',
      sexo: gas.j.usuario?.sexo || '',
      fechaNacimiento: gas.j.usuario?.fechaNacimiento || '',
      email: gas.j.usuario?.email || correo,
      telefono: gas.j.usuario?.telefono || '',
      correoEmergencia: gas.j.usuario?.correoEmergencia || '',
      codigo: gas.j.usuario?.codigo || codigo,
      testYaEnviado: !!gas.j.usuario?.testYaEnviado,
      // perfilEmocional: (lo adjuntamos abajo si lo conseguimos rápido)
    }
  };

  // 2) PERFIL EMOCIONAL desde cache (rápido, sin bloquear demasiado)
  try {
    const nombreCompleto = [baseOut.usuario.nombre || '', baseOut.usuario.apellido || ''].join(' ').trim();
    const rPerfil = await postJSON(
      PERFIL_CACHE_URL,
      {
        email: baseOut.usuario.email,
        tipoInstitucion: baseOut.tipoInstitucion,
        nombre: nombreCompleto,
        institucion: baseOut.institucion
      },
      T_PERFIL_MS
    );
    if (rPerfil?.j?.ok && rPerfil.j.perfilEmocional) {
      baseOut.usuario.perfilEmocional = rPerfil.j.perfilEmocional;
      // Marca de cache útil en logs de Wix
      try {
        const cacheHdr = rPerfil.headers?.get?.('Aurea-Cache');
        if (cacheHdr) res.setHeader('Aurea-Cache', cacheHdr);
      } catch (_) {}
    }
  } catch (_) {
    // Silencioso: si no está, no bloqueamos el login
  }

  // Header de diagnóstico de latencia
  res.setHeader('Aurea-Elapsedms', String(Date.now() - t0));

  // 3) RESPUESTA INMEDIATA a Wix (para que navegue a /sistemaaurea)
  res.status(200).json(baseOut);

  // 4) DESPUÉS: si NO hay “X” en AW (tienePendiente=true o testYaEnviado=false), dispara analizar-test
  try {
    const faltaX = (!!baseOut.tienePendiente) || (!baseOut.usuario.testYaEnviado);
    if (faltaX && ANALIZAR_TEST_URL && AUREA_INTERNAL_TOKEN) {
      fireAndForget(
        ANALIZAR_TEST_URL,
        {
          tipoInstitucion: baseOut.tipoInstitucion,
          email: baseOut.usuario.email,
          correoSOS: baseOut.correoSOS || '',
          codigo: baseOut.usuario.codigo
        },
        { 'X-Internal-Token': AUREA_INTERNAL_TOKEN }
      );
      // No esperamos nada; esto corre “invisible” para el usuario.
    }
  } catch (_) {
    // Ningún error aquí debe afectar al login.
  }
}
