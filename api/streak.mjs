const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  if (!NOTION_TOKEN || !DATABASE_ID) {
    return res.status(500).json({ error: "Missing env vars" });
  }

  try {
    let allResults = [];
    let cursor = undefined;

    do {
      const body = {
        sorts: [{ property: "Date", direction: "ascending" }],
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      };

      const response = await fetch(
        `https://api.notion.com/v1/data_sources/${DATABASE_ID}/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${NOTION_TOKEN}`,
            "Notion-Version": "2025-09-03",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ error: err });
      }

      const data = await response.json();
      allResults = allResults.concat(data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    // ====================================================================
    // CRITICAL FIX: Sort by Date and Entry Time (EST) chronologically
    // ====================================================================
    const sortedPages = allResults.sort((a, b) => {
      const dateA = a.properties?.Date?.date?.start || "";
      const dateB = b.properties?.Date?.date?.start || "";

      // Look at your 'Entry Time (EST)' rich text property
      const timeA = a.properties?.['Entry Time (EST)']?.rich_text?.[0]?.plain_text || "12:00 AM";
      const timeB = b.properties?.['Entry Time (EST)']?.rich_text?.[0]?.plain_text || "12:00 AM";

      const dateTimeA = new Date(`${dateA} ${timeA}`);
      const dateTimeB = new Date(`${dateB} ${timeB}`);

      return dateTimeA - dateTimeB; // Oldest trade to newest trade
    });

    // Extract the ordered results array (handling both "Breakeven" and your CSV column notation "BE")
    const results = sortedPages
      .map((page) => {
        const prop = page.properties?.Result;
        if (!prop) return null;
        let val = prop.select?.name || prop.status?.name || null;
        if (val === "BE") val = "Breakeven"; // Map shorthand "BE" to "Breakeven" if used interchangeably
        return val;
      })
      .filter(Boolean);

    let bestStreak = 0;
    let tempStreak = 0;
    let wins = 0;
    let losses = 0;
    let breakevens = 0;

    // Process from oldest to newest to compute win rates and your absolute best historical streak
    for (const result of results) {
      if (result === "Win") {
        wins++;
        tempStreak++;
        if (tempStreak > bestStreak) bestStreak = tempStreak;
      } else if (result === "Loss") {
        losses++;
        tempStreak = 0;
      } else if (result === "Breakeven") {
        breakevens++;
      }
    }

    // Dynamic Current Streak calculation counting backward from your absolute latest chronologically completed trade
    let currentStreak = 0;
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i] === "Win") {
        currentStreak++;
      } else if (results[i] === "Loss") {
        break; // Stop counting as soon as an intraday loss hits!
      }
    }

    const total = wins + losses + breakevens;
    const winRate = total > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : "0.0";
    const lastResult = results[results.length - 1] || null;

    return res.status(200).json({
      currentStreak,
      bestStreak,
      wins,
      losses,
      breakevens,
      total,
      winRate,
      lastResult,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
