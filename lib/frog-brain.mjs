const QUOTE_UNITS = new Set(["SOL", "USDC", "USDT", "USD"]);

function side(trade = {}) {
  const text = String(trade.action || trade.execution?.action || "").toLowerCase();
  if (text.includes("buy")) return "buy";
  if (text.includes("sell")) return "sell";
  return "";
}

function dateValue(trade = {}) {
  const raw = trade.execution?.confirmedAt || trade.time || trade.createdAt || trade.timestamp;
  const value = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(value) ? value : 0;
}

function tokenKey(trade = {}) {
  return String(trade.tradedTokenMint || trade.token || trade.tradedToken || "").trim();
}

function quoteAmount(trade = {}) {
  const amounts = trade.sourceAmounts;
  const item = amounts?.paid || amounts?.received;
  const unit = String(item?.symbol || item?.mint || "").toUpperCase();
  const value = Number(item?.amount);
  if (Number.isFinite(value) && value > 0 && (QUOTE_UNITS.has(unit) || item?.mint)) return { value, unit: unit || "QUOTE" };
  const usd = side(trade) === "sell" ? Number(trade.sourceReceivedUsd || 0) : Number(trade.sourceUsd || trade.amount || 0);
  return Number.isFinite(usd) && usd > 0 ? { value: usd, unit: "USD" } : null;
}

function median(values = []) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function rounded(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function numberValues(values = []) {
  return values.map(Number).filter((value) => Number.isFinite(value) && value >= 0);
}

function likelyFreshMemeCoin(trade = {}) {
  const text = `${trade.token || ""} ${trade.tradedToken || ""} ${trade.tradedTokenMint || ""}`.toLowerCase();
  return text.includes("pump") || /(?:^|[^a-z0-9])all\d*/i.test(text);
}

export function analyzeFrogBrain(trades = [], profile = "safe") {
  const label = profile === "safe" ? "Frog" : "Trader";
  const rows = trades
    .filter((trade) => {
      const text = String(trade.profile || "").toLowerCase();
      return profile === "safe" ? (text === "frog" || text.includes("frog")) : text.includes(profile);
    })
    .filter((trade) => ["buy", "sell"].includes(side(trade)))
    .sort((a, b) => dateValue(a) - dateValue(b));

  const buys = rows.filter((trade) => side(trade) === "buy");
  const sells = rows.filter((trade) => side(trade) === "sell");
  const tokens = new Map();
  for (const trade of rows) {
    const key = tokenKey(trade);
    if (!key) continue;
    if (!tokens.has(key)) tokens.set(key, { buys: [], sells: [], freshLike: false });
    const bucket = tokens.get(key);
    bucket[side(trade) === "buy" ? "buys" : "sells"].push(trade);
    bucket.freshLike = bucket.freshLike || likelyFreshMemeCoin(trade);
  }

  const buyAmounts = buys.map(quoteAmount).filter(Boolean);
  const copyBuyTimes = numberValues(buys.map((trade) => trade.execution?.timingsMs?.detectionToSubmit));
  const copySellTimes = numberValues(sells.map((trade) => trade.execution?.timingsMs?.detectionToSubmit));
  const buyByUnit = buyAmounts.reduce((acc, item) => {
    acc[item.unit] = acc[item.unit] || [];
    acc[item.unit].push(item.value);
    return acc;
  }, {});
  const primaryBuyUnit = Object.entries(buyByUnit).sort((a, b) => b[1].length - a[1].length)[0]?.[0] || "";
  const primaryAmounts = primaryBuyUnit ? buyByUnit[primaryBuyUnit] : [];
  const repeatBuyTokens = [...tokens.values()].filter((item) => item.buys.length > 1).length;
  const roundTripTokens = [...tokens.values()].filter((item) => item.buys.length && item.sells.length).length;
  const freshLikeTokens = [...tokens.values()].filter((item) => item.freshLike).length;
  const fullSells = sells.filter((trade) => {
    const pct = Number(trade.sourceAmounts?.soldPercent ?? trade.execution?.sourceSale?.soldPercent);
    return Number.isFinite(pct) && pct >= 95;
  }).length;

  const holdMinutes = [];
  for (const item of tokens.values()) {
    const firstBuy = item.buys[0];
    const firstSell = item.sells[0];
    const diff = dateValue(firstSell) - dateValue(firstBuy);
    if (diff > 0) holdMinutes.push(diff / 60000);
  }

  const evidence = buys.length + sells.length;
  const medianBuyMs = median(copyBuyTimes);
  const medianSellMs = median(copySellTimes);
  const buySpeed = medianBuyMs === null ? "unknown" : medianBuyMs <= 500 ? "target" : medianBuyMs <= 1000 ? "backup" : "late";
  const sellSpeed = medianSellMs === null ? "unknown" : medianSellMs <= 500 ? "target" : medianSellMs <= 1000 ? "backup" : "late";
  const score = Math.min(100, Math.round(
    Math.min(evidence, 20) * 2.5 +
    Math.min(repeatBuyTokens, 5) * 7 +
    Math.min(roundTripTokens, 5) * 6 +
    Math.min(freshLikeTokens, 8) * 4 +
    (buySpeed === "target" ? 12 : buySpeed === "backup" ? 6 : 0) +
    (sellSpeed === "target" ? 8 : sellSpeed === "backup" ? 4 : 0)
  ));

  const moveRules = [
    buySpeed === "late"
      ? "Do not chase Frog late: if your copy entry is already over 1 second, keep the buy small or skip weak routes."
      : buySpeed === "target"
        ? "Entry timing is strong: keep copying Frog with the saved highest-buy limit."
        : "Use the 1 second backup while the brain collects more live timing.",
    "Keep Profit Ladder + Loss Guard on: take protection from the ladder, but still obey Frog's sell.",
    "Never increase size after a losing round trip; learn first, then copy the next clean Frog buy.",
    "Prefer clean verified swaps only: unclear source trades should be skipped instead of guessed."
  ];

  const rules = [
    buys.length ? `${label} buys early-moving meme tokens, usually small to medium size.` : `${label} buy pattern is not proven yet.`,
    repeatBuyTokens ? `${label} can add to the same coin when the move continues.` : "Repeat-buy behavior needs more data.",
    sells.length ? `${label} exits quickly when the trade is done; full exits are allowed.` : "Sell behavior needs more data.",
    roundTripTokens ? "Closed buys and sells are now enough to start measuring holding time." : "Need more round trips before self-trading can be trusted."
  ];

  return {
    name: "Frog Brain",
    mode: "shadow",
    summary: `${label} style learner: early meme momentum, controlled entry, fast exit.`,
    readiness: score >= 70 && roundTripTokens >= 3 ? "training-ready" : score >= 40 ? "learning" : "collecting-data",
    confidence: score,
    sample: {
      signals: rows.length,
      buys: buys.length,
      sells: sells.length,
      tokens: tokens.size,
      repeatBuyTokens,
      roundTripTokens,
      freshLikeTokens,
      fullSells
    },
    buySize: {
      unit: primaryBuyUnit || null,
      median: rounded(median(primaryAmounts), primaryBuyUnit === "SOL" ? 6 : 2),
      min: rounded(primaryAmounts.length ? Math.min(...primaryAmounts) : NaN, primaryBuyUnit === "SOL" ? 6 : 2),
      max: rounded(primaryAmounts.length ? Math.max(...primaryAmounts) : NaN, primaryBuyUnit === "SOL" ? 6 : 2)
    },
    holding: {
      medianMinutes: rounded(median(holdMinutes), 1),
      samples: holdMinutes.length
    },
    smartMove: {
      name: "Frog Smart Move",
      status: score >= 70 && buySpeed !== "late" ? "ready-to-paper-trade" : "watch-and-protect",
      buyTimingMs: rounded(medianBuyMs, 0),
      sellTimingMs: rounded(medianSellMs, 0),
      buySpeed,
      sellSpeed,
      recommendation: score >= 70 && buySpeed !== "late"
        ? "Follow Frog with the saved limit, keep the ladder guard on, and let the brain mark clean entries first."
        : "Keep copying small. The smart move is to protect capital while the brain learns more clean wins and losses.",
      rules: moveRules
    },
    rules,
    nextStep: score >= 70 && roundTripTokens >= 3
      ? "Ready for paper decisions: let it mark buy/skip without sending money."
      : "Keep learning from Frog before any self-trading is allowed."
  };
}
