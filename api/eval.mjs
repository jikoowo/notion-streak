const NOTION_TOKEN = process.env.NOTION_TOKEN;
const FORWARD_DB_ID = process.env.NOTION_FORWARD_DB_ID;
const EDGE_CONFIG_ID = process.env.EDGE_CONFIG_ID;
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;

const ACCOUNT_START = 50000;
const PROFIT_TARGET = 3000;
const MAX_DRAWDOWN = 2000;
const MAX_RISK_PER_TRADE = 500;

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

  try {
    let resetDate = null;
    if (EDGE_CONFIG_ID && VERCEL_TOKEN) {
      const ecRes = await fetch(
        `https://api.vercel.com/v1/edge-config/${EDGE_CONFIG_ID}/item/evalResetDate`,
        { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
      );
      if (ecRes.ok) {
        const ecData = await ecRes.json();
        resetDate = ecData.value || null;
      }
    }

    let allPages = [];
    let cursor = undefined;

    do {
      const body = {
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

    const trades = allPages.map((page) => {
      const props = page.properties;
      const dateRaw = props?.["Date "]?.date?.start || props?.["Date"]?.date?.start || null;
      const result = props?.["Result"]?.select?.name || null;
      const asset = props?.["Asset"]?.select?.name || null;
      const contractType = props?.["Contract"]?.select?.name || null;
      const numContracts = props?.["No. of Contracts"]?.number ?? null;
      const entryPrice = props?.["Entry Price"]?.number ?? null;
      const exitPrice = props?.["Exit Price"]?.number ?? null;       // stop loss level
      const profitLevel = props?.["Profit Level"]?.number ?? null;   // take profit level
      const stopDistance = props?.["Stop Distance (pts)"]?.number ?? null;
      const rrTraded = props?.["RR Traded"]?.number ?? null;

      let pnl = null;
      const pointValue = asset && contractType ? (CONTRACT_VALUE[asset]?.[contractType] ?? null) : null;

      if (result === "Breakeven") {
        pnl = 0;
      } else if (result === "Win" && entryPrice !== null && profitLevel !== null && pointValue !== null && numContracts !== null) {
        // Win: use |Profit Level - Entry Price| — always positive regardless of direction
        pnl = Math.abs(profitLevel - entryPrice) * pointValue * numContracts;
      } else if (result === "Loss" && entryPrice !== null && exitPrice !== null && pointValue !== null && numContracts !== null) {
        // Loss: use |Exit Price - Entry Price| — always negative
        pnl = -Math.abs(exitPrice - entryPrice) * pointValue * numContracts;
      } else if (rrTraded !== null && result) {
        // Fallback: RR × $500
        if (result === "Win") pnl = rrTraded * 500;
        else if (result === "Loss") pnl = -(rrTraded * 500);
        else if (result === "Breakeven") pnl = 0;
      }

      // Risk flag: stop distance × point value × contracts
      let actualRisk = null;
      if (stopDistance !== null && pointValue !== null && numContracts !== null) {
        actualRisk = stopDistance * pointValue * numContracts;
      }

      return { date: dateRaw, pnl, result, actualRisk };
    })
    .filter(t => t.date && t.pnl !== null)
    .filter(t => !resetDate || t.date >= resetDate);

    const totalProfit = trades.reduce((sum, t) => sum + t.pnl, 0);

    const dailyPnL = {};
    for (const t of trades) {
      const day = t.date.slice(0, 10);
      dailyPnL[day] = (dailyPnL[day] || 0) + t.pnl;
    }

    const sortedDays = Object.keys(dailyPnL).sort();
    let runningBalance = ACCOUNT_START;
    let peakBalance = ACCOUNT_START;
    let currentDrawdown = 0;

    for (const day of sortedDays) {
      runningBalance += dailyPnL[day];
      if (runningBalance > peakBalance) peakBalance = runningBalance;
      currentDrawdown = peakBalance - runningBalance;
    }

    const drawdownRemaining = Math.max(MAX_DRAWDOWN - currentDrawdown, 0);
    const drawdownPct = Math.min((currentDrawdown / MAX_DRAWDOWN) * 100, 100);
    const accountBlown = currentDrawdown >= MAX_DRAWDOWN;
    const drawdownWarning = !accountBlown && drawdownRemaining <= 500;

    let biggestDayAmount = 0;
    let biggestDayDate = null;
    for (const [day, pnl] of Object.entries(dailyPnL)) {
      if (pnl > biggestDayAmount) {
        biggestDayAmount = pnl;
        biggestDayDate = day;
      }
    }
    const consistencyPct = totalProfit > 0 ? (biggestDayAmount / totalProfit) * 100 : 0;
    const consistencyWarning = consistencyPct >= 35;
    const consistencyBreach = consistencyPct > 40;
    
    const riskyTrades = trades.filter(t => t.actualRisk !== null && t.actualRisk > MAX_RISK_PER_TRADE);
    const profitRemaining = Math.max(PROFIT_TARGET - totalProfit, 0);

    const wins = trades.filter(t => t.result === "Win").length;
    const losses = trades.filter(t => t.result === "Loss").length;
    const bes = trades.filter(t => t.result === "Breakeven").length;
    const winRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : "0.0";

    return res.status(200).json({
      totalProfit: Math.round(totalProfit),
      profitTarget: PROFIT_TARGET,
      profitRemaining: Math.round(profitRemaining),
      currentDrawdown: Math.round(currentDrawdown),
      drawdownRemaining: Math.round(drawdownRemaining),
      drawdownPct: parseFloat(drawdownPct.toFixed(1)),
      drawdownWarning,
      accountBlown,
      peakBalance: Math.round(peakBalance),
      biggestDayAmount: Math.round(biggestDayAmount),
      biggestDayDate,
      consistencyPct: parseFloat(consistencyPct.toFixed(1)),
      consistencyWarning,
      consistencyBreach,
      riskyTradeCount: riskyTrades.length,
      wins, losses, bes,
      winRate,
      totalTrades: trades.length,
      accountBalance: Math.round(runningBalance),
      resetDate,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
