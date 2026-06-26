export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
  const EDGE_CONFIG_ID = process.env.EDGE_CONFIG_ID;

  if (!VERCEL_TOKEN || !EDGE_CONFIG_ID) {
    return res.status(500).json({ error: "Missing env vars" });
  }

  const resetDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const response = await fetch(
    `https://api.vercel.com/v1/edge-config/${EDGE_CONFIG_ID}/items`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: [{ operation: "upsert", key: "evalResetDate", value: resetDate }],
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    return res.status(response.status).json({ error: data });
  }

  return res.status(200).json({ success: true, resetDate });
}
