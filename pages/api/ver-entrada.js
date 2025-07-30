import { fetch } from 'wix-fetch';

export function invoke() {
  const datos = {
    mensaje: "🚀 Esto es una prueba desde Automatización de Wix (con función 'invoke')"
  };

  return fetch("https://aurea-backend-two.vercel.app/api/ver-entrada", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(datos)
  })
  .then(response => response.json())
  .then(result => {
    console.log("✅ Respuesta de Vercel:", result);
    return result;
  })
  .catch(error => {
    console.error("❌ Error al enviar a Vercel:", error);
    return { ok: false, error: error.message };
  });
}
