export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.positronconsulting.com");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end(); // Respuesta para preflight
  }

  if (req.method === "POST") {
    const { prompt } = req.body;
    // Aquí integras la lógica con OpenAI u otra que tengas
    return res.status(200).json({ reply: `Procesado: ${prompt}` });
  }

  res.status(405).end(); // Método no permitido
}
