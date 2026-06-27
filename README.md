# Notion Trading Widgets

Two embeddable widgets for futures traders who log trades in Notion:

- **Win Streak Counter** — automatically tracks your current win streak, best streak, W/L/BE counts, and win rate from your backtest or trade journal database.
- **Eval Tracker** — tracks your prop firm evaluation progress with a profit donut chart, trailing drawdown bar, consistency rule monitor, and risk alerts. Built for Tradeify's $50K account rules but adaptable.

Both widgets auto-refresh every 5 minutes and embed directly into any Notion page via the `/embed` block.

---

## Prerequisites

- A [Notion](https://notion.so) account
- A [Vercel](https://vercel.com) account (free tier works)
- A [GitHub](https://github.com) account

---

## Step 1 — Set Up Your Notion Databases

You need **two separate Notion databases**: one for backtesting (used by the Win Streak widget) and one for your forward/live trades (used by the Eval Tracker).

### Backtest Database (Win Streak Widget)

Create a new Notion database with these properties:

| Property Name | Type | Notes |
|---|---|---|
| `Date` | Date | The date of the trade |
| `Result` | Select | Options: `Win`, `Loss`, `Breakeven` |

> These are the minimum required properties. You can add more columns for your own analysis — the widget only reads `Date` and `Result`.

### Forward/Live Database (Eval Tracker Widget)

Create a new Notion database with these properties:

| Property Name | Type | Notes |
|---|---|---|
| `Date ` | Date | **Note the trailing space** — must be named `Date ` |
| `Result` | Select | Options: `Win`, `Loss`, `Breakeven` |
| `Asset` | Select | Options: `NQ`, `ES` |
| `Contract` | Select | Options: `Mini`, `Micro` |
| `No. of Contracts` | Number | How many contracts traded |
| `Entry Price` | Number | Your entry price |
| `Exit Price` | Number | Your stop loss level (where you'd exit at a loss) |
| `Profit Level` | Number | Your take profit level (where you'd exit at a win) |
| `Stop Distance (pts)` | Number | Distance from entry to stop in points |
| `Position` | Select | Options: `Long`, `Short` |
| `RR Traded` | Number | R:R ratio of the trade (used as fallback if prices are missing) |

> **Important:** The `Date ` property must have a trailing space in its name. This is a quirk of the database structure. If you name it `Date` without a space, the widget will still try `Date` as a fallback — but `Date ` with a space is preferred.

---

## Step 2 — Create a Notion Integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **New Integration**
3. Name it anything (e.g. `Trading Widgets`)
4. Set type to **Internal**, enable **Read content** access
5. Click **Save** and copy the **Internal Integration Secret** (starts with `secret_...`) — you'll need this later

### Connect the integration to your databases

For **each** of your two databases:
1. Open the database in Notion
2. Click `...` (top right of the page) → **Connections**
3. Find your integration and click to connect it
4. If asked, allow access to child pages

---

## Step 3 — Get Your Database IDs

Open each database in Notion and look at the URL:

```
https://notion.so/yourworkspace/XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX?v=...
```

The 32-character string between the last `/` and `?v=` is your database ID. Copy both IDs (one for backtest, one for forward).

**Remove the dashes** when using them as environment variables. For example:
```
37ef4ff7-cf98-800c-b729-d6c41bf27429  →  37ef4ff7cf98800cb729d6c41bf27429
```

---

## Step 4 — Deploy to Vercel

### Fork this repo

1. Click **Fork** on this GitHub repo
2. Clone it to your own account

### Import to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **Import Git Repository** and select your forked repo
3. Before clicking Deploy, expand **Environment Variables** and add:

| Key | Value |
|---|---|
| `NOTION_TOKEN` | Your integration secret (`secret_...`) |
| `NOTION_DATABASE_ID` | Your **Backtest** database ID (no dashes) |
| `NOTION_FORWARD_DB_ID` | Your **Forward** database ID (no dashes) |

4. Click **Deploy**

After deployment, your widgets will be live at:
- `https://your-project.vercel.app` — Win Streak
- `https://your-project.vercel.app/eval.html` — Eval Tracker

---

## Step 5 — Set Up the Reset Feature (Eval Tracker)

The Eval Tracker has a **Start New Eval** button that lets you reset the start date so only trades after that date are counted. This uses Vercel Edge Config to store the date.

### Create an Edge Config store

1. In your Vercel dashboard, go to **Storage** → **Create** → **Edge Config**
2. Name it anything (e.g. `eval-config`)
3. Click **Create** then **Connect to Project** → select your project

### Create a Vercel API token

1. Go to [vercel.com/account/tokens](https://vercel.com/account/tokens)
2. Click **Create Token**, name it `eval-reset`
3. Copy the token

### Add the new environment variables

Go to your Vercel project → **Settings → Environment Variables** and add:

| Key | Value |
|---|---|
| `VERCEL_TOKEN` | Your Vercel API token |
| `EDGE_CONFIG_ID` | Your Edge Config ID (looks like `ecfg_...`) |

Then go to **Deployments → Redeploy** to apply the new variables.

---

## Step 6 — Embed in Notion

1. Open any Notion page
2. Type `/embed` and select **Embed**
3. Paste your widget URL:
   - Win Streak: `https://your-project.vercel.app`
   - Eval Tracker: `https://your-project.vercel.app/eval.html`
4. Click **Embed link**

Resize the embed block to fit your layout. The widgets are responsive.

---

## Eval Tracker Rules

The Eval Tracker is configured for a **Tradeify $50K account** with these rules:

| Rule | Value |
|---|---|
| Profit Target | $3,000 |
| Trailing Max Drawdown (EOD) | $2,000 |
| Max Risk Per Trade | $500 (1% of account) |
| Consistency Rule | No single day > 40% of total profits |

### P&L Calculation

P&L is calculated from actual prices and contract specs:

- **Win:** `|Profit Level - Entry Price| × point value × No. of Contracts`
- **Loss:** `|Exit Price - Entry Price| × point value × No. of Contracts`
- **Breakeven:** `$0`

Contract point values:

| Asset | Mini | Micro |
|---|---|---|
| NQ | $20/pt | $2/pt |
| ES | $50/pt | $5/pt |

If `Entry Price`, `Exit Price`, or `Profit Level` are missing, the widget falls back to `RR Traded × $500`.

### Customizing the Rules

To change the account size, profit target, or drawdown limit, edit these constants at the top of `api/eval.mjs`:

```js
const ACCOUNT_START = 50000;   // Starting account balance
const PROFIT_TARGET = 3000;    // Profit needed to pass
const MAX_DRAWDOWN = 2000;     // Max trailing drawdown allowed
const MAX_RISK_PER_TRADE = 500; // Max dollar risk per trade
```

---

## Troubleshooting

**Widget shows "Missing env vars"**
→ Check that all environment variables are set in Vercel and redeploy.

**Widget shows "Could not find database"**
→ Make sure your Notion integration is connected to the database (Step 2).

**Widget shows "Databases with multiple data sources are not supported"**
→ Your database is a linked/synced database. Use the source database ID instead, and change the API endpoint in `api/streak.mjs` from `/v1/databases/` to `/v1/data_sources/` and the Notion-Version header to `2025-09-03`.

**P&L looks wrong**
→ Make sure `Result`, `Entry Price`, `Exit Price`, `Profit Level`, `Asset`, `Contract`, and `No. of Contracts` are all filled in for each trade.

**Reset button doesn't work**
→ Make sure `VERCEL_TOKEN` and `EDGE_CONFIG_ID` are set and the Edge Config store is connected to your project (Step 5).
