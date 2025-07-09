
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.positronconsulting.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    const { correo, tipoInstitucion } = req.body;

    if (!correo || !tipoInstitucion) {
      return res.status(400).json({ error: "Faltan parámetros obligatorios" });
    }

    const endpoint = "https://script.google.com/macros/s/AKfycbyKzpQpY8PvsnEbNb1g8H2aJyjVLhH7XtTACAbTZTUWwMzBsTjaFF_8AU03kzUxa5c4vg/exec"; // ← cambia esto

    const respuesta = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo, tipoInstitucion })
    });

    const datos = await respuesta.json();

    if (!datos.ok) {
      throw new Error(datos.error || "Error al consultar perfil");
    }

    return res.json(datos);

  } catch (error) {
    console.error("❌ Error en getPerfilUsuario:", error.message);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}
