// /pages/api/orquestador.js — Login “rápido + invisible”
// Flujo:
// 1) Verifica en GAS código+usuario (y relación email↔código) → trae institucion/tipo/correoSOS y flags AW.
// 2) Intenta adjuntar perfil emocional desde /api/cache/perfil-usuario (rápido, sin bloquear).
// 3) Responde de inmediato al login (Wix) para ir a /sistemaaurea.
// 4) Si falta “X” en AW (tienePendiente || !testYaEnviado) → dispara POST a /api/analizar-test (fire-and-forget).

// ─────────────────────────── CONFIG ───────────────────────────
const ORIGIN = process.env.FRONTEND_ORIGIN || 'https://www.positronconsulting.com';

// GAS verificarUsuarioYCodigo.gs (Web App URL /exec)
const GAS_VERIFICAR_URL = process.env.AUREA_GAS_VERIFICAR_USUARIO_URL; // ⬅️ requerido

// Cache de perfil emocional (rápido)
const PERFIL_CACHE_URL =
  process.env.PERFIL_CACHE_URL || 'https://aurea-backend-two.vercel.app/api/cache/perfil-usuario';

// Endpoint que genera y envía el perfil por correo (no bloquea el login)
const ANALIZAR_TEST_URL =
  process.env.ANALIZAR_TEST_URL || 'https://aurea-backend-two.vercel.app/api/analizar-test';
const AUREA_INTERNAL_TOKEN = process.env.AUREA_INTERNAL_TOKEN || '';

// Timeouts
const T_VERIFY_MS = 30000; // GAS verificar (30s)
const T_PERFIL_MS = 2500;  // perfil cache (2.5s)
const T_FIRE_MS   = 4000;  // fire-and-forget (no se usa await)

// ─────────────────────────── UTILS ────────────────────────────
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

// Disparo asíncrono que no bloquea la respuesta
function fireAndForget(url, data, extraHeaders = {}) {
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(data || {})
  }).catch(() => {});
}

// ────────────────────────── HANDLER ───────────────────────────
export default async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = String(req.query.action || '').toLowerCase();
  if (req.method !== 'POST' || action !== 'login') {
    return res.status(200).json({ ok: false, motivo: 'Invalid action' });
  }

  // Body de Wix: { email, codigo }
  const b = parseBody(req);
  const correo = String((b.email ?? b.correo) || '').trim().toLowerCase();
  const codigo = String((b.codigo ?? b.code) || '').trim().toUpperCase();

  if (!correo || !codigo || !correo.includes('@')) {
    return res.status(200).json({ ok: false, acceso: false, motivo: 'Parámetros inválidos' });
  }
  if (!GAS_VERIFICAR_URL) {
    return res.status(200).json({ ok: false, acceso: false, motivo: 'AUREA_GAS_VERIFICAR_USUARIO_URL no configurado' });
  }

  const t0 = Date.now();
  let gas, diag = { gasHost: '', attempt: 0, err: '' };
  try { diag.gasHost = new URL(GAS_VERIFICAR_URL).host; } catch {}

  // 1) Verificar en GAS (con 1 reintento si algo raro pasa)
  try {
    diag.attempt = 1;
    gas = await postJSON(GAS_VERIFICAR_URL, { correo, codigo }, T_VERIFY_MS);
    if (!gas?.j || typeof gas.j.ok !== 'boolean') throw new Error('Respuesta no JSON/ok de GAS');
  } catch (e1) {
    diag.err = String(e1?.message || e1);
    try {
      diag.attempt = 2;
      gas = await postJSON(GAS_VERIFICAR_URL, { correo, codigo }, T_VERIFY_MS);
    } catch (e2) {
      try { res.setHeader('Aurea-Diag', `gasHost=${diag.gasHost}; err=${String(e2?.message||e2)}`); } catch {}
      return res.status(200).json({ ok: false, acceso: false, motivo: 'Timeout verificar usuario', error: String(e2?.message || e2) });
    }
  }

  // Propaga negativos del GAS tal cual (Wix ya los interpreta)
  if (!gas?.j?.ok || !gas.j?.acceso) {
    try { res.setHeader('Aurea-Diag', `gasHost=${diag.gasHost}; status=${gas?.status||'NA'}; attempt=${diag.attempt}`); } catch {}
    return res.status(200).json(gas.j || { ok: false, acceso: false, motivo: 'Fallo GAS' });
  }

  // 2) Base de salida para Wix (lo que tu login.js espera)
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
      testYaEnviado: !!gas.j.usuario?.testYaEnviado
      // perfilEmocional: (se adjunta abajo si está en cache)
    }
  };

  // 3) Perfil emocional desde cache (rápido, mejor no bloquear más de ~2.5s)
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
      try {
        const cacheHdr = rPerfil.headers?.get?.('Aurea-Cache');
        if (cacheHdr) res.setHeader('Aurea-Cache', cacheHdr);
      } catch {}
    }
  } catch {}

  // Headers de diagnóstico
  res.setHeader('Aurea-Elapsedms', String(Date.now() - t0));
  try { res.setHeader('Aurea-Diag', `gasHost=${diag.gasHost}; status=${gas?.status||'200'}; attempt=${diag.attempt}`); } catch {}

  // 4) Respuesta inmediata a Wix
  res.status(200).json(baseOut);

  // 5) Si falta “X” en AW, dispara analizar-test en segundo plano (invisible)
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
    }
  } catch {}
}
