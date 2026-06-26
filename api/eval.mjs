const NOTION_TOKEN = process.env.NOTION_TOKEN;
const FORWARD_DB_ID = process.env.NOTION_FORWARD_DB_ID;

const ACCOUNT_START = 50000;
const PROFIT_TARGET = 3000;
const MAX_DRAWDOWN = 2000;
const RISK_PER_TRADE = 500;
const CONSISTENCY_LIMIT = 0.40;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  if (!NOTION_TOKEN || !FORWARD_DB_ID) {
    return res.status(500).json({ error: "Missing env vars" });
  }

  try {
    let allPages = [];
    let cursor = undefined;

    do {
      const body = {
        sorts: [{ property: "Date ", direction: "ascending" }],
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      };

      const response = await fetch(
        `https://api.notion.com/v1/data_sources/${FORWARD_DB_ID}/query`,
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
      allPages = allPages.concat(data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    // Parse trades
    const trades = allPages.map((page) => {
      const props = page.properties;
      const dateRaw = props?.["Date "]?.date?.start || props?.["Date"]?.date?.start || null;
      const rrTraded = props?.["RR Traded"]?.number ?? null;
      const result = props?.["Result"]?.select?.name || null;
      const stopDistance = props?.["Stop Distance (pts)"]?.number ?? null;

      // P&L = RR Traded * $500 (positive for win, negative for loss, 0 for BE)
      let pnl = null;
      if (rrTraded !== null && result) {
        if (result === "Win") pnl = rrTraded * RISK_PER_TRADE;
        else if (result === "Loss") pnl = -(rrTraded * RISK_PER_TRADE);
        else if (result === "Breakeven") pnl = 0;
      }

      return { date: dateRaw, pnl, result, stopDistance, rrTraded };
    }).filter(t => t.date && t.pnl !== null);

    // --- Total profit ---
    const totalProfit = trades.reduce((sum, t) => sum + t.pnl, 0);

    // --- Daily P&L map ---
    const dailyPnL = {};
    for (const t of trades) {
      const day = t.date.slice(0, 10);
      dailyPnL[day] = (dailyPnL[day] || 0) + t.pnl;
    }

    // --- Trailing EOD drawdown ---
    // Build cumulative EOD account values
    const sortedDays = Object.keys(dailyPnL).sort();
    let runningBalance = ACCOUNT_START;
    let peakBalance = ACCOUNT_START;
    let maxDrawdownHit = 0;
    let currentDrawdown = 0;

    for (const day of sortedDays) {
      runningBalance += dailyPnL[day];
      if (runningBalance > peakBalance) peakBalance = runningBalance;
      const dd = peakBalance - runningBalance;
      if (dd > maxDrawdownHit) maxDrawdownHit = dd;
      currentDrawdown = dd;
    }
    const drawdownRemaining = MAX_DRAWDOWN - currentDrawdown;
    const drawdownPct = Math.min((currentDrawdown / MAX_DRAWDOWN) * 100, 100);
    const drawdownWarning = drawdownRemaining <= 500;

    // --- Consistency rule ---
    // No single day > 40% of total profit
    let biggestDayAmount = 0;
    let biggestDayDate = null;
    for (const [day, pnl] of Object.entries(dailyPnL)) {
      if (pnl > biggestDayAmount) {
        biggestDayAmount = pnl;
        biggestDayDate = day;
      }
    }
    const consistencyPct = totalProfit > 0 ? (biggestDayAmount / totalProfit) * 100 : 0;
    const consistencyLimit = totalProfit * CONSISTENCY_LIMIT;
    const consistencyWarning = consistencyPct >= 35; // warn at 35%, breach at 40%
    const consistencyBreach = consistencyPct > 40;

    // --- Risk flag: any trade with stop distance implying > $500 risk ---
    // For NQ: 1 mini = $20/pt, so $500 / $20 = 25pt max stop
    // For ES: 1 mini = $50/pt, so $500 / $50 = 10pt max stop
    // We flag if stopDistance > 25 (conservative NQ threshold)
    const riskyTrades = trades.filter(t => t.stopDistance !== null && t.stopDistance > 25);

    // --- Progress ---
    const progressPct = Math.min((totalProfit / PROFIT_TARGET) * 100, 100);
    const profitRemaining = Math.max(PROFIT_TARGET - totalProfit, 0);

    // --- Win stats ---
    const wins = trades.filter(t => t.result === "Win").length;
    const losses = trades.filter(t => t.result === "Loss").length;
    const bes = trades.filter(t => t.result === "Breakeven").length;
    const winRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : "0.0";

    return res.status(200).json({
      // Profit
      totalProfit: Math.round(totalProfit),
      profitTarget: PROFIT_TARGET,
      progressPct: parseFloat(progressPct.toFixed(1)),
      profitRemaining: Math.round(profitRemaining),
      // Drawdown
      currentDrawdown: Math.round(currentDrawdown),
      drawdownRemaining: Math.round(drawdownRemaining),
      drawdownPct: parseFloat(drawdownPct.toFixed(1)),
      drawdownWarning,
      peakBalance: Math.round(peakBalance),
      // Consistency
      biggestDayAmount: Math.round(biggestDayAmount),
      biggestDayDate,
      consistencyPct: parseFloat(consistencyPct.toFixed(1)),
      consistencyLimit: Math.round(consistencyLimit),
      consistencyWarning,
      consistencyBreach,
      // Risk
      riskyTradeCount: riskyTrades.length,
      // Stats
      wins, losses, bes,
      winRate,
      totalTrades: trades.length,
      accountBalance: Math.round(runningBalance),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
