const NOTION_TOKEN = process.env.NOTION_TOKEN;
const FORWARD_DB_ID = process.env.NOTION_FORWARD_DB_ID;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  // Try regular query first
  const r1 = await fetch(`https://api.notion.com/v1/databases/${FORWARD_DB_ID}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ page_size: 1 }),
  });

  const data = await r1.json();
  return res.status(200).json({ status: r1.status, data });
}
