const fields = [
  "gmgnApiKey",
  "heliusKey",
  "routeApi",
  "turnkeyOrgId",
  "turnkeyApiPublicKey",
  "turnkeyApiPrivateKey",
  "turnkeyPolicyId",
  "frogTradeWallet",
  "truenestTradeWallet",
  "frogSignerToken",
  "truenestSignerToken",
  "frogDeposit",
  "truenestDeposit",
  "safeWallet",
  "safeMax",
  "safeMode",
  "safeCopySizing",
  "safeTraderBankroll",
  "safeUseProfit",
  "safeTradeMode",
  "safeSurviveMode",
  "safeBuyMode",
  "safeSurviveMax",
  "frogWallet",
  "frogMax",
  "frogMode",
  "frogCopySizing",
  "frogTraderBankroll",
  "frogUseProfit",
  "frogTradeMode",
  "frogSurviveMode",
  "frogBuyMode",
  "frogSurviveMax",
  "truenestWallet",
  "truenestMax",
  "truenestMode",
  "truenestCopySizing",
  "truenestTraderBankroll",
  "truenestUseProfit",
  "truenestTradeMode",
  "truenestSurviveMode",
  "truenestBuyMode",
  "truenestSurviveMax",
  "queueFailureSwitchLimit",
  "walletSync",
  "riskControl",
  "liveTradingSwitch",
  "frogWalletSync",
  "frogRiskControl",
  "frogLiveTradingSwitch",
  "safeWalletSync",
  "safeRiskControl",
  "safeLiveTradingSwitch",
  "truenestWalletSync",
  "truenestRiskControl",
  "truenestLiveTradingSwitch",
  "vaultMode",
  "vaultFeePercent",
  "ownerProfitSharePercent",
  "referralRewardPercent",
  "ownerFeeWallet",
  "vaultNote"
];

const page = document.body.dataset.page || "customer";
const $ = (id) => document.getElementById(id);
let activeCustomerToken = "";
let activeReferralToken = "";
let latestState = { settings: {}, profiles: {}, trades: [], backend: {} };
let deferredInstallPrompt = null;
let stockAlarmEnabled = localStorage.getItem("stockAlarmEnabled") === "on";
let stockAlarmMutedKeys = new Set(JSON.parse(localStorage.getItem("stockAlarmMutedKeys") || "[]"));
let stockAlarmTimer = null;
let stockAlarmAudio = null;

function money(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function solAmount(value) {
  if (value === null || value === undefined || value === "") return "Checking...";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Checking...";
  return `${amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} SOL`;
}

function walletBalance(profile) {
  return latestState.walletBalances?.[profile] || {};
}

function heliusLimited() {
  return Object.values(latestState.walletBalances || {}).some((balance) => {
    return /helius.*limit|paid helius key|rate-limit|rate limit|429/i.test(String(balance?.warning || balance?.error || ""));
  });
}

function balanceUsdc(profile) {
  const value = Number(walletBalance(profile).usdc);
  return Number.isFinite(value) ? value : 0;
}

function profileDeposit(settings = {}, profile = "frog") {
  return Number(settings.frogDeposit || settings.truenestDeposit || 0);
}

function profileNet(settings = {}, profile = "frog") {
  return profileTotalWalletValue(settings, profile) - profileDeposit(settings, profile);
}

function profileLoss(settings = {}, profile = "frog") {
  return Math.max(0, -profileNet(settings, profile));
}

function profileLockedProfit(settings = {}, profile = "frog") {
  return Math.max(0, balanceUsdc(profile) - profileDeposit(settings, profile));
}

function profileTradeableUsdc(settings = {}, profile = "frog") {
  if (settings.frogUseProfit === "on") return Math.max(0, balanceUsdc(profile));
  return Math.max(0, Math.min(balanceUsdc(profile), profileDeposit(settings, profile)));
}

function queueFailureLimit(settings = {}) {
  const amount = Number(settings.queueFailureSwitchLimit || 3);
  return Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 3;
}

function signedMoney(value) {
  const amount = Number(value || 0);
  const sign = amount > 0 ? "+" : "";
  return `${sign}${money(amount)}`;
}

function traderSignalUsd(trade = {}) {
  const explicit = Number(trade.traderPnlUsd);
  if (Number.isFinite(explicit) && explicit !== 0) return explicit;
  const sourceBuy = Number(trade.sourceUsd || trade.execution?.sourceUsd || 0);
  const sourceSell = Number(trade.sourceReceivedUsd || trade.execution?.sourceReceivedUsd || 0);
  const action = String(trade.action || trade.execution?.action || "").toLowerCase();
  if (sourceSell) return sourceSell;
  if (sourceBuy && action.includes("buy")) return -Math.abs(sourceBuy);
  return 0;
}

function traderPnlFromTrades(trades = [], profile = "frog") {
  return trades
    .filter((trade) => profileTradeMatches(profile, trade))
    .reduce((sum, trade) => sum + traderSignalUsd(trade), 0);
}

function tradeDateValue(trade = {}) {
  const value = Date.parse(trade.time || trade.createdAt || "");
  return Number.isFinite(value) ? value : 0;
}

function sameLocalDay(leftMs, rightMs = Date.now()) {
  if (!leftMs) return false;
  const left = new Date(leftMs);
  const right = new Date(rightMs);
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function traderTodayPnlFromTrades(trades = [], profile = "frog") {
  return trades
    .filter((trade) => profileTradeMatches(profile, trade) && sameLocalDay(tradeDateValue(trade)))
    .reduce((sum, trade) => sum + traderSignalUsd(trade), 0);
}

function todayPnlLabel(value, name = "Trader") {
  const amount = Number(value || 0);
  if (amount > 0) return `${name} today profit: ${signedMoney(amount)}`;
  if (amount < 0) return `${name} today loss: ${signedMoney(amount)}`;
  return `${name} today: ${money(0)}`;
}

function tradeSide(trade = {}) {
  const action = String(trade.action || trade.execution?.action || "").toLowerCase();
  if (action.includes("sell")) return "sell";
  if (action.includes("buy")) return "buy";
  return "";
}

function tradeTokenKey(trade = {}) {
  return String(trade.tradedTokenMint || trade.tokenMint || trade.token || "").trim().toLowerCase();
}

function tradeTokenMint(trade = {}) {
  return String(trade.tradedTokenMint || trade.tokenMint || trade.token || "").trim();
}

function tradeStatusText(trade = {}) {
  return String(trade.status || trade.execution?.status || trade.executionError || "").toLowerCase();
}

function tradeDetailText(trade = {}) {
  return [
    trade.status,
    trade.executionError,
    trade.execution?.copySizingNote,
    trade.execution?.message,
    trade.note
  ].filter(Boolean).join(" ");
}

function tradeWasExecuted(trade = {}) {
  const text = tradeStatusText(trade);
  return text.includes("executed") || text.includes("manual sell sent") || Boolean(trade.execution?.txid || trade.signature);
}

function tradeUsdAmount(trade = {}) {
  const values = [
    trade.amount,
    trade.usd,
    trade.sourceUsd,
    trade.execution?.amount,
    trade.execution?.usd,
    trade.execution?.sourceUsd,
    trade.sourceReceivedUsd,
    trade.execution?.sourceReceivedUsd
  ];
  for (const value of values) {
    const amount = Number(value);
    if (Number.isFinite(amount) && amount > 0) return amount;
  }
  return 0;
}

function soldTokenKey(trade = {}) {
  const direct = tradeTokenKey(trade);
  const detail = tradeDetailText(trade);
  const heldMatch = detail.match(/sold last held copied token\s+([1-9A-HJ-NP-Za-km-z]{32,44})/i);
  if (heldMatch) return heldMatch[1].toLowerCase();
  return direct;
}

function positionSummariesFromTrades(trades = [], profile = "frog") {
  const roomTrades = trades
    .filter((trade) => profileTradeMatches(profile, trade) && tradeWasExecuted(trade))
    .slice()
    .sort((left, right) => tradeDateValue(left) - tradeDateValue(right));
  const sellSignals = trades
    .filter((trade) => profileTradeMatches(profile, trade) && tradeSide(trade) === "sell")
    .map((trade) => ({
      tokenKey: soldTokenKey(trade),
      time: trade.time || "",
      dateValue: tradeDateValue(trade),
      amount: tradeUsdAmount(trade),
      executed: tradeWasExecuted(trade),
      status: trade.status || trade.execution?.status || ""
    }))
    .sort((left, right) => left.dateValue - right.dateValue);
  const positions = new Map();

  roomTrades.forEach((trade) => {
    const side = tradeSide(trade);
    const amount = tradeUsdAmount(trade);
    if (!amount) return;

    if (side === "buy") {
      const key = tradeTokenKey(trade) || `unknown-${positions.size + 1}`;
      const mint = tradeTokenMint(trade);
      const existing = positions.get(key) || {
        token: trade.token || trade.tradedTokenMint || trade.tokenMint || "Unknown coin",
        tokenMint: mint,
        tokenKey: key,
        boughtUsd: 0,
        soldUsd: 0,
        buys: 0,
        sells: 0,
        firstBuyDateValue: 0,
        lastBuyTime: ""
      };
      existing.boughtUsd += amount;
      existing.buys += 1;
      if (!existing.firstBuyDateValue) existing.firstBuyDateValue = tradeDateValue(trade);
      existing.lastBuyTime = trade.time || existing.lastBuyTime;
      positions.set(key, existing);
    }

    if (side === "sell") {
      const key = soldTokenKey(trade);
      const target = positions.get(key);
      if (target) {
        target.soldUsd += amount;
        target.sells += 1;
        return;
      }

      const fallback = Array.from(positions.values()).find((position) => {
        return Math.max(0, position.boughtUsd - position.soldUsd) > 0;
      });
      if (fallback) {
        fallback.soldUsd += amount;
        fallback.sells += 1;
      }
    }
  });

  return Array.from(positions.values())
    .map((position) => {
      const relatedSells = sellSignals.filter((sell) => {
        const sameToken = sell.tokenKey && sell.tokenKey === position.tokenKey;
        const afterBuy = !position.firstBuyDateValue || !sell.dateValue || sell.dateValue >= position.firstBuyDateValue;
        return sameToken && afterBuy;
      });
      return {
        ...position,
        openUsd: Math.max(0, position.boughtUsd - position.soldUsd),
        traderSellSignals: relatedSells.length,
        failedSellSignals: relatedSells.filter((sell) => !sell.executed).length,
        lastSellSignalTime: relatedSells.at(-1)?.time || ""
      };
    })
    .sort((left, right) => right.openUsd - left.openUsd);
}

function openPositionsFromTrades(trades = [], profile = "frog") {
  return positionSummariesFromTrades(trades, profile)
    .filter((position) => position.openUsd > 0.01)
    .sort((left, right) => right.openUsd - left.openUsd);
}

function stockCoinsFromTrades(trades = [], profile = "frog") {
  return positionSummariesFromTrades(trades, profile)
    .filter((position) => position.openUsd > 0.01 && position.traderSellSignals > 0)
    .sort((left, right) => right.failedSellSignals - left.failedSellSignals || right.openUsd - left.openUsd);
}

function allStockCoinsFromTrades(trades = []) {
  return ["safe", "frog", "truenest"]
    .flatMap((profile) => stockCoinsFromTrades(trades, profile).map((position) => ({ ...position, profile })));
}

function stockCoinKey(position = {}) {
  return `${position.profile || "frog"}:${String(position.tokenKey || position.token || "").toLowerCase()}`;
}

function closedTradesFromTrades(trades = [], profile = "frog") {
  return positionSummariesFromTrades(trades, profile)
    .filter((position) => position.boughtUsd > 0.01 && position.soldUsd >= position.boughtUsd - 0.01)
    .sort((left, right) => right.soldUsd - left.soldUsd);
}

function profileOpenValue(trades = [], profile = "frog") {
  return openPositionsFromTrades(trades, profile).reduce((sum, position) => sum + position.openUsd, 0);
}

function profileTotalWalletValue(settings = {}, profile = "frog") {
  return balanceUsdc(profile) + profileOpenValue(latestState.trades || [], profile);
}

function renderOpenPositions(listId, summaryId, trades = [], profile = "frog") {
  const list = $(listId);
  const positions = openPositionsFromTrades(trades, profile);
  const openValue = positions.reduce((sum, position) => sum + position.openUsd, 0);
  setText(summaryId, money(openValue));
  if (!list) return;
  list.innerHTML = "";
  if (!positions.length) {
    const li = document.createElement("li");
    li.textContent = "No coin he has not sold yet is showing now.";
    list.appendChild(li);
    return;
  }

  positions.forEach((position) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <strong>${escapeHtml(position.token)}</strong>
      <span>Bought: ${money(position.boughtUsd)} | Sold: ${money(position.soldUsd)} | Still open: ${money(position.openUsd)}</span>
      <em>He has not sold this one fully yet. ${position.buys} buy${position.buys === 1 ? "" : "s"}${position.lastBuyTime ? ` · ${escapeHtml(position.lastBuyTime)}` : ""}</em>
    `;
    list.appendChild(li);
  });
}

function renderStockCoins(listId, trades = [], profile = "frog") {
  const list = $(listId);
  if (!list) return;
  const positions = stockCoinsFromTrades(trades, profile);
  list.innerHTML = "";
  if (!positions.length) {
    const li = document.createElement("li");
    li.textContent = "No stock coin is showing now.";
    list.appendChild(li);
    return;
  }

  positions.forEach((position) => {
    const li = document.createElement("li");
    li.className = "tape-loss";
    const resultId = `stockSellResult-${profile}-${position.tokenKey}`.replace(/[^a-z0-9_-]/gi, "-");
    const mint = position.tokenMint || position.token;
    li.innerHTML = `
      <strong>${escapeHtml(position.token)}</strong>
      <span>Still open: ${money(position.openUsd)} | Trader sell signals seen: ${position.traderSellSignals}</span>
      <span>How it got stock: he sold this coin, but your wallet still shows open value. Sell it here to clear it.</span>
      <em>Check this coin. He has sold before, but our side may still be holding it${position.lastSellSignalTime ? ` · ${escapeHtml(position.lastSellSignalTime)}` : ""}</em>
      <button class="stop-action stock-sell-action" type="button">Auto sell this stock coin</button>
      <small id="${escapeHtml(resultId)}">Not sold from this button yet.</small>
    `;
    li.querySelector("button")?.addEventListener("click", () => {
      ownerSellToken(profile, {
        mint,
        openUsd: position.openUsd,
        resultId
      });
    });
    list.appendChild(li);
  });
}

function renderStockCoinHistory(trades = []) {
  const list = $("stockCoinHistory");
  if (!list) return;
  const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const rows = trades
    .filter((trade) => /stock coin sell/i.test(String(trade.action || "")))
    .filter((trade) => {
      const date = tradeDateValue(trade);
      return !date || date >= oneWeekAgo;
    })
    .slice(0, 30);
  list.innerHTML = "";
  if (!rows.length) {
    const li = document.createElement("li");
    li.textContent = "No stock coin sell history yet.";
    list.appendChild(li);
    return;
  }
  rows.forEach((trade) => {
    const pnl = Number(trade.pnl || 0);
    const li = document.createElement("li");
    li.className = pnl >= 0 ? "tape-win" : "tape-loss";
    li.innerHTML = `
      <strong>${pnl >= 0 ? "Made more" : "Lose"}: ${signedMoney(pnl)}</strong>
      <span>${escapeHtml(trade.token || trade.tradedToken || "-")} | Sold: ${money(trade.amount)} | ${escapeHtml(trade.profile || "-")}</span>
      <em>${escapeHtml(trade.time || "This week")} · ${escapeHtml(trade.status || "Stock coin sold")}</em>
    `;
    list.appendChild(li);
  });
}

function renderClosedTradesList(listId, trades = [], profile = "frog") {
  const list = $(listId);
  if (!list) return;
  const positions = closedTradesFromTrades(trades, profile).slice(0, 8);
  list.innerHTML = "";
  if (!positions.length) {
    const li = document.createElement("li");
    li.textContent = "No closed trade is showing now.";
    list.appendChild(li);
    return;
  }

  positions.forEach((position) => {
    const li = document.createElement("li");
    li.className = "tape-win";
    li.innerHTML = `
      <strong>${escapeHtml(position.token)}</strong>
      <span>Bought: ${money(position.boughtUsd)} | Sold: ${money(position.soldUsd)}</span>
      <em>Bought and sold successfully.</em>
    `;
    list.appendChild(li);
  });
}

function latestTraderClosedResult(trades = [], profile = "frog") {
  const roomTrades = trades.filter((trade) => profileTradeMatches(profile, trade));
  const newestSellIndex = roomTrades.findIndex((trade) => tradeSide(trade) === "sell");
  if (newestSellIndex === -1) {
    const openBuy = roomTrades.find((trade) => tradeSide(trade) === "buy");
    if (!openBuy) return { state: "none", label: "No trader result yet.", amount: 0 };
    return {
      state: "open",
      label: `Open buy: ${money(openBuy.sourceUsd || openBuy.amount)} not sold yet.`,
      amount: 0,
      token: openBuy.token || ""
    };
  }

  const sell = roomTrades[newestSellIndex];
  const sellReceived = Number(sell.sourceReceivedUsd || sell.traderPnlUsd || 0);
  const tokenKey = tradeTokenKey(sell);
  const priorBuy = roomTrades
    .slice(newestSellIndex + 1)
    .find((trade) => tradeSide(trade) === "buy" && (!tokenKey || tradeTokenKey(trade) === tokenKey));
  const buyUsed = Number(priorBuy?.sourceUsd || 0);

  if (!buyUsed || !sellReceived) {
    return {
      state: "unknown",
      label: sellReceived ? `Last sell received ${money(sellReceived)}. Buy cost not found yet.` : "Last sell found, but value is still reading.",
      amount: 0,
      token: sell.token || ""
    };
  }

  const amount = sellReceived - buyUsed;
  return {
    state: amount >= 0 ? "profit" : "loss",
    label: amount >= 0
      ? `Last trader profit: ${signedMoney(amount)}`
      : `Last trader loss: ${signedMoney(amount)}`,
    amount,
    token: sell.token || priorBuy?.token || ""
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function value(id) {
  return $(id)?.value.trim() || "";
}

function setText(id, text) {
  const node = $(id);
  if (node) node.textContent = text;
}

function setHidden(id, hidden) {
  const node = $(id);
  if (node) node.classList.toggle("hidden", hidden);
}

function runningStandalone() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent || "");
}

function updateInstallButton() {
  const button = $("installOwnerApp");
  if (!button) return;
  if (runningStandalone()) {
    button.textContent = "SignalPilot App Installed";
    button.disabled = true;
    return;
  }
  button.disabled = false;
  button.textContent = isIosDevice() ? "Add SignalPilot to iPhone" : "Install SignalPilot App";
}

async function installOwnerApp() {
  if (runningStandalone()) {
    showBusinessMessage("SignalPilot is already opening like an app.");
    return;
  }
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(() => null);
    deferredInstallPrompt = null;
    updateInstallButton();
    return;
  }
  const message = isIosDevice()
    ? "On iPhone: tap Share, then tap Add to Home Screen. It will open like an app."
    : "Use your browser menu and choose Install app or Add to Home Screen.";
  showBusinessMessage(message);
}

function setupOwnerWebAppInstall() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => null);
  }
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallButton();
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    updateInstallButton();
    showBusinessMessage("SignalPilot app installed.");
  });
  updateInstallButton();
}

function publicUrl(path) {
  return `${window.location.origin}${path}`;
}

function tokenFromLink(input) {
  const text = String(input || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text, window.location.origin);
    const match = url.pathname.match(/^\/player\/([^/]+)/);
    if (match) return match[1];
  } catch {}
  const match = text.match(/\/player\/([^/\s]+)/);
  return match ? match[1] : text.replace(/^\/+/, "");
}

function tokenFromLocation() {
  const match = window.location.pathname.match(/^\/player\/([^/]+)/);
  return match ? match[1] : "";
}

function referralFromLocation() {
  const match = window.location.pathname.match(/^\/join\/([^/]+)/);
  return match ? match[1] : "";
}

function payload() {
  const data = {};
  fields.forEach((id) => {
    const node = $(id);
    if (node) data[id] = value(id);
  });
  return data;
}

function setLog(lines) {
  const activityLog = $("activityLog");
  if (!activityLog) return;
  activityLog.innerHTML = "";
  lines.forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    activityLog.appendChild(li);
  });
}

function renderTrades(trades = []) {
  const tradeRows = $("tradeRows");
  if (!tradeRows) return;
  tradeRows.innerHTML = "";
  if (!trades.length) {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="7">No copied trade yet. When SignalPilot trades, every buy and sell will show here.</td>';
    tradeRows.appendChild(row);
    return;
  }

  trades.forEach((trade) => {
    const row = document.createElement("tr");
    const pnl = Number(trade.pnl || 0);
    row.className = pnl >= 0 ? "win-row" : "loss-row";
    row.innerHTML = `
      <td>${trade.time || "-"}</td>
      <td>${trade.profile || "-"}</td>
      <td>${trade.action || "-"}</td>
      <td>${trade.token || "-"}</td>
      <td>${money(trade.amount)}</td>
      <td>${money(pnl)}</td>
      <td>${trade.status || "-"}</td>
    `;
    tradeRows.appendChild(row);
  });
}

function stockAlarmCandidates(trades = []) {
  return allStockCoinsFromTrades(trades).filter((position) => !stockAlarmMutedKeys.has(stockCoinKey(position)));
}

function beepOnce() {
  try {
    stockAlarmAudio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (stockAlarmAudio.state === "suspended") stockAlarmAudio.resume();
    const now = stockAlarmAudio.currentTime;
    [0, 0.18, 0.36, 0.54].forEach((offset) => {
      const oscillator = stockAlarmAudio.createOscillator();
      const gain = stockAlarmAudio.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = 920;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.9, now + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.13);
      oscillator.connect(gain).connect(stockAlarmAudio.destination);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.14);
    });
  } catch {}
}

function updateStockAlarm(trades = []) {
  const candidates = stockAlarmCandidates(trades);
  setText("stockAlarmStatus", stockAlarmEnabled
    ? candidates.length
      ? `LOUD BEEP ON: ${candidates.length} stock coin${candidates.length === 1 ? "" : "s"} needs attention.`
      : "LOUD BEEP ON: no new stock coin needing attention now."
    : "Stock coin alarm is off until you enable it once.");
  if (stockAlarmTimer) {
    clearInterval(stockAlarmTimer);
    stockAlarmTimer = null;
  }
  if (!stockAlarmEnabled || !candidates.length) return;
  beepOnce();
  stockAlarmTimer = setInterval(() => {
    if (!stockAlarmEnabled || !stockAlarmCandidates(latestState.trades || []).length) {
      clearInterval(stockAlarmTimer);
      stockAlarmTimer = null;
      return;
    }
    beepOnce();
  }, 1400);
}

function enableStockAlarm() {
  stockAlarmEnabled = true;
  localStorage.setItem("stockAlarmEnabled", "on");
  beepOnce();
  updateStockAlarm(latestState.trades || []);
  showBusinessMessage("Loud stock coin beep enabled.");
}

function clearStockAlarm() {
  stockAlarmCandidates(latestState.trades || []).forEach((position) => {
    stockAlarmMutedKeys.add(stockCoinKey(position));
  });
  localStorage.setItem("stockAlarmMutedKeys", JSON.stringify([...stockAlarmMutedKeys]));
  updateStockAlarm(latestState.trades || []);
  showBusinessMessage("Stock coin alert cleared. New stock coins will beep again.");
}

function renderVault(settings = {}, profiles = {}) {
  const frogDeposit = Number(settings.frogDeposit || 0);
  const frogPnl = Number(profiles.frog?.profit || 0);
  const truenestPnl = Number(profiles.truenest?.profit || 0);
  const deposited = frogDeposit;
  const profit = frogPnl + truenestPnl;
  const feePercent = Number(settings.vaultFeePercent || 0);
  const fee = Math.max(0, profit) * (feePercent / 100);
  const withdrawable = deposited + profit - fee;

  setText("vaultStatus", settings.vaultMode === "business" ? "Business vault mode" : "Private owner mode");
  setText("vaultDeposited", money(deposited));
  setText("vaultProfit", money(profit));
  setText("vaultFee", money(fee));
  setText("vaultFeeNote", feePercent ? `${feePercent}% profit-share is only for future customer mode.` : "No fee taken from your private vault now.");
  setText("vaultWithdrawable", money(withdrawable));
}

function percent(value) {
  const amount = Number(value || 0);
  return `${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function localReady(data = payload()) {
  return Boolean(
    data.heliusKey &&
    data.routeApi &&
    data.turnkeyOrgId &&
    data.turnkeyApiPublicKey &&
    data.turnkeyApiPrivateKey &&
    data.frogTradeWallet &&
    data.frogSignerToken
  );
}

function profileName(profile) {
  if (profile === "safe") return "Frog safe bot";
  if (profile === "truenest") return "Trunoest risk bot";
  return "Deku riskier bot";
}

function profileStatusName(profile) {
  return profileName(profile);
}

function profileTradeMatches(profile, trade) {
  const text = String(trade.profile || "").toLowerCase();
  if (profile === "safe") return text.includes("frog safe") || text.includes("safe bot") || text.includes("beginner") || text === "frog";
  if (profile === "truenest") return text.includes("risk win") || text.includes("truenest") || text.includes("trunoest") || text.includes("big win") || text.includes("risk bot");
  return text.includes("decu win") || text.includes("deku") || text.includes("decu") || text.includes("smart win") || text.includes("deku riskier");
}

function profileSetting(settings, profile, key, fallback = "") {
  const prefix = ["safe", "frog", "truenest"].includes(profile) ? profile : "frog";
  const profileKey = `${prefix}${key[0].toUpperCase()}${key.slice(1)}`;
  return settings[profileKey] || settings[key] || fallback;
}

function queueSurviveMode(settings = {}) {
  return queueBuyMode(settings) === "survive";
}

function normalizeBuyMode(mode) {
  const value = String(mode || "").toLowerCase();
  if (value === "survive" || value.includes("survive")) return "survive";
  if (value === "exact" || value.includes("exact")) return "exact";
  return "cap50";
}

function queueBuyMode(settings = {}) {
  if (settings.frogBuyMode || settings.truenestBuyMode) {
    return normalizeBuyMode(settings.frogBuyMode || settings.truenestBuyMode);
  }
  return settings.frogSurviveMode === "on" || settings.truenestSurviveMode === "on" ? "survive" : "cap50";
}

function buyModeLabel(mode) {
  if (mode === "survive") return "Survive Mode";
  if (mode === "exact") return "Copy exactly what trader does";
  return "Highest buy $50 mode";
}

function surviveMax(settings = {}) {
  const amount = Number(settings.frogSurviveMax || settings.truenestSurviveMax || 5);
  return Number.isFinite(amount) && amount > 0 ? amount : 5;
}

function buyModeNote(mode, max = 5) {
  if (mode === "survive") return `Survive Mode: buys below $${max} copy exact, bigger buys use $${max} max.`;
  if (mode === "exact") return "Copy exactly what trader does: buys use the same dollar amount as the copied trader.";
  return "Highest buy $50 mode: buys below $50 copy exact, bigger buys use $50 max.";
}

function normalizeCopyMode(mode) {
  const value = String(mode || "Copy exact amount").toLowerCase();
  return value.includes("safety") || value.includes("protect")
    ? "Copy exact amount after safety check"
    : "Copy exact amount";
}

function modeUsesProtection(mode) {
  return normalizeCopyMode(mode) === "Copy exact amount after safety check";
}

function roomPrefix(profile) {
  if (profile === "safe") return "safe";
  return profile === "truenest" ? "truenest" : "frog";
}

function syncRoomProtectionFromMode(profile) {
  const prefix = roomPrefix(profile);
  const mode = normalizeCopyMode(value(`${prefix}Mode`));
  const modeNode = $(`${prefix}Mode`);
  const riskNode = $(`${prefix}RiskControl`);
  if (modeNode) modeNode.value = mode;
  if (riskNode) riskNode.value = modeUsesProtection(mode) ? "on" : "off";
  updateProtectionUi(profile);
}

function syncRoomModeFromProtection(profile) {
  const prefix = roomPrefix(profile);
  const riskNode = $(`${prefix}RiskControl`);
  const modeNode = $(`${prefix}Mode`);
  if (!riskNode) return;
  if (modeNode) modeNode.value = riskNode.value === "on" ? "Copy exact amount after safety check" : "Copy exact amount";
  updateProtectionUi(profile);
}

function updateProtectionUi(profile) {
  const prefix = roomPrefix(profile);
  const riskNode = $(`${prefix}RiskControl`);
  const maxNode = $(`${prefix}Max`);
  const maxLabel = $(`${prefix}MaxLabel`);
  if (!riskNode) return;
  const protectedMode = riskNode.value === "on";
  if (maxNode) maxNode.disabled = !protectedMode;
  if (maxLabel) {
    maxLabel.childNodes[0].textContent = protectedMode
      ? "Protect me max buy "
      : "Exact copy ignores max buy ";
  }
}

function syncAllRoomControlsFromProtection() {
  ["frog", "truenest"].forEach(syncRoomModeFromProtection);
}

function currentPayload() {
  syncAllRoomControlsFromProtection();
  return payload();
}

async function saveRoomSettings(profile) {
  try {
    await saveSettings();
    showBusinessMessage(`${profileName(profile)} choice saved.`);
  } catch (error) {
    showBusinessMessage(error.message, true);
  }
}

function renderRoomThread(profile, trades = []) {
  const list = $(`${profile}RoomThread`);
  if (!list) return;
  list.innerHTML = "";
  const label = profileName(profile);
  const recent = trades.slice(0, 5);
  if (!recent.length) {
    const li = document.createElement("li");
    li.textContent = `No ${label} copied trade yet.`;
    list.appendChild(li);
    return;
  }

  recent.forEach((trade) => {
    const li = document.createElement("li");
    const time = trade.time ? `${trade.time} - ` : "";
    const detail = `${time}${trade.token || "-"} - ${money(trade.amount)} - ${trade.status || "-"}`;
    li.innerHTML = `
      <strong>${escapeHtml(trade.action || "Copied signal")}</strong>
      <span>${escapeHtml(detail)}</span>
    `;
    list.appendChild(li);
  });
}

function renderRoomStatus(profile, settings = {}, trades = [], backend = {}) {
  const label = profileName(profile);
  const roomTrades = trades.filter((trade) => profileTradeMatches(profile, trade));
  const wins = roomTrades.filter((trade) => Number(trade.pnl || 0) > 0 || /\bwin\b|\bprofit\b/i.test(String(trade.status || ""))).length;
  const mode = normalizeCopyMode(profileSetting(settings, profile, "mode", "Copy exact amount"));
  const riskControl = modeUsesProtection(mode) ? "on" : "off";
  const liveSwitch = profileSetting(settings, profile, "liveTradingSwitch", "on");
  const walletSync = settings.frogWalletSync || settings.walletSync || "Turnkey server wallet";
  const tradeMode = profileSetting(settings, profile, "tradeMode", "both");
  const sellOnly = tradeMode === "sellOnly";
  const buyMode = queueBuyMode(settings);
  const maxSurviveBuy = surviveMax(settings);
  const productionExecution = backend.productionExecution === true || backend.liveTrading === true;
  const lastTraderResult = latestTraderClosedResult(trades, profile);
  const todayTraderPnl = traderTodayPnlFromTrades(trades, profile);
  const traderName = profile === "frog" ? "Decu" : "Risk guy";

  setText(`${profile}Wins`, String(wins));
  setText(`${profile}Signals`, String(roomTrades.length));
  setText(`${profile}RoomUsdc`, money(balanceUsdc(profile)));
  setText(`${profile}RoomOpenValue`, money(profileOpenValue(trades, profile)));
  setText(`${profile}RoomTotalValue`, money(profileTotalWalletValue(settings, profile)));
  setText(`${profile}RoomLockedProfit`, money(profileLockedProfit(settings, profile)));
  setText(`${profile}RoomTradeable`, money(profileTradeableUsdc(settings, profile)));
  setText(`${profile}RoomLoss`, money(profileLoss(settings, profile)));
  setText(`${profile}RoomTraderPnl`, signedMoney(traderPnlFromTrades(trades, profile)));
  setText(`${profile}RoomTraderToday`, signedMoney(todayTraderPnl));
  setText(`${profile}RoomTraderLast`, lastTraderResult.label);
  setText(`${profile}RoomTraderTodayNote`, todayPnlLabel(todayTraderPnl, traderName));
  renderOpenPositions(`${profile}OpenPositions`, `${profile}RoomOpenValue`, trades, profile);
  renderStockCoins(`${profile}StockCoins`, trades, profile);
  renderClosedTradesList(`${profile}ClosedTrades`, trades, profile);
  const modeStatus = sellOnly
    ? `${label} is SELL ONLY: new buys are blocked, sells still work.`
    : `${label} can buy and sell. ${buyModeNote(buyMode, maxSurviveBuy)} Sells still follow.`;
  setText(`${profile}TradeModeStatus`, modeStatus);
  if ($(`${profile}SellOnly`)) $(`${profile}SellOnly`).disabled = sellOnly;
  if ($(`${profile}ResumeBuying`)) $(`${profile}ResumeBuying`).disabled = !sellOnly;
  if ($(`${profile}BuyMode`) && document.activeElement !== $(`${profile}BuyMode`)) $(`${profile}BuyMode`).value = buyMode;
  if ($(`${profile}SurviveMax`) && document.activeElement !== $(`${profile}SurviveMax`)) $(`${profile}SurviveMax`).value = String(maxSurviveBuy);
  if ($(`${profile}BuyModeSave`)) $(`${profile}BuyModeSave`).textContent = `Save ${buyModeLabel(buyMode)}`;
  setText(`${profile}SurviveNote`, buyModeNote(buyMode, maxSurviveBuy));
  renderRoomThread(profile, roomTrades);
  setText(`${profile}SafeStatus`, riskControl === "off" ? "Exact copy, no protection" : "Protect me ON");
  setText(`${profile}WalletStatus`, walletSync === "Turnkey server wallet"
    ? `Turnkey server wallet is selected for ${label}.`
    : `Manual wallet only is selected for ${label}.`);

  if (walletSync !== "Turnkey server wallet") {
    setText(`${profile}LiveStatus`, "Manual wallet means the site can watch and show signals, but it cannot sign automatic buy/sell.");
  } else if (liveSwitch !== "on") {
    setText(`${profile}LiveStatus`, `${label} is monitor-only until you change Allow live trading to ON.`);
  } else if (productionExecution) {
    setText(`${profile}LiveStatus`, `${label} can execute when you press Start and the copied trader makes a swap.`);
  } else {
    setText(`${profile}LiveStatus`, `${label} switch is ON, but Render production execution is still locked.`);
  }
}

function chartPointsFromTrades(trades = [], profile = "frog", profit = 0) {
  const roomTrades = trades.filter((trade) => profileTradeMatches(profile, trade)).slice(0, 10).reverse();
  if (!roomTrades.length) {
    return [
      [20, 170],
      [170, 170],
      [320, 170],
      [470, 170],
      [620, 170]
    ];
  }

  let running = 0;
  const hasPnl = roomTrades.some((trade) => Number(trade.pnl || 0) !== 0);
  const values = roomTrades.map((trade, index) => {
    const pnl = Number(trade.pnl || 0);
    running += hasPnl ? pnl : 1;
    return running;
  });
  values.push(Number(profit || running || 0));
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const range = max - min || 1;
  return values.map((value, index) => {
    const x = 20 + (index * (600 / Math.max(values.length - 1, 1)));
    const y = 185 - (((value - min) / range) * 145);
    return [Math.round(x), Math.round(y)];
  });
}

function pathFromPoints(points = []) {
  if (!points.length) return "";
  return points.map((point, index) => `${index ? "L" : "M"}${point[0]} ${point[1]}`).join(" ");
}

function renderWatchTape(profile, trades = []) {
  const tape = $("watchTape");
  if (!tape) return;
  tape.innerHTML = "";
  const label = profileName(profile);
  const roomTrades = trades.filter((trade) => profileTradeMatches(profile, trade)).slice(0, 8);
  if (!roomTrades.length) {
    const li = document.createElement("li");
    li.textContent = `Waiting for Decu / ${label} to make a trade.`;
    tape.appendChild(li);
    return;
  }

  roomTrades.forEach((trade) => {
    const pnl = Number(trade.pnl || 0);
    const detail = trade.executionError || trade.execution?.copySizingNote || "";
    const li = document.createElement("li");
    li.className = pnl >= 0 ? "tape-win" : "tape-loss";
    li.innerHTML = `
      <strong>${escapeHtml(trade.action || "Copied signal")}</strong>
      <span>${escapeHtml(trade.token || "-")} - ${money(trade.amount)} - ${escapeHtml(trade.status || "Observed")}</span>
      ${detail ? `<span>${escapeHtml(detail)}</span>` : ""}
      <em>${trade.time ? escapeHtml(trade.time) : "live"}</em>
    `;
    tape.appendChild(li);
  });
}

function renderLiveWatch(settings = {}, profiles = {}, trades = [], strategy = {}) {
  const profile = ["safe", "frog", "truenest"].includes(strategy.activeProfile) ? strategy.activeProfile : (profiles.frog?.running || !profiles.truenest?.running ? "frog" : "truenest");
  const label = profileName(profile);
  const prefix = roomPrefix(profile);
  const deposit = settings.frogDeposit || settings[`${prefix}Deposit`] || 0;
  const wallet = settings.frogTradeWallet || settings[`${prefix}TradeWallet`] || "";
  const balance = walletBalance(profile);
  const gasText = balance.error ? `Gas check: ${balance.error}` : `SOL gas: ${solAmount(balance.sol)}`;
  const profit = Number(profiles[profile]?.profit || 0);
  const usdcNow = balanceUsdc(profile);
  const openValue = profileOpenValue(trades, profile);
  const totalWalletValue = profileTotalWalletValue(settings, profile);
  const lossNow = profileLoss(settings, profile);
  const traderPnl = traderPnlFromTrades(trades, profile);
  const traderTodayPnl = traderTodayPnlFromTrades(trades, profile);
  const lastTraderResult = latestTraderClosedResult(trades, profile);
  const running = Boolean(profiles[profile]?.running);
  const roomTrades = trades.filter((trade) => profileTradeMatches(profile, trade));
  const lastTrade = roomTrades[0];
  const heliusBlocked = heliusLimited();

  setText("watchProfileName", label);
  setText("watchProfileStatus", running
    ? `${label} is watching and ready to copy.`
    : heliusBlocked
      ? `${label} is locked until the paid Helius key stops returning 429.`
      : `${label} is ready. Press Start when you want it to watch Decu.`);
  setText("watchDeposit", money(deposit));
  setText("watchWallet", wallet ? `Wallet ${wallet} | ${gasText}` : "Wallet not connected yet");
  setText("watchProfit", money(profit));
  setText("watchProfitNote", profit > 0 ? "Profit is positive." : profit < 0 ? "Profit is negative." : "No profit recorded yet.");
  setText("watchUsdcNow", money(usdcNow));
  setText("watchLossNow", `He has not sold yet: ${money(openValue)} | Total value: ${money(totalWalletValue)} | Real sold loss: ${money(lossNow)}`);
  setText("watchOpenValue", money(openValue));
  setText("watchTotalValue", money(totalWalletValue));
  setText("watchTraderPnl", signedMoney(traderPnl));
  setText("watchTraderNote", `${label.includes("Deku") ? "Deku" : "Copied trader"} total visible made/lost from buy and sell signals.`);
  setText("watchTraderToday", signedMoney(traderTodayPnl));
  setText("watchTraderTodayNote", todayPnlLabel(traderTodayPnl, label.includes("Deku") ? "Deku" : label));
  setText("watchTraderLast", lastTraderResult.label);
  setText("watchLastAction", lastTrade?.action || "Waiting");
  setText("watchLastToken", lastTrade ? `${lastTrade.token || "-"} - ${lastTrade.status || "Observed"}` : "No buy or sell shown yet.");
  setText("watchLiveBadge", running ? "Live watch ON" : "Waiting");
  setText("watchChartNote", roomTrades.length ? `${roomTrades.length} copied signal${roomTrades.length === 1 ? "" : "s"} on screen.` : "Chart starts when copied trades appear.");

  const badge = $("watchLiveBadge");
  if (badge) badge.classList.toggle("is-live", running);
  renderOpenPositions("watchOpenPositions", "watchOpenValue", trades, profile);
  renderStockCoins("watchStockCoins", trades, profile);
  renderClosedTradesList("watchClosedTrades", trades, profile);

  const points = chartPointsFromTrades(trades, profile, profit);
  const path = $("watchChartPath");
  const dot = $("watchChartDot");
  if (path) path.setAttribute("d", pathFromPoints(points));
  if (dot && points.length) {
    const last = points[points.length - 1];
    dot.setAttribute("cx", last[0]);
    dot.setAttribute("cy", last[1]);
  }
  renderWatchTape(profile, trades);
}

function renderState(state) {
  latestState = {
    ...latestState,
    ...state,
    settings: { ...(latestState.settings || {}), ...(state.settings || {}) },
    profiles: { ...(latestState.profiles || {}), ...(state.profiles || {}) },
    trades: state.trades || latestState.trades || [],
    backend: { ...(latestState.backend || {}), ...(state.backend || {}) },
    strategy: { ...(latestState.strategy || {}), ...(state.strategy || {}) },
    walletBalances: state.walletBalances || latestState.walletBalances || {}
  };
  const settings = latestState.settings || {};
  const profiles = latestState.profiles || {};
  const trades = latestState.trades || [];
  const backend = latestState.backend || {};
  const strategy = latestState.strategy || {};
  const liveTradingEnv = backend.liveTradingEnv === true;
  const productionExecution = backend.productionExecution === true || backend.liveTrading === true;
  const queueRunning = Boolean(profiles.safe?.running || profiles.frog?.running || profiles.truenest?.running);
  const queueActiveLabel = profileName(strategy.activeProfile || "frog");
  const buyMode = queueBuyMode(settings);
  const maxSurviveBuy = surviveMax(settings);
  const failureLimit = queueFailureLimit(settings);

  fields.forEach((id) => {
    const node = $(id);
    if (node && settings[id] && document.activeElement !== node) node.value = settings[id];
  });
  ["frog", "truenest"].forEach(syncRoomProtectionFromMode);

  const ready = localReady(settings);
  const heliusBlocked = heliusLimited();
  if ($("frogStart")) $("frogStart").disabled = !ready || heliusBlocked || profiles.frog?.running;
  if ($("truenestStart")) $("truenestStart").disabled = !ready || heliusBlocked || profiles.truenest?.running;
  if ($("frogStop")) $("frogStop").disabled = !profiles.frog?.running;
  if ($("truenestStop")) $("truenestStop").disabled = !profiles.truenest?.running;
  if ($("queueStart")) $("queueStart").disabled = !ready || heliusBlocked || queueRunning;
  if ($("queueStop")) $("queueStop").disabled = !queueRunning;
  [
    ["switchSafeBot", "safe"],
    ["switchDekuBot", "frog"],
    ["switchTrunoestBot", "truenest"]
  ].forEach(([id, profile]) => {
    const button = $(id);
    if (!button) return;
    const active = strategy.activeProfile === profile && queueRunning;
    button.disabled = !ready || heliusBlocked || active;
    button.classList.toggle("active-switch", active);
  });
  if ($("queueBuyMode") && document.activeElement !== $("queueBuyMode")) $("queueBuyMode").value = buyMode;
  if ($("queueSurviveMax") && document.activeElement !== $("queueSurviveMax")) $("queueSurviveMax").value = String(maxSurviveBuy);
  if ($("queueBuyModeSave")) $("queueBuyModeSave").textContent = `Save ${buyModeLabel(buyMode)}`;
  setText("queueControlStatus", strategy.paused
    ? `Paused: ${strategy.pauseReason || "restart required."}`
    : queueRunning
      ? `${queueActiveLabel} is active now. Frog failures ${Number(strategy.safeLosses || 0)}/${failureLimit}, Deku failures ${Number(strategy.frogLosses || 0)}/${failureLimit}, Trunoest failures ${Number(strategy.truenestLosses || 0)}/${failureLimit}. Switched-from traders are still watched for sells.`
      : `Ready: one click starts Decu first. After ${failureLimit} failures, the app switches traders and still watches the old trader for sells.`);
  setText("queueControlNote", buyModeNote(buyMode, maxSurviveBuy));

  setText("frogProfit", money(profiles.frog?.profit));
  setText("truenestProfit", money(profiles.truenest?.profit));
  setText("frogRoomProfit", money(profiles.frog?.profit));
  setText("truenestRoomProfit", money(profiles.truenest?.profit));
  setText("frogBalance", `Deposit: ${money(settings.frogDeposit)}`);
  setText("truenestBalance", `Shared deposit: ${money(settings.frogDeposit)}`);
  setText("frogUsdcNow", money(balanceUsdc("frog")));
  setText("truenestUsdcNow", money(balanceUsdc("truenest")));
  setText("frogOpenValue", money(profileOpenValue(trades, "frog")));
  setText("truenestOpenValue", money(profileOpenValue(trades, "truenest")));
  setText("frogTotalValue", money(profileTotalWalletValue(settings, "frog")));
  setText("truenestTotalValue", money(profileTotalWalletValue(settings, "truenest")));
  setText("frogLoss", money(profileLoss(settings, "frog")));
  setText("truenestLoss", money(profileLoss(settings, "truenest")));
  setText("frogSolBalance", solAmount(walletBalance("frog").sol));
  setText("truenestSolBalance", solAmount(walletBalance("truenest").sol));
  setText("frogTraderPnl", signedMoney(traderPnlFromTrades(trades, "frog")));
  setText("truenestTraderPnl", signedMoney(traderPnlFromTrades(trades, "truenest")));
  setText("frogTraderTodayPnl", signedMoney(traderTodayPnlFromTrades(trades, "frog")));
  setText("truenestTraderTodayPnl", signedMoney(traderTodayPnlFromTrades(trades, "truenest")));
  renderRoomStatus("frog", settings, trades, backend);
  renderRoomStatus("truenest", settings, trades, backend);
  renderLiveWatch(settings, profiles, trades, strategy);
  renderManualDeposit(settings);
  renderVault(settings, profiles);
  renderTrades(trades);
  renderStockCoinHistory(trades);
  updateStockAlarm(trades);
  setText("liveEnvStatus", productionExecution
    ? "Production execution is enabled in Render and the required wallet details are saved."
    : liveTradingEnv
      ? "Render monitoring is on. Real buy/sell execution is still locked until EXECUTE_REAL_SWAPS=true is set in Render."
      : "Render monitoring is locked. Real trading cannot run until the Render environment is enabled.");

  if (!ready) {
    setText("engineStatus", "Trading locked - keys missing");
    setText("engineSubtext", "Backend is alive. Add the missing keys and wallet IDs inside this control panel, then Save.");
    const missing = [];
    if (!settings.heliusKey) missing.push("Waiting for Helius API key.");
    if (!settings.routeApi) missing.push("Waiting for Jupiter / trading route API.");
    if (!settings.turnkeyOrgId) missing.push("Waiting for Turnkey organization ID.");
    if (!settings.turnkeyApiPublicKey) missing.push("Waiting for Turnkey API public key.");
    if (!settings.turnkeyApiPrivateKey) missing.push("Waiting for Turnkey API private key.");
    if (!settings.frogTradeWallet) missing.push("Waiting for Decu Win wallet.");
    if (!settings.frogSignerToken) missing.push("Waiting for Decu Win Turnkey wallet ID.");
    missing.push(productionExecution ? "Production execution: ON." : "Production execution: OFF - real trading stays locked.");
    setLog(missing);
    return;
  }

  if (heliusBlocked) {
    setText("engineStatus", "Helius key needs refresh");
    setText("engineSubtext", "Balance is visible through backup Solana RPC, but copy trading stays locked until the paid Helius key is saved and no longer returns 429.");
    setLog([
      "Helius is still returning 429 for the saved API key.",
      "Do not press Start yet. Refresh or paste/save the paid Helius API key first.",
      ...(state.activity || [])
    ].slice(0, 20));
    return;
  }

  const running = [];
  if (profiles.frog?.running) running.push("Decu Win is running.");
  if (profiles.safe?.running) running.push("Frog safe bot is running.");
  if (profiles.truenest?.running) running.push("Risk Win is running.");
  const activeStrategyLabel = profileName(strategy.activeProfile || "frog");
  const strategyLine = strategy.paused
    ? `Auto-paused: ${strategy.pauseReason || "restart required."}`
    : `One-chart mode: ${activeStrategyLabel} active. Frog failures ${Number(strategy.safeLosses || 0)}/${queueFailureLimit(settings)}, Deku failures ${Number(strategy.frogLosses || 0)}/${queueFailureLimit(settings)}, Trunoest failures ${Number(strategy.truenestLosses || 0)}/${queueFailureLimit(settings)}. Switched-from traders are still watched for sells.`;

  if (!productionExecution) {
    setText("engineStatus", running.length ? "Monitoring running" : "Ready to monitor");
    setText("engineSubtext", running.length
      ? `${strategyLine} Real buy/sell execution is still locked in Render.`
      : `Keys are saved. ${strategyLine}`);
    setLog(state.activity?.length ? state.activity : ["Keys are ready. Production execution is still locked."]);
    return;
  }

  setText("engineStatus", strategy.paused ? "Auto-paused after losses" : running.length ? "Production copy engine running" : "Production execution enabled");
  setText("engineSubtext", running.length
    ? strategyLine
    : strategy.paused ? strategyLine : `Press Start trading queue to run Decu first. After ${queueFailureLimit(settings)} failures, it switches traders and still watches old sells.`);
  setLog(state.activity?.length ? state.activity : ["Ready. Press Start trading queue."]);
}

function renderManualDeposit(settings = {}) {
  const frogWallet = settings.frogTradeWallet || "";
  const frogDeposit = Number(settings.frogDeposit || 0);
  const frogBalance = walletBalance("frog");

  setText("manualDecuWallet", frogWallet || "Wallet not connected yet");
  setText("manualTruenestWallet", frogWallet || "Wallet not connected yet");
  setText("manualDecuGas", frogBalance.error ? `SOL gas: ${frogBalance.error}` : `SOL gas: ${solAmount(frogBalance.sol)}`);
  setText("manualTruenestGas", frogBalance.error ? `SOL gas: ${frogBalance.error}` : `Same wallet gas: ${solAmount(frogBalance.sol)}`);
  setText("manualDecuUsdc", `USDC balance: ${money(frogBalance.usdc)}`);
  setText("manualTruenestUsdc", `Same wallet USDC: ${money(frogBalance.usdc)}`);
  setText("manualDepositTotal", money(frogDeposit));
  if ($("manualDecuDeposit") && document.activeElement !== $("manualDecuDeposit")) $("manualDecuDeposit").value = settings.frogDeposit || "";
  if ($("manualTruenestDeposit") && document.activeElement !== $("manualTruenestDeposit")) $("manualTruenestDeposit").value = settings.frogDeposit || "";
  if ($("manualDecuUseProfit") && document.activeElement !== $("manualDecuUseProfit")) $("manualDecuUseProfit").value = settings.frogUseProfit || "off";
  if ($("manualTruenestUseProfit") && document.activeElement !== $("manualTruenestUseProfit")) $("manualTruenestUseProfit").value = settings.frogUseProfit || "off";
  if ($("copyManualDecuWallet")) $("copyManualDecuWallet").disabled = !frogWallet;
  if ($("copyManualTruenestWallet")) $("copyManualTruenestWallet").disabled = !frogWallet;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    let payload = null;
    try {
      payload = JSON.parse(text);
      message = payload.error || text;
    } catch {}
    const error = new Error(message);
    error.payload = payload;
    throw error;
  }
  return response.json();
}

function showBusinessMessage(text, error = false) {
  const businessMessage = $("businessMessage");
  if (!businessMessage) return;
  businessMessage.textContent = text || "";
  businessMessage.className = error ? "message-line error" : "message-line";
}

function setMode(role) {
  document.body.dataset.role = role || "guest";
  setHidden("authPanel", Boolean(role));
  setHidden("ownerPanel", role !== "owner");
  setHidden("customerPanel", role !== "customer");
  setHidden("logoutButton", !role);
  document.querySelectorAll(".owner-area").forEach((node) => {
    node.classList.toggle("hidden", role !== "owner");
  });
  document.querySelectorAll(".customer-only").forEach((node) => {
    node.classList.toggle("hidden", role !== "customer");
  });
  if (role === "owner") showOwnerPage("trade");
}

function showOwnerPage(pageName = "trade") {
  document.querySelectorAll("[data-owner-page]").forEach((node) => {
    node.classList.toggle("hidden", node.dataset.ownerPage !== pageName);
  });
  document.querySelectorAll("[data-owner-tab]").forEach((node) => {
    node.classList.toggle("active", node.dataset.ownerTab === pageName);
  });
}

function renderAddresses(addresses = []) {
  const wrap = $("depositAddresses");
  if (!wrap) return;
  wrap.innerHTML = "";
  addresses.forEach((item) => {
    const row = document.createElement("div");
    row.className = "address-card";
    row.innerHTML = `
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.address || "Wallet not connected yet")}</strong>
      <button type="button" ${item.address ? "" : "disabled"}>Copy deposit wallet</button>
    `;
    row.querySelector("button").addEventListener("click", async () => {
      await navigator.clipboard.writeText(item.address);
      showBusinessMessage(`${item.label} deposit address copied.`);
    });
    wrap.appendChild(row);
  });
}

function renderCustomer(customer) {
  if (!customer) return;
  activeCustomerToken = customer.accessToken || activeCustomerToken;
  activeReferralToken = customer.referralToken || activeReferralToken;
  setText("customerWelcome", `${customer.name || customer.email || "Customer"} account`);
  setText("customerDeposited", money(customer.deposited));
  setText("customerProfit", money(customer.profit));
  setText("customerOwnerShare", money(customer.ownerProfitShare));
  setText("customerReferralRewards", money(customer.referralRewards));
  setText("customerNetProfit", money(customer.customerNetProfit));
  setText("customerWithdrawable", money(customer.withdrawable));
  setText("customerShareRule", `Business share: ${percent(customer.ownerProfitSharePercent)} of gain only. Referral reward: ${percent(customer.referralRewardPercent)} from profit when your link brings a user.`);
  setText("customerReferralRule", `Your referral link pays ${percent(customer.referralRewardPercent)} from profit only. Deposits do not pay referral.`);
  setText("customerReferredBy", customer.referredByName ? `Invited by ${customer.referredByName}.` : "Direct owner/customer account.");
  const referralLink = customer.referralPath ? publicUrl(customer.referralPath) : "";
  const referralOutput = $("customerReferralLink");
  if (referralOutput) referralOutput.value = referralLink;
  setText("customerStatus", customer.status || "active");
  if ($("customerPlan")) $("customerPlan").value = customer.plan || "frog";
  renderAddresses(customer.depositAddresses || []);
}

function renderOwner(data) {
  setText("ownerIdentity", `Logged in as ${data.owner?.email || "owner"}.`);
  setText("ownerCustomerCount", data.summary?.customers || 0);
  setText("ownerTotalDeposits", money(data.summary?.deposited));
  setText("ownerTotalProfit", money(data.summary?.profit));
  setText("ownerProfitShare", money(data.summary?.ownerProfitShare));
  setText("ownerReferralRewards", money(data.summary?.referralRewards));
  setText("ownerNetProfitShare", money(data.summary?.ownerNetProfitShare));
  setText("ownerProfitShareRule", `${percent(data.summary?.ownerProfitSharePercent)} platform share. Customer referrals earn ${percent(data.summary?.referralRewardPercent)}; direct owner invites keep full platform share.`);
  setText("ownerPendingWithdrawals", data.summary?.pendingWithdrawals || 0);

  const list = $("customerList");
  if (!list) return;
  list.innerHTML = "";
  if (!data.customers?.length) {
    list.innerHTML = '<p class="muted">No customer account yet.</p>';
    return;
  }

  data.customers.forEach((customer) => {
    const customerLink = publicUrl(customer.accessPath || `/player/${customer.accessToken}`);
    const row = document.createElement("article");
    row.className = "customer-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(customer.name || customer.email || "Customer")}</strong>
        <span>${escapeHtml(customer.phone || customer.email || "Private link customer")}</span>
        <span>${customer.referredByName ? `Referred by ${escapeHtml(customer.referredByName)}` : "Owner/direct invite"}</span>
        <a class="mini-link" href="${escapeHtml(customerLink)}" target="_blank" rel="noreferrer">Open link</a>
      </div>
      <label>Plan
        <select data-field="plan">
          <option value="frog">Decu Win</option>
          <option value="truenest">Risk Win</option>
          <option value="both">Both</option>
        </select>
      </label>
      <label>Deposited <input data-field="deposited" inputmode="decimal" value="${escapeHtml(customer.deposited)}"></label>
      <label>Gross gain <input data-field="profit" inputmode="decimal" value="${escapeHtml(customer.profit)}"></label>
      <div class="share-mini">
        <span>Owner share</span>
        <strong>${money(customer.ownerProfitShare)}</strong>
        <small>Customer keeps ${money(customer.customerNetProfit)}</small>
      </div>
      <label>Status
        <select data-field="status">
          <option value="active">Active</option>
          <option value="paused">Paused</option>
        </select>
      </label>
      <button type="button" class="secondary-action copy-link-button">Copy link</button>
      <button type="button" class="secondary-action">Save</button>
    `;
    row.querySelector('[data-field="plan"]').value = customer.plan || "frog";
    row.querySelector('[data-field="status"]').value = customer.status || "active";
    row.querySelector(".copy-link-button").addEventListener("click", async () => {
      await navigator.clipboard.writeText(customerLink);
      showBusinessMessage("Customer private link copied.");
    });
    row.querySelector("button:last-of-type").addEventListener("click", async () => {
      const result = await api(`/api/owner/customer/${customer.id}`, {
        method: "POST",
        body: JSON.stringify({
          plan: row.querySelector('[data-field="plan"]').value,
          deposited: row.querySelector('[data-field="deposited"]').value,
          profit: row.querySelector('[data-field="profit"]').value,
          status: row.querySelector('[data-field="status"]').value
        })
      });
      renderOwner({ ...data, ...result });
      showBusinessMessage("Customer saved.");
    });
    list.appendChild(row);
  });
}

async function loadBusiness() {
  try {
    if (page === "customer" && tokenFromLocation()) {
      await loadCustomerLink(tokenFromLocation());
      return;
    }
    if (page === "customer" && referralFromLocation()) {
      activeReferralToken = referralFromLocation();
      setMode(null);
      setHidden("referralSignupCard", false);
      showBusinessMessage("Referral link opened. Register and your trading account will be created automatically.");
      return;
    }
    const data = await api("/api/business");
    if (data.role === "owner") {
      if (page !== "owner") {
        setMode(null);
        return;
      }
      setMode("owner");
      renderOwner(data);
      await refresh();
    }
    if (data.role === "customer") {
      setMode("customer");
      renderCustomer(data.customer);
    }
  } catch {
    setMode(null);
  }
}

async function loadCustomerLink(token) {
  const data = await api(`/api/customer/link/${encodeURIComponent(token)}`);
  activeCustomerToken = token;
  setMode("customer");
  renderCustomer(data.customer);
  showBusinessMessage("Private trading room opened.");
}

async function openCustomerLink() {
  try {
    const token = tokenFromLink(value("customerLinkInput"));
    if (!token) throw new Error("Paste your private customer link.");
    window.history.replaceState({}, "", `/player/${token}`);
    await loadCustomerLink(token);
  } catch (error) {
    showBusinessMessage(error.message, true);
  }
}

async function ownerLogin() {
  try {
    const email = value("ownerEmail");
    await api("/api/auth/owner", { method: "POST", body: JSON.stringify({ email }) });
    showBusinessMessage("Owner control panel opened.");
    await loadBusiness();
  } catch (error) {
    showBusinessMessage(error.message, true);
  }
}

async function customerLogin() {
  try {
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: value("customerLoginEmail"),
        password: value("customerLoginPassword")
      })
    });
    showBusinessMessage("Customer account opened.");
    await loadBusiness();
  } catch (error) {
    showBusinessMessage(error.message, true);
  }
}

async function customerSignup() {
  try {
    await api("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({
        name: value("signupName"),
        email: value("signupEmail"),
        password: value("signupPassword"),
        referralToken: activeReferralToken || referralFromLocation()
      })
    });
    showBusinessMessage("Customer account created. Your deposit wallet is below.");
    await loadBusiness();
  } catch (error) {
    showBusinessMessage(error.message, true);
  }
}

async function createReferralLink() {
  try {
    const path = activeCustomerToken
      ? `/api/customer/link/${encodeURIComponent(activeCustomerToken)}/referral`
      : "/api/customer/referral";
    const result = await api(path, { method: "POST" });
    renderCustomer(result.customer);
    const link = publicUrl(result.customer.referralPath);
    await navigator.clipboard.writeText(link);
    showBusinessMessage("Referral link created and copied.");
  } catch (error) {
    showBusinessMessage(error.message, true);
  }
}

async function copyReferralLink() {
  try {
    const link = value("customerReferralLink");
    if (!link) throw new Error("Create your referral link first.");
    await navigator.clipboard.writeText(link);
    showBusinessMessage("Referral link copied.");
  } catch (error) {
    showBusinessMessage(error.message, true);
  }
}

async function ownerCreateCustomer() {
  try {
    const result = await api("/api/owner/customer", {
      method: "POST",
      body: JSON.stringify({
        name: value("ownerCustomerName"),
        phone: value("ownerCustomerPhone"),
        email: value("ownerCustomerEmail"),
        plan: value("ownerCustomerPlan"),
        deposited: value("ownerCustomerDeposit")
      })
    });
    renderOwner({ owner: { email: value("ownerEmail") }, ...result });
    const link = publicUrl(result.customer.accessPath);
    const box = $("printedLinkBox");
    if (box) {
      box.classList.remove("hidden");
      box.innerHTML = `
        <strong>Private customer link printed</strong>
        <span>${escapeHtml(link)}</span>
        <button type="button" class="secondary-action">Copy link</button>
      `;
      box.querySelector("button").addEventListener("click", async () => {
        await navigator.clipboard.writeText(link);
        showBusinessMessage("Printed link copied.");
      });
    }
    showBusinessMessage("Customer link printed and deposit credited.");
  } catch (error) {
    showBusinessMessage(error.message, true);
  }
}

async function saveCustomerPlan() {
  try {
    const path = activeCustomerToken
      ? `/api/customer/link/${encodeURIComponent(activeCustomerToken)}/plan`
      : "/api/customer/plan";
    const result = await api(path, {
      method: "POST",
      body: JSON.stringify({ plan: value("customerPlan") })
    });
    renderCustomer(result.customer);
    showBusinessMessage("Trading wallet choice saved.");
  } catch (error) {
    showBusinessMessage(error.message, true);
  }
}

async function requestWithdrawal() {
  try {
    const path = activeCustomerToken
      ? `/api/customer/link/${encodeURIComponent(activeCustomerToken)}/withdraw`
      : "/api/customer/withdraw";
    const result = await api(path, {
      method: "POST",
      body: JSON.stringify({
        amount: value("withdrawAmount"),
        wallet: value("withdrawWallet")
      })
    });
    renderCustomer(result.customer);
    showBusinessMessage("Withdrawal request sent to the owner panel.");
  } catch (error) {
    showBusinessMessage(error.message, true);
  }
}

async function logout() {
  if (activeCustomerToken) {
    activeCustomerToken = "";
    window.history.replaceState({}, "", "/");
  } else {
    await api("/api/auth/logout", { method: "POST" });
  }
  setMode(null);
  showBusinessMessage("Closed.");
}

async function refresh() {
  if (page !== "owner") return;
  try {
    const state = await api("/api/status");
    if (state.auth?.role === "owner" || document.body.dataset.role === "owner") renderState(state);
  } catch {
    setText("engineStatus", "Backend not connected");
    setText("engineSubtext", "Render is not answering right now. The site cannot monitor until backend returns.");
    ["frogStart", "truenestStart", "frogStop", "truenestStop"].forEach((id) => {
      const button = $(id);
      if (button) button.disabled = true;
    });
    setText("liveEnvStatus", "Backend is not answering, so live trading cannot be checked.");
    setLog(["Backend is not answering yet. Check Render service status."]);
  }
}

async function saveSettings() {
  const data = currentPayload();
  renderState({ settings: data, profiles: {}, activity: ["Saving Engine Room..."] });
  renderState(await api("/api/settings", { method: "POST", body: JSON.stringify(data) }));
}

async function saveManualDeposit() {
  const mainDeposit = value("manualDecuDeposit") || value("manualTruenestDeposit");
  const mainUseProfit = value("manualDecuUseProfit") || value("manualTruenestUseProfit");
  const data = {
    ...currentPayload(),
    frogDeposit: mainDeposit,
    truenestDeposit: mainDeposit,
    frogUseProfit: mainUseProfit,
    truenestUseProfit: mainUseProfit
  };
  renderState({ settings: data, profiles: {}, activity: ["Saving manual deposit..."] });
  renderState(await api("/api/settings", { method: "POST", body: JSON.stringify(data) }));
  showBusinessMessage("Manual deposit saved.");
}

async function saveTradeMode(profile, mode) {
  const prefix = roomPrefix(profile);
  const data = {
    ...currentPayload(),
    [`${prefix}TradeMode`]: mode
  };
  const message = mode === "sellOnly"
    ? `${profileName(profile)} Sell Only saved: new buys blocked, sells still allowed.`
    : `${profileName(profile)} can buy again.`;
  renderState({ settings: data, profiles: {}, activity: [message] });
  renderState(await api("/api/settings", { method: "POST", body: JSON.stringify(data) }));
  showBusinessMessage(message);
}

async function saveBuyMode(profile = "frog") {
  const current = currentPayload();
  const prefix = profile === "truenest" ? "truenest" : "frog";
  const selectedMode = normalizeBuyMode(profile === "queue"
    ? value("queueBuyMode")
    : value(`${prefix}BuyMode`) || value("queueBuyMode") || current.frogBuyMode || "cap50");
  const selectedMax = profile === "queue"
    ? value("queueSurviveMax") || current.frogSurviveMax || "5"
    : value(`${prefix}SurviveMax`) || value("queueSurviveMax") || current.frogSurviveMax || "5";
  const data = {
    ...current,
    frogBuyMode: selectedMode,
    truenestBuyMode: selectedMode,
    frogSurviveMode: selectedMode === "survive" ? "on" : "off",
    truenestSurviveMode: selectedMode === "survive" ? "on" : "off",
    frogSurviveMax: selectedMax,
    truenestSurviveMax: selectedMax
  };
  const max = surviveMax(data);
  const message = `Buy mode saved: ${buyModeLabel(selectedMode)}. ${buyModeNote(selectedMode, max)} Sells still follow.`;
  renderState({ settings: data, profiles: {}, activity: [message] });
  renderState(await api("/api/settings", { method: "POST", body: JSON.stringify(data) }));
  showBusinessMessage(message);
}

async function ownerWithdraw(profile = "frog", options = {}) {
  const prefix = profile === "truenest" ? "truenest" : "frog";
  const profitOnly = options.profitOnly === true;
  const resultNode = profitOnly
    ? $(`${prefix}ProfitWithdrawResult`)
    : ($(`${prefix}WithdrawResult`) || $("ownerWithdrawResult"));
  if (resultNode) resultNode.textContent = "Sending withdrawal...";
  try {
    const walletId = profitOnly ? `${prefix}ProfitWithdrawWallet` : `${prefix}WithdrawWallet`;
    const amountId = profitOnly ? `${prefix}ProfitWithdrawAmount` : `${prefix}WithdrawAmount`;
    const result = await api("/api/owner/withdraw", {
      method: "POST",
      body: JSON.stringify({
        profile,
        wallet: value(walletId) || value("ownerWithdrawWallet"),
        amountSol: profitOnly ? "" : (value(amountId) || value("ownerWithdrawAmount")),
        amountUsd: profitOnly ? value(amountId) : "",
        asset: profitOnly ? "USDC" : "SOL",
        profitOnly
      })
    });
    renderState(result.status);
    const signature = result.withdrawal?.signature || "";
    if (resultNode) {
      resultNode.innerHTML = signature
        ? `Withdrawal sent. <a href="https://solscan.io/tx/${encodeURIComponent(signature)}" target="_blank" rel="noopener">Open Solscan receipt</a>`
        : "Withdrawal sent.";
    }
    showBusinessMessage("Withdrawal sent.");
  } catch (error) {
    if (resultNode) resultNode.textContent = error.message;
    showBusinessMessage(error.message, true);
  }
}

async function ownerSellToken(profile = "frog", options = {}) {
  const prefix = profile === "truenest" ? "truenest" : "frog";
  const mint = String(options.mint || value(`${prefix}SellMint`) || "").trim();
  const resultNode = options.resultId ? $(options.resultId) : $(`${prefix}SellTokenResult`);
  if (resultNode) resultNode.textContent = "Selling token to USDC...";
  try {
    const result = await api("/api/owner/sell-token", {
      method: "POST",
      body: JSON.stringify({
        profile,
        mint,
        stockOpenUsd: options.openUsd ? String(options.openUsd) : ""
      })
    });
    renderState(result.status);
    const signature = result.trade?.execution?.txid || result.trade?.signature || "";
    if (resultNode) {
      resultNode.innerHTML = signature
        ? `Manual sell sent. <a href="https://solscan.io/tx/${encodeURIComponent(signature)}" target="_blank" rel="noopener">Open Solscan receipt</a>`
        : "Manual sell sent.";
    }
    showBusinessMessage("Manual sell sent.");
  } catch (error) {
    if (resultNode) resultNode.textContent = error.message;
    showBusinessMessage(error.message, true);
  }
}

async function copyTextFromNode(id, label) {
  const text = $(id)?.textContent?.trim() || "";
  if (!text || text === "Wallet not connected yet") return;
  await navigator.clipboard.writeText(text);
  showBusinessMessage(`${label} copied.`);
}

async function startProfile(profile) {
  try {
    renderState(await api(`/api/start/${profile}`, { method: "POST" }));
  } catch (error) {
    if (error.payload?.status) renderState(error.payload.status);
    showBusinessMessage(error.message, true);
  }
}

async function stopProfile(profile) {
  renderState(await api(`/api/stop/${profile}`, { method: "POST" }));
}

async function startQueue() {
  try {
    renderState(await api("/api/queue/start", { method: "POST" }));
    showBusinessMessage(`Trading queue started. Decu goes first. After ${queueFailureLimit(latestState.settings)} failures, it switches traders and still watches old sells.`);
  } catch (error) {
    if (error.payload?.status) renderState(error.payload.status);
    showBusinessMessage(error.message, true);
  }
}

async function switchQueueProfile(profile) {
  try {
    renderState(await api("/api/queue/switch", {
      method: "POST",
      body: JSON.stringify({ profile })
    }));
    showBusinessMessage(`${profileName(profile)} is active for new buys. Other bots still watch sells.`);
  } catch (error) {
    if (error.payload?.status) renderState(error.payload.status);
    showBusinessMessage(error.message, true);
  }
}

async function saveQueueSwitch() {
  const data = currentPayload();
  renderState({ settings: data, profiles: {}, activity: ["Saving switch number..."] });
  renderState(await api("/api/settings", { method: "POST", body: JSON.stringify(data) }));
  showBusinessMessage(`Switch number saved: ${queueFailureLimit(data)} failures.`);
}

async function stopQueue() {
  renderState(await api("/api/queue/stop", { method: "POST" }));
  showBusinessMessage("Trading queue stopped.");
}

function on(id, event, handler) {
  const node = $(id);
  if (node) node.addEventListener(event, handler);
}

on("saveSettings", "click", saveSettings);
on("saveSettingsInline", "click", saveSettings);
on("saveProfitShare", "click", saveSettings);
on("saveManualDeposit", "click", saveManualDeposit);
on("saveDecuDeposit", "click", saveManualDeposit);
on("saveTruenestDeposit", "click", saveManualDeposit);
on("saveDecuSafety", "click", saveSettings);
on("saveTruenestSafety", "click", saveSettings);
on("ownerWithdrawButton", "click", () => ownerWithdraw(value("ownerWithdrawProfile") || "frog"));
on("frogWithdrawButton", "click", () => ownerWithdraw("frog"));
on("truenestWithdrawButton", "click", () => ownerWithdraw("truenest"));
on("frogProfitWithdrawButton", "click", () => ownerWithdraw("frog", { profitOnly: true }));
on("truenestProfitWithdrawButton", "click", () => ownerWithdraw("truenest", { profitOnly: true }));
on("frogSellTokenButton", "click", () => ownerSellToken("frog"));
on("truenestSellTokenButton", "click", () => ownerSellToken("truenest"));
on("copyManualDecuWallet", "click", () => copyTextFromNode("manualDecuWallet", "Decu Win wallet"));
on("copyManualTruenestWallet", "click", () => copyTextFromNode("manualTruenestWallet", "main trading wallet"));
on("ownerLogin", "click", ownerLogin);
on("customerLogin", "click", customerLogin);
on("customerSignup", "click", customerSignup);
on("createReferralLink", "click", createReferralLink);
on("copyReferralLink", "click", copyReferralLink);
on("openCustomerLink", "click", openCustomerLink);
on("ownerCreateCustomer", "click", ownerCreateCustomer);
on("saveCustomerPlan", "click", saveCustomerPlan);
on("requestWithdraw", "click", requestWithdrawal);
on("logoutButton", "click", logout);
on("installOwnerApp", "click", installOwnerApp);
on("frogStart", "click", () => startProfile("frog"));
on("frogStop", "click", () => stopProfile("frog"));
on("queueStart", "click", startQueue);
on("queueStop", "click", stopQueue);
on("queueBuyModeSave", "click", () => saveBuyMode("queue"));
on("saveQueueSwitch", "click", saveQueueSwitch);
on("switchSafeBot", "click", () => switchQueueProfile("safe"));
on("switchDekuBot", "click", () => switchQueueProfile("frog"));
on("switchTrunoestBot", "click", () => switchQueueProfile("truenest"));
on("enableStockAlarm", "click", enableStockAlarm);
on("clearStockAlarm", "click", clearStockAlarm);
on("frogSellOnly", "click", () => saveTradeMode("frog", "sellOnly"));
on("frogResumeBuying", "click", () => saveTradeMode("frog", "both"));
on("frogBuyModeSave", "click", () => saveBuyMode("frog"));
on("truenestStart", "click", () => startProfile("truenest"));
on("truenestStop", "click", () => stopProfile("truenest"));
on("truenestSellOnly", "click", () => saveTradeMode("truenest", "sellOnly"));
on("truenestResumeBuying", "click", () => saveTradeMode("truenest", "both"));
on("truenestBuyModeSave", "click", () => saveBuyMode("truenest"));
["frog", "truenest"].forEach((profile) => {
  const prefix = roomPrefix(profile);
  on(`${prefix}Mode`, "change", () => {
    syncRoomProtectionFromMode(profile);
    saveRoomSettings(profile);
  });
  on(`${prefix}RiskControl`, "change", () => {
    syncRoomModeFromProtection(profile);
    saveRoomSettings(profile);
  });
  [`${prefix}LiveTradingSwitch`, `${prefix}WalletSync`, `${prefix}Wallet`, `${prefix}Max`].forEach((id) => {
    on(id, "change", () => saveRoomSettings(profile));
  });
});
fields.forEach((id) => {
  on(id, "input", () => renderState({ settings: currentPayload(), profiles: {}, activity: [] }));
  on(id, "change", () => renderState({ settings: currentPayload(), profiles: {}, activity: [] }));
});
document.querySelectorAll("[data-owner-tab]").forEach((button) => {
  button.addEventListener("click", () => showOwnerPage(button.dataset.ownerTab));
});

setMode(null);
if (page === "owner") setupOwnerWebAppInstall();
loadBusiness();
if (page === "owner") setInterval(refresh, 5000);
