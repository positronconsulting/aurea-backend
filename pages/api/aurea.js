import { fetch } from 'wix-fetch';
import { local } from 'wix-storage';
import wixLocation from 'wix-location';
import wixWindow from 'wix-window';
import { post_alertaSOS } from 'backend/alertaSOS';
import { post_contarTema } from 'backend/contarTema';
import { post_actualizarPerfil } from 'backend/perfil';

$w.onReady(function () {
  const sessionId = local.getItem("correo");
  let institucion = local.getItem("institucion");

  if (!sessionId || !institucion) {
    $w("#respuestaAurea").text = "No tienes acceso autorizado. Por favor, inicia sesión primero.";
    $w("#inputMensaje").disable();
    $w("#botonEnviar").disable();
    return;
  }

  const historialMensajes = [];

  $w("#botonEnviar").onClick(async () => {
    const mensaje = $w("#inputMensaje").value;

    if (!mensaje) {
      $w("#respuestaAurea").text = "Por favor, escribe algo antes de enviar.";
      return;
    }

    $w("#respuestaAurea").text = "Procesando...";
    $w("#inputMensaje").value = "";

    try {
      const response = await fetch("https://aurea-backend-two.vercel.app/api/aurea", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session-id": sessionId,
          "x-institucion": institucion
        },
        body: JSON.stringify({ mensaje })
      });

      if (!response.ok) throw new Error("No se pudo conectar con el servidor");

      const data = await response.json();
      console.log("🧪 Data del backend:", data);
      const respuesta = data.respuesta || "Sin respuesta del servidor.";
      const temaDetectado = data.tema || "sin_tema";
      const calificacion = data.calificacion || null;
      const confirmado = data.confirmado || "";
      const fecha = data.fecha || new Date().toISOString().split("T")[0];
      const tipoInstitucion = local.getItem("tipoInstitucion") || "sin_tipo";
      const esSOS = data.sos === true;

      console.log("🧠 Tema detectado:", temaDetectado);
      $w("#respuestaAurea").text = respuesta;

      // Enviar tema a hoja de conteo
      if (temaDetectado !== "sin_tema") {
        console.log("📤 Enviando tema a Google Sheets desde backend...");
        await post_contarTema({ institucion, tema: temaDetectado });
      }

      // Enviar calificación a perfil si hay datos
      if (temaDetectado !== "sin_tema" && calificacion && confirmado) {
        console.log("📥 Enviando actualización de perfil:", {
          correo: sessionId,
          institucion,
          tipoInstitucion,
          tema: temaDetectado,
          nuevaCalificacion: calificacion,
          confirmado,
          fecha
        });

        await post_actualizarPerfil({
          correo: sessionId,
          institucion,
          tipoInstitucion,
          tema: temaDetectado,
          nuevaCalificacion: calificacion,
          confirmado,
          fecha
        });
      }

      // Actualizar historial
      historialMensajes.push(`user: ${mensaje}`);
      historialMensajes.push(`assistant: ${respuesta}`);
      if (historialMensajes.length > 6) {
        historialMensajes.splice(0, historialMensajes.length - 6);
      }
      const historial = historialMensajes.join("\n");

      // Verificar si es alerta SOS
      if (esSOS) {
        const resultado = await wixWindow.openLightbox("ConsentimientoAlerta");
        const autoriza = resultado?.autoriza === true;

        institucion = institucion || "sin_institucion";

        console.log("🧾 Enviando alerta SOS con:", {
          correoUsuario: sessionId,
          institucion,
          mensajeUsuario: mensaje,
          respuestaAurea: respuesta,
          autoriza,
          historial,
          temaDetectado
        });

        await post_alertaSOS({
          correoUsuario: sessionId,
          institucion,
          mensajeUsuario: mensaje,
          respuestaAurea: respuesta,
          autoriza,
          correoSOS: local.getItem("correoSOS") || "",
          historial,
          temaDetectado
        });
      }

    } catch (error) {
      console.error("❌ Error en envío:", error);
      $w("#respuestaAurea").text = "Ocurrió un error al conectar con el servidor.";
    }
  });

  $w("#botonCerrar").onClick(() => {
    local.removeItem("correo");
    local.removeItem("institucion");
    local.removeItem("loginTime");
    wixLocation.to("/login");
  });

  // Expira sesión después de 30 minutos
  const tiempoMaxInactivo = 30 * 60 * 1000;
  const inicio = parseInt(local.getItem("loginTime") || "0");
  if (inicio && Date.now() - inicio > tiempoMaxInactivo) {
    local.removeItem("correo");
    local.removeItem("institucion");
    local.removeItem("loginTime");
    wixLocation.to("/login");
  }
});
