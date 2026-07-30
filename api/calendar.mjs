const NOTION_TOKEN = process.env.NOTION_TOKEN;
const FORWARD_DB_ID = process.env.NOTION_FORWARD_DB_ID;

const CONTRACT_VALUE = {
  NQ: { Mini: 20, Micro: 2 },
  ES: { Mini: 50, Micro: 5 },
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  if (!NOTION_TOKEN || !FORWARD_DB_ID) {
    return res.status(500).json({ error: "Missing env vars" });
  }

  const url = new URL(req.url, `http://localhost`);
  const now = new Date();
  const year = parseInt(url.searchParams.get("year") || now.getFullYear());
  const month = parseInt(url.searchParams.get("month") || (now.getMonth() + 1));

  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${endDay}`;

  try {
    let allPages = [];
    let cursor = undefined;

    do {
      const body = {
        filter: {
          and: [
            { property: "Date ", date: { on_or_after: startDate } },
            { property: "Date ", date: { on_or_before: endDate } },
          ],
        },
        sorts: [{ property: "Date ", direction: "ascending" }],
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      };

      const response = await fetch(
        `https://api.notion.com/v1/databases/${FORWARD_DB_ID}/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${NOTION_TOKEN}`,
            "Notion-Version": "2022-06-28",
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
      allPages = allPages.concat(data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    const days = {};

    for (const page of allPages) {
      const props = page.properties;
      const dateRaw = props?.["Date "]?.date?.start || props?.["Date"]?.date?.start || null;
      if (!dateRaw) continue;
      const day = dateRaw.slice(0, 10);

      const result = props?.["Result"]?.select?.name || null;
      const asset = props?.["Asset"]?.select?.name || null;
      const contractType = props?.["Contract"]?.select?.name || null;
      const numContracts = props?.["No. of Contracts"]?.number ?? null;
      const entryPrice = props?.["Entry Price"]?.number ?? null;
      const exitPrice = props?.["Exit Price"]?.number ?? null;
      const profitLevel = props?.["Profit Level"]?.number ?? null;
      const rrTraded = props?.["RR Traded"]?.number ?? null;

      let pnl = null;
      const pointValue = asset && contractType ? (CONTRACT_VALUE[asset]?.[contractType] ?? null) : null;

      if (result === "Breakeven") {
        pnl = 0;
      } else if (result === "Win" && entryPrice !== null && profitLevel !== null && pointValue !== null && numContracts !== null) {
        pnl = Math.abs(profitLevel - entryPrice) * pointValue * numContracts;
      } else if (result === "Loss" && entryPrice !== null && exitPrice !== null && pointValue !== null && numContracts !== null) {
        pnl = -Math.abs(exitPrice - entryPrice) * pointValue * numContracts;
      } else if (rrTraded !== null && result) {
        if (result === "Win") pnl = rrTraded * 500;
        else if (result === "Loss") pnl = -(rrTraded * 500);
        else if (result === "Breakeven") pnl = 0;
      }

      if (pnl === null) continue;

      if (!days[day]) days[day] = { pnl: 0, trades: 0, wins: 0, losses: 0, rr: 0, winPnl: 0, lossPnl: 0 };
      days[day].pnl += pnl;
      days[day].trades += 1;
      if (result === "Win") { days[day].wins += 1; days[day].winPnl += pnl; }
      if (result === "Loss") { days[day].losses += 1; days[day].lossPnl += pnl; }
      if (rrTraded !== null) days[day].rr += rrTraded;
    }

    // Compute monthly aggregate stats
    const allDays = Object.values(days);
    let totalWins = 0, totalLosses = 0, totalWinPnl = 0, totalLossPnl = 0;
    for (const d of allDays) {
      totalWins += d.wins;
      totalLosses += d.losses;
      totalWinPnl += d.winPnl;
      totalLossPnl += d.lossPnl;
    }
    const avgWin = totalWins > 0 ? Math.round(totalWinPnl / totalWins) : 0;
    const avgLoss = totalLosses > 0 ? Math.round(Math.abs(totalLossPnl) / totalLosses) : 0;
    const profitFactor = totalLossPnl !== 0 ? parseFloat((totalWinPnl / Math.abs(totalLossPnl)).toFixed(2)) : null;

    for (const day of Object.keys(days)) {
      days[day].pnl = Math.round(days[day].pnl);
      days[day].rr = parseFloat(days[day].rr.toFixed(2));
      const wl = days[day].wins + days[day].losses;
      days[day].winRate = wl > 0 ? Math.round((days[day].wins / wl) * 100) : null;
    }

    return res.status(200).json({ year, month, days, avgWin, avgLoss, profitFactor });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
