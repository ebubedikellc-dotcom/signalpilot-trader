let walletPriceSnapshot = null;
const fields = [
  "executionEngine",
  "gmgnApiKey",
  "heliusKey",
  "alchemyKey",
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
  if (typeof value === "number" && !Number.isFinite(value)) return "Value not verified";
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
  const balance = walletBalance(profile);
  return !balance.error && typeof balance.usdc === "number" && Number.isFinite(balance.usdc) ? balance.usdc : NaN;
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
  const wallet = walletBalance(profile).address;
  return Math.max(0, Number(latestState.profitReserves?.[wallet]?.lockedUsd || 0));
}

function profileTradeableUsdc(settings = {}, profile = "frog") {
  return Math.max(0, Math.min(balanceUsdc(profile) - profileLockedProfit(settings, profile), profileDeposit(settings, profile)));
}

function queueFailureLimit(settings = {}) {
  const amount = Number(settings.queueFailureSwitchLimit || 3);
  return Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 3;
}

function signedMoney(value) {
  if (!Number.isFinite(value)) return "Not verified";
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
  const result=latestState.executionReport?.source?.[profile];
  return result?.sales ? result.total : NaN;
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
  const result=latestState.executionReport?.source?.[profile];
  return result?.sales ? result.net : NaN;
}

function todayPnlLabel(value, name = "Trader") {
  if (!Number.isFinite(value)) return `${name}: profit not verified. Complete purchase costs and USD values are required.`;
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
  return String(trade.execution?.action === "sell" ? trade.execution.inputMint : trade.execution?.action === "buy" ? trade.execution.outputMint : trade.tradedTokenMint || trade.tokenMint || trade.token || "").trim();
}

function tradeTokenMint(trade = {}) {
  return tradeTokenKey(trade);
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
  if (text.includes("watched - inactive bot") || text.includes("skipped - no")) return false;
  return text === "executed" || Boolean(trade.execution?.confirmedAt);
}

function tradeUsdAmount(trade = {}) {
  const values = [
    trade.execution?.action === "buy" && trade.execution?.inputMint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" ? Number(trade.execution.copiedTradeAmount) / 1e6 : null,
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
  if (heldMatch) return heldMatch[1];
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


    }
  });

  return Array.from(positions.values())
    .map((position) => {
      const relatedSells = sellSignals.filter((sell) => {
        const sameToken = sell.tokenKey && sell.tokenKey === position.tokenKey;
        const afterBuy = !position.firstBuyDateValue || !sell.dateValue || sell.dateValue >= position.firstBuyDateValue;
        return sameToken && afterBuy;
      });
      const balance = walletBalance(profile);
      const balanceKnown = !balance.error && Boolean(balance.tokens) && Date.now() - Date.parse(balance.updatedAt || "") < 60000;
      const holding = balanceKnown ? balance.tokens[position.tokenKey] : null;
      const held = balanceKnown ? BigInt(holding?.raw || "0") > 0n : null;
      return {
        ...position,
        balanceKnown, held, heldAmount: holding?.amount || 0,
        openUsd: held === false ? 0 : NaN,
        netProceeds: position.soldUsd - position.boughtUsd,
        traderSellSignals: relatedSells.length,
        failedSellSignals: relatedSells.filter((sell) => !sell.executed).length,
        lastSellSignalTime: relatedSells.at(-1)?.time || ""
      };
    })
    .sort((left, right) => right.openUsd - left.openUsd);
}

function openPositionsFromTrades(trades = [], profile = "frog") {
  return positionSummariesFromTrades(trades, profile)
    .filter((position) => position.held !== false)
    .sort((left, right) => right.openUsd - left.openUsd);
}

function stockCoinsFromTrades(trades = [], profile = "frog") {
  return positionSummariesFromTrades(trades, profile)
    .filter((position) => position.held === true && position.traderSellSignals > 0)
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
    .filter((position) => position.balanceKnown && position.held === false && position.sells > 0)
    .sort((left, right) => right.soldUsd - left.soldUsd);
}

function profileOpenValue(trades = [], profile = "frog") {
  return openPositionsFromTrades(trades, profile).reduce((sum, position) => sum + position.openUsd, 0);
}

function profileTotalWalletValue(settings = {}, profile = "frog") {
  const balance = walletBalance(profile);
  if (!balance.tokens || balance.error) return NaN;
  const hasUnpricedTokens = Object.entries(balance.tokens).some(([mint, token]) => mint !== "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" && BigInt(token.raw || "0") > 0n);
  return hasUnpricedTokens ? NaN : balanceUsdc(profile);
}

function renderOpenPositions(listId, summaryId, trades = [], profile = "frog") {
  const list = $(listId);
  const positions = openPositionsFromTrades(trades, profile);
  const openValue = positions.reduce((sum, position) => sum + position.openUsd, 0);
  setText(summaryId, positions.length ? `${positions.length} token${positions.length === 1 ? "" : "s"}; value unverified` : "No copied tokens held");
  if (!list) return;
  list.innerHTML = "";
  if (!positions.length) {
    const li = document.createElement("li");
    li.textContent = "No remaining copied tokens found in the latest wallet check.";
    list.appendChild(li);
    return;
  }

  positions.forEach((position) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <strong>${escapeHtml(position.token)}</strong>
      <span>Bought: ${money(position.boughtUsd)} | Sold: ${money(position.soldUsd)} | Wallet tokens: ${position.balanceKnown ? escapeHtml(String(position.heldAmount)) : "Balance unverified"}</span>
      <em>Your wallet holding; the trader’s current holding is not verified. ${position.buys} buy${position.buys === 1 ? "" : "s"}${position.lastBuyTime ? ` · ${escapeHtml(position.lastBuyTime)}` : ""}</em>
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
    li.textContent = "No verified stuck copied tokens. Check connection status if wallet data is unavailable.";
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
      <span>Wallet tokens: ${position.balanceKnown ? escapeHtml(String(position.heldAmount)) : "Balance unverified"} | Trader sell signals seen: ${position.traderSellSignals}</span>
      <span>A sell signal was recorded and the latest wallet check still shows tokens.</span>
      <em>Latest balance confirms remaining tokens after a sell signal${position.lastSellSignalTime ? ` · ${escapeHtml(position.lastSellSignalTime)}` : ""}</em>
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
    li.className = position.netProceeds < 0 ? "tape-loss" : "tape-win";
    li.innerHTML = `
      <strong>${escapeHtml(position.token)}</strong>
      <span>Bought: ${money(position.boughtUsd)} | Sold: ${money(position.soldUsd)}</span>
      <em>Wallet balance is zero. Recorded proceeds minus buys: ${money(position.netProceeds)}. Limited trade history; network fees excluded.</em>
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
      <td>${escapeHtml(trade.status || "-")}${trade.execution?.submittedAt ? `<br>Copy submitted: ${escapeHtml(trade.execution.submittedAt)}<br>Execution response: ${escapeHtml(trade.execution.confirmedAt || "Pending")}` : ""}${trade.executionError ? `<br>${escapeHtml(trade.executionError)}` : ""}</td>
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
    data.gmgnApiKey &&
    data.routeApi &&
    data.turnkeyOrgId &&
    data.turnkeyApiPublicKey &&
    data.turnkeyApiPrivateKey &&
    data.frogTradeWallet &&
    data.frogSignerToken
  );
}

function profileName(profile) {
  if (profile === "safe") return "Frog";
  if (profile === "truenest") return "Trunoest";
  return "Deku";
}

function profileStatusName(profile) {
  return profileName(profile);
}

function simpleProfileName(profile) {
  if (profile === "safe") return "Frog";
  if (profile === "truenest") return "Trunoest";
  return "Deku";
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

function normalizeBuyMode(mode) { return mode === "takeback" ? "takeback" : mode === "trailing" ? "trailing" : mode === "exact" ? "exact" : mode === "loss" ? "loss" : "limits"; }
function queueBuyMode(settings = {}) { return normalizeBuyMode(settings.frogBuyMode); }
function buyModeLabel(mode) { return mode === "takeback" ? "Take My Money Back" : mode === "trailing" ? "Trailing Stops" : mode === "exact" ? "Exact Copy" : mode === "loss" ? "Loss Protection" : "Profit & Loss Limits"; }
function surviveMax(settings = {}) { const amount = Number(settings.frogSurviveMax || 5); return amount > 0 ? amount : 5; }
function buyModeNote(mode, max = 5, trailing = value("trailingStopPercent") || "10") {
  if (mode === "takeback") return `Buy at most $${max} each time; copy smaller buys. If the coin reaches about 60% profit, sell only enough to recover the main money. Leave the rest to run, but sell it if it falls about 30% from its highest watched value, or when the trader sells first.`;
  if (mode === "trailing") return `Buy at most $${max} each time; copy smaller buys. Try to sell after a ${trailing}% fall from the highest value observed since tracking began, or when the trader sells first. The selling point moves up, never down with the price. Losses are still possible; sale prices are not guaranteed.`;
  if (mode === "exact") return `Copy the trader's purchase amount up to your $${max} limit. Sell when the trader sells. No independent profit or loss exit.`;
  return `Buy at most $${max} each time; copy smaller amounts as they are. Sell at a 30% loss${mode === "limits" ? " or 60% gain" : ""}, or when the trader sells — whichever comes first. Sale prices are not guaranteed.`;
}
let modeFormDirty = false;
let purchaseLimitDirty = false;
function explainSelectedMode() {
  const mode = normalizeBuyMode(value("queueBuyMode"));
  if ($("trailingStopLabel")) $("trailingStopLabel").hidden = mode !== "trailing";
  setText("modeExplanation", buyModeNote(mode, surviveMax(latestState.settings)));
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

function renderWatchedBots(trades = []) {
  for(const profile of ["safe","frog","truenest"]) {
    const result=latestState.executionReport?.source?.[profile];
    setText(`${profile}WatcherPnl`,result?.sales ? signedMoney(result.net) : "Not verified");
    setText(`${profile}WatcherLast`,result?.sales
      ? `${result.net>0 ? "Making money" : result.net<0 ? "Losing money" : "Break-even"} on matched USDC sales today. Partial history; before network fees. Updated ${new Date(result.updatedAt).toLocaleTimeString()}.`
      : "Waiting for verified purchase costs and sale proceeds. No profit claim from deposits or cash flow.");
  }
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
  const profit = latestState.executionReport?.closed?.length ? latestState.executionReport.closed.reduce((sum,f)=>sum+f.pnl,0) : NaN;
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
  const heliusBlocked = latestState.backend?.paidHeliusEnabled !== false && heliusLimited();

  setText("watchProfileName", label);
  setText("watchProfileStatus", running
    ? `${label} is watching and ready to copy.`
    : heliusBlocked
      ? `${label} is locked until the paid Helius key stops returning 429.`
      : `${label} is selected. Press Start when you want to begin copying ${label}.`);
  setText("watchDeposit", money(deposit));
  setText("watchWallet", wallet ? `Wallet ${wallet} | ${gasText}` : "Wallet not connected yet");
  setText("watchProfit", money(profit));
  setText("watchProfitNote", "Matched confirmed sales only; partial history, before SOL network fees. Open coins are separate.");
  setText("watchUsdcNow", money(usdcNow));
  setText("watchLossNow", `USDC cash: ${money(balanceUsdc(profile))} | Token value: ${money(openValue)} | Total: ${money(totalWalletValue)}`);
  setText("watchOpenValue", money(openValue));
  setText("watchTotalValue", money(totalWalletValue));
  setText("watchTraderPnl", signedMoney(traderPnl));
  setText("watchTraderNote", "Trader’s own matched USDC trades only. Partial history; SOL trades need historical dollar prices. This is not their complete wallet profit.");
  setText("watchTraderToday", signedMoney(traderTodayPnl));
  setText("watchTraderTodayNote", todayPnlLabel(traderTodayPnl, label) + " Africa/Lagos day; matched USDC trades only, before network fees.");
  setText("watchTraderLast", "See verified trader results above");
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
  const feedRows = backend.feeds || [];
  const checkedConnection = backend.gmgnConnectionCheck;
  const idleConnection = checkedConnection
    ? `${checkedConnection.message} Checked ${new Date(checkedConnection.checkedAt).toLocaleString()}.`
    : "Feeds not checked while trading is stopped. GMGN connection is not yet verified.";
  setText("feedConnectionStatus", (backend.observationUntil ? "Read-only connection check — trading remains stopped. " : "") + (feedRows.length ? feedRows.map((f) => `${profileName(f.profile)} ${f.source}: ${f.status}${f.error ? ` (${f.error})` : ""}`).join(" · ") : backend.observationUntil ? "Waiting for wallet activity." : idleConnection));
  renderExecutionReport();
  const liveTradingEnv = backend.liveTradingEnv === true;
  const productionExecution = backend.productionExecution === true || backend.liveTrading === true;
  const queueRunning = Boolean(profiles.safe?.running || profiles.frog?.running || profiles.truenest?.running);
  setText("topStopStatus", queueRunning
    ? "Trading is enabled. STOP turns off automatic buys and sells."
    : "STOPPED — automatic buys and sells are off. Holdings remain in your wallet.");
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
  const heliusBlocked = latestState.backend?.paidHeliusEnabled !== false && heliusLimited();
  if ($("frogStart")) $("frogStart").disabled = !ready || heliusBlocked || profiles.frog?.running;
  if ($("truenestStart")) $("truenestStart").disabled = !ready || heliusBlocked || profiles.truenest?.running;
  if ($("frogStop")) $("frogStop").disabled = !profiles.frog?.running;
  if ($("truenestStop")) $("truenestStop").disabled = !profiles.truenest?.running;
  if ($("queueStart")) $("queueStart").disabled = backend.providerRepairHold || !ready || heliusBlocked || queueRunning;
  if ($("queueStop")) $("queueStop").disabled = !queueRunning;
  if ($("changeTrader")) {
    $("changeTrader").disabled = queueRunning;
    $("changeTrader").title = queueRunning ? "Stop trading before changing trader" : "Choose the trader to copy";
  }
  if ($("selectedTrader") && document.activeElement !== $("selectedTrader")) $("selectedTrader").value = strategy.activeProfile || "frog";
  setText("selectedTraderLabel", `Selected trader: ${queueActiveLabel}`);
  setText("selectedModeLabel", `Trading options · ${buyModeLabel(buyMode)}${settings.profitMode === "target" ? " · Grow to target" : ""}`);
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
  if (!modeFormDirty) {
    if ($("queueBuyMode")) $("queueBuyMode").value = buyMode;
    if ($("trailingStopPercent")) $("trailingStopPercent").value = settings.trailingStopPercent || "10";
  }
  if (!purchaseLimitDirty) {
    if ($("queueSurviveMax")) $("queueSurviveMax").value = String(maxSurviveBuy);
    setText("purchaseLimitStatus", `Saved: ${money(maxSurviveBuy)} per purchase · All modes and traders · Separate from total budget.`);
  }
  if ($("queueBuyModeSave")) $("queueBuyModeSave").textContent = "Save trading mode";
  if ($("automaticSwitch")) $("automaticSwitch").checked = strategy.autoSwitch === true;
  setText("keepCurrentBot", "Keep this trader - Manual");
  setText("queueControlStatus", strategy.paused
    ? `Game stopped: ${strategy.pauseReason || "restart required."}`
    : queueRunning
      ? strategy.autoSwitch
        ? `Automatic: ${queueActiveLabel}. Frog failures ${Number(strategy.safeLosses || 0)}/${failureLimit}, Deku failures ${Number(strategy.frogLosses || 0)}/${failureLimit}, Trunoest failures ${Number(strategy.truenestLosses || 0)}/${failureLimit}. All three reaching the limit stops new buys. Sells stay watched.`
        : `Manual: ${queueActiveLabel} stays selected, winning or losing, until you change it. Existing coins stay watched for sells.`
      : `Ready: start your selected trader in ${strategy.autoSwitch ? "Automatic" : "Manual"} mode.`);
  setText("queueControlNote", buyModeNote(buyMode, maxSurviveBuy));
  explainSelectedMode();
  renderGrowthPlan();
  setText("topActiveTrader", strategy.paused ? "Game stopped" : queueRunning ? queueActiveLabel : "Not trading");
  setText("topActiveTraderNote", strategy.paused
    ? strategy.pauseReason || "New buys stopped. Existing coins stay watched for sells."
    : queueRunning
      ? "This is the only bot using your money now."
      : "Start Trading to begin.");

  setText("frogProfit", money(profiles.frog?.profit));
  setText("truenestProfit", money(profiles.truenest?.profit));
  setText("frogRoomProfit", money(profiles.frog?.profit));
  setText("truenestRoomProfit", money(profiles.truenest?.profit));
  setText("frogBalance", `Deposit: ${money(settings.frogDeposit)}`);
  setText("truenestBalance", `Shared deposit: ${money(settings.frogDeposit)}`);
  setText("topLockedProfit", money(profileLockedProfit(settings, "frog")));
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
  renderWatchedBots(trades);
  renderLiveWatch(settings, profiles, trades, strategy);
  renderManualDeposit(settings);
  renderRemainingWallet(settings);
  renderVault(settings, profiles);
  renderTrades(trades);
  renderStockCoinHistory(trades);
  updateStockAlarm(trades);
  setText("liveEnvStatus", productionExecution
    ? "Production execution is enabled in Render and the required wallet details are saved."
    : liveTradingEnv
      ? "Render monitoring is on. Real buy/sell execution is still locked until EXECUTE_REAL_SWAPS=true is set in Render."
      : "Render monitoring is locked. Real trading cannot run until the Render environment is enabled.");

  if (backend.providerRepairHold) {
    const checked = backend.gmgnConnectionCheck;
    const connected = checked?.ok === true;
    setText("engineStatus", connected ? "GMGN connected — trading stopped" : "GMGN selected — trading stopped");
    setText("engineSubtext", connected ? "The read-only connection test succeeded. Automatic trading and buying remain OFF. Manual sales still require your confirmation." : "GMGN has not passed a connection check since this server restarted. Automatic trading remains OFF.");
    setText("watchProfileStatus", connected ? "GMGN connection checked. Trading stays stopped." : "Selected trader saved. Trading stays stopped during GMGN repair.");
    setText("feedConnectionStatus", connected ? `GMGN connection verified at ${new Date(checked.checkedAt).toLocaleString()}. Automatic trading stays OFF.` : "GMGN connection not verified. No automatic trading during repair.");
    setText("queueControlStatus", "Automatic trading and buying stay OFF.");
    if (checked && !$("checkGmgnConnection")?.disabled) setText("gmgnCheckResult", `${checked.message} Checked ${new Date(checked.checkedAt).toLocaleString()}.`);
    return;
  }
  if (!ready) {
    setText("engineStatus", "Trading locked - keys missing");
    setText("engineSubtext", "Backend is alive. Add the missing keys and wallet IDs inside this control panel, then Save.");
    const missing = [];
    if (!settings.gmgnApiKey) missing.push("Waiting for GMGN API key.");
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
    setText("engineStatus", "Wallet verification unavailable");
    setText("engineSubtext", "The wallet provider is limiting requests. Balance-dependent actions must wait for verified wallet data. GMGN connection status is shown separately.");
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
  const strategyLine = `${activeStrategyLabel} selected. Automatic switching is off. Existing holdings retain their original trader's sell monitoring while trading runs.`;

  if (!productionExecution) {
    setText("engineStatus", running.length ? "Monitoring running" : "Ready to monitor");
    setText("engineSubtext", running.length
      ? `${strategyLine} Real buy/sell execution is still locked in Render.`
      : `Keys are saved. ${strategyLine}`);
    setLog(state.activity?.length ? state.activity : ["Keys are ready. Production execution is still locked."]);
    return;
  }

  setText("engineStatus", strategy.paused ? "Game stopped" : running.length ? "Production copy engine running" : "Production execution enabled");
  setText("engineSubtext", running.length
    ? strategyLine
    : strategy.paused ? strategyLine : `Press Start Trading to copy your selected trader.`);
  setLog(state.activity?.length ? state.activity : ["Ready. Press Start Trading."]);
}

function renderManualDeposit(settings = {}) {
  const frogWallet = settings.frogTradeWallet || "";
  const frogDeposit = Number(settings.frogDeposit || 0);
  const frogBalance = walletBalance("frog");

  setText("manualDecuWallet", frogWallet || "Wallet not connected yet");
  setText("manualTruenestWallet", frogWallet || "Wallet not connected yet");
  setText("manualDecuGas", frogBalance.error ? `SOL gas: ${frogBalance.error}` : `SOL gas: ${solAmount(frogBalance.sol)}`);
  setText("manualTruenestGas", frogBalance.error ? `SOL gas: ${frogBalance.error}` : `Same wallet gas: ${solAmount(frogBalance.sol)}`);
  setText("manualDecuUsdc", `USDC balance: ${Number.isFinite(balanceUsdc("frog")) ? money(balanceUsdc("frog")) : "Unable to check"}`);
  setText("manualTruenestUsdc", `Same wallet USDC: ${Number.isFinite(balanceUsdc("frog")) ? money(balanceUsdc("frog")) : "Unable to check"}`);
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

let statusRefreshPending = false;
async function refresh() {
  if (page !== "owner" || statusRefreshPending) return;
  statusRefreshPending = true;
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
  } finally { statusRefreshPending = false; }
}

async function saveSettings() {
  const data = currentPayload();
  renderState({ settings: data, profiles: {}, activity: ["Saving Engine Room..."] });
  renderState(await api("/api/settings", { method: "POST", body: JSON.stringify(data) }));
}

const fnzeroTraderResults = new Map();

function changeFnzeroTrader() {
  $('fnzeroMint').value='';
  $('fnzeroCoin').replaceChildren(new Option('Paste a mint below, or load recent coins',''));
  $('fnzeroCoinsStatus').textContent='Load recent coins or paste a coin mint address below.';
  $('fnzeroTestResult').textContent=fnzeroTraderResults.get($('fnzeroTrader').value) || 'No test run for this trader yet. Half-second trading has not been verified.';
}

async function loadFnzeroCoins() {
  const profile=$('fnzeroTrader').value, button=$('loadFnzeroCoins');
  button.disabled=true;
  $('fnzeroCoinsStatus').textContent=`Loading ${profileName(profile)}’s recent coins…`;
  try {
    const data=await api('/api/fnzero/coins',{method:'POST',body:JSON.stringify({profile})});
    if($('fnzeroTrader').value!==profile)return;
    const select=$('fnzeroCoin');
    select.replaceChildren(new Option('Choose a recent coin, or paste a mint below',''));
    for(const coin of data.coins)select.add(new Option(`${coin.symbol} · ${coin.mint.slice(0,6)}…${coin.mint.slice(-4)}`,coin.mint));
    $('fnzeroCoinsStatus').textContent=`${profileName(profile)}: ${data.coins.length} recent coins. ${data.cached?'Cached':'Checked'} ${new Date(data.checkedAt).toLocaleString()}. ${data.coins.length?'Choose a coin to test.':'You can paste a mint address instead.'}`;
  } catch(error) {if($('fnzeroTrader').value===profile)$('fnzeroCoinsStatus').textContent=`Could not load coins: ${error.message}`;}
  finally {button.disabled=false;}
}

async function testFnzero() {
  const button=$('testFnzero'), result=$('fnzeroTestResult');
  if(!button || !result)return;
  const profile=$('fnzeroTrader').value, mint=$('fnzeroMint').value.trim(), side=$('fnzeroSide').value;
  button.disabled=true;
  $('fnzeroTrader').disabled=true;
  result.textContent='Checking the route and simulating FnZero. No trade will be sent…';
  try {
    const test=await api('/api/fnzero/test',{method:'POST',body:JSON.stringify({profile,mint,side,amount:$('fnzeroAmount').value.trim()})});
    result.textContent=test.ok ? `Simulation passed. Route discovery: ${(test.discoveryMs/1000).toFixed(3)}s; FnZero preparation: ${(test.preparationMs/1000).toFixed(3)}s; simulation: ${(test.simulationMs/1000).toFixed(3)}s. No buy or sell was sent. This is not a measurement of completed copy-trading speed.` : `FnZero test did not pass: ${test.message}. No trade was sent. Jupiter remains available.`;
  } catch(error) {result.textContent=`Test unavailable: ${error.message}. No trade was sent.`;}
  finally {
    result.textContent=`${profileName(profile)} · ${side} · ${mint || 'no coin selected'}: ${result.textContent}`;
    fnzeroTraderResults.set(profile,result.textContent);
    $('fnzeroTraderResults').replaceChildren(...Array.from(fnzeroTraderResults.values(),message=>{const p=document.createElement('p');p.textContent=message;return p;}));
    button.disabled=false;$('fnzeroTrader').disabled=false;
  }
}

async function saveManualDeposit() {
  const mainDeposit = value("manualDecuDeposit");
  if (mainDeposit.trim() === "" || !Number.isFinite(Number(mainDeposit)) || Number(mainDeposit) < 0) {
    setText("tradingBudgetSaveStatus", "Enter a valid amount of zero or more."); return;
  }
  const button=$("saveDecuDeposit"); if(button)button.disabled=true;
  setText("tradingBudgetSaveStatus", "Saving your trading amount…");
  try {
    const data={...(latestState.settings || {}),frogDeposit:mainDeposit,truenestDeposit:mainDeposit,frogUseProfit:"off",truenestUseProfit:"off"};
    renderState(await api("/api/settings", {method:"POST",body:JSON.stringify(data)}));
    setText("tradingBudgetSaveStatus", `Saved trading amount: ${money(Number(latestState.settings.frogDeposit))}. Saving does not start trading.`);
  } catch(error) {
    setText("tradingBudgetSaveStatus", `Not saved: ${error.message || "Connection failed"}. Your previous saved amount remains in place.`);
  } finally { if(button)button.disabled=false; }
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

  renderState(await api("/api/settings", { method: "POST", body: JSON.stringify(data) }));
  showBusinessMessage(message);
}

function closeTradingOptions(focusSummary = false) {
  const options = $("tradingOptions");
  if (options) options.open = false;
  if (focusSummary) $("selectedModeLabel")?.focus();
}

async function saveBuyMode(profile = "frog") {
  const current = currentPayload();
  const prefix = profile === "truenest" ? "truenest" : "frog";
  const selectedMode = normalizeBuyMode(profile === "queue"
    ? value("queueBuyMode")
    : value(`${prefix}BuyMode`) || value("queueBuyMode") || current.frogBuyMode || "cap50");
  const trailingPercent = value("trailingStopPercent") || "10";
  if (!(Number.isFinite(Number(trailingPercent)) && Number(trailingPercent)>0 && Number(trailingPercent)<100)) {
    showBusinessMessage("Enter a trailing fall percentage between 0 and 100, excluding both.", true); return;
  }
  const data = {
    ...current,
    trailingStopPercent: trailingPercent,
    frogBuyMode: selectedMode,
    truenestBuyMode: selectedMode,
    frogSurviveMode: selectedMode === "survive" ? "on" : "off",
    truenestSurviveMode: selectedMode === "survive" ? "on" : "off"
  };
  const max = surviveMax(latestState.settings);
  const message = `Buy mode saved: ${buyModeLabel(selectedMode)}. ${buyModeNote(selectedMode, max)} Sells still follow.`;

  try {
    const saved = await api("/api/settings", { method: "POST", body: JSON.stringify(data) });
    modeFormDirty = false;
    renderState(saved);
    if (profile === "queue") closeTradingOptions(true);
    showBusinessMessage(message);
  } catch (error) {
    showBusinessMessage(`Trading mode not saved: ${error.message}`, true);
  }
}

async function savePurchaseLimit() {
  const amount = Number(value("queueSurviveMax"));
  if (!Number.isFinite(amount) || amount < 0.01 || amount > 1_000_000_000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) {
    setText("purchaseLimitStatus", "Enter $0.01 or more, with at most two decimal places (maximum $1 billion)."); return;
  }
  $("savePurchaseLimit").disabled = true;
  setText("purchaseLimitStatus", "Saving purchase limit…");
  try {
    const saved = await api("/api/purchase-limit", {method:"POST",body:JSON.stringify({amountUsd:String(amount)})});
    purchaseLimitDirty = false;
    renderState(saved);
  } catch (error) {
    setText("purchaseLimitStatus", `Not saved: ${error.message}`);
  } finally { $("savePurchaseLimit").disabled = false; }
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
  const review = $("walletSellReview");
  if (!review) return;
  review.hidden = false;
  review.textContent = "Getting a sale quote. Nothing has been sold.";
  review.scrollIntoView({ behavior: "smooth", block: "center" });
  try {
    const quote = await api("/api/owner/sell-preview", { method: "POST", body: JSON.stringify({profile, mint}) });
    review.innerHTML = `<h3>Review sale: ${escapeHtml(quote.symbol)}</h3>
      <p>${escapeHtml(quote.name)} · ${escapeHtml(String(quote.amount))} tokens</p>
      <p class="coin-mint">${escapeHtml(mint)}</p>
      <p>Expected money back: <strong>${money(quote.expectedUsdc)} USDC</strong></p>
      <p>${quote.minimumUsdc === null ? "Minimum received is not supplied by the provider." : `Minimum received: ${money(quote.minimumUsdc)} USDC.`} ${quote.slippageBps === null ? "" : `Slippage: ${(Number(quote.slippageBps)/100).toFixed(2)}%.`}</p>
      <p>Reported network costs: ${escapeHtml(String(quote.networkFeeSol))} SOL. Additional costs may apply. USDC stays in your wallet.</p>
      <p id="walletQuoteExpiry">Quote expires in 30 seconds.</p>
      <button type="button" id="confirmWalletCoinSale">Confirm sale of ${escapeHtml(quote.symbol)} to USDC</button>
      <button type="button" id="cancelWalletCoinSale">Cancel</button>`;
    const confirm = $("confirmWalletCoinSale");
    if (!quote.canExecute) { confirm.disabled = true; setText("walletQuoteExpiry", quote.blockedReason); }
    const expiry = setTimeout(() => { confirm.disabled = true; if (confirm.isConnected) setText("walletQuoteExpiry", "Quote expired. Tap Sell to check a fresh quote."); }, Math.max(0, quote.expiresAt-Date.now()));
    $("cancelWalletCoinSale").onclick = () => { clearTimeout(expiry); review.hidden = true; review.replaceChildren(); };
    confirm.onclick = async () => {
      if (!quote.canExecute || Date.now() >= quote.expiresAt) { confirm.disabled = true; return; }
      confirm.disabled = true;
      $("cancelWalletCoinSale").disabled = true;
      clearTimeout(expiry);
      setText("walletQuoteExpiry", "Submitting your sale. Do not click again.");
      try {
        const result = await api("/api/owner/sell-token", { method:"POST", body:JSON.stringify({ profile, mint, previewId:quote.previewId }) });
        renderState(result.status);
        const txid = result.trade?.execution?.txid || result.trade?.signature;
        review.innerHTML = `<p>Sale submitted. Refresh wallet balances to check the received USDC.</p>${txid ? `<a href="https://solscan.io/tx/${encodeURIComponent(txid)}" target="_blank" rel="noopener">View transaction receipt</a>` : ""}`;
        await loadWalletCoins();
      } catch(error) {
        review.textContent = `Sale not confirmed: ${error.message}. Check the wallet and transaction history before trying again.`;
      }
    };
  } catch (error) { review.textContent = `Cannot prepare sale: ${error.message}. Nothing was submitted.`; }
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
    showBusinessMessage(`Trading started with ${profileName(latestState.strategy.activeProfile)}. You alone choose when to change trader.`);
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
    showBusinessMessage(`${profileName(profile)} selected. Press Start Trading when ready.`);
    if ($("traderPicker")) $("traderPicker").hidden = true;
  } catch (error) {
    if (error.payload?.status) renderState(error.payload.status);
    showBusinessMessage(error.message, true);
  }
}

async function keepCurrentBot() {
  try {
    renderState(await api("/api/queue/keep-current", { method: "POST" }));
    const active = profileName(latestState.strategy?.activeProfile || "safe");
    showBusinessMessage(`${active} stays selected in Manual mode until you change it.`);
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
  setText("topStopStatus", "Stopping… waiting for server confirmation.");
  try {
    const state = await api("/api/queue/stop", { method: "POST" });
    renderState(state);
    if (Object.values(state.profiles || {}).some((profile) => profile.running)) {
      throw new Error("Stop is not confirmed. Tap STOP TRADING again.");
    }
    setText("topStopStatus", "STOPPED — automatic buys and sells are off. Holdings remain in your wallet.");
    showBusinessMessage("Trading stopped. Automatic buys and sells are off.");
  } catch (error) {
    setText("topStopStatus", `STOP NOT CONFIRMED: ${error.message}`);
    showBusinessMessage(`Stop not confirmed: ${error.message}`, true);
  }
}

function on(id, event, handler) {
  const node = $(id);
  if (node) node.addEventListener(event, handler);
}

on("saveSettings", "click", saveSettings);
on("testFnzero", "click", testFnzero);
on("fnzeroTrader", "change", changeFnzeroTrader);
on("loadFnzeroCoins", "click", loadFnzeroCoins);
on("fnzeroCoin", "change", () => {if($('fnzeroCoin').value)$('fnzeroMint').value=$('fnzeroCoin').value;});
on("saveExecutionEngine", "click", async () => {
  try {
    renderState(await api('/api/settings',{method:'POST',body:JSON.stringify({executionEngine:$('executionEngine').value})}));
    $('fnzeroTestResult').textContent='Execution option saved. This does not start trading. FnZero only handles routes that pass the read-only test.';
  } catch(error) { $('fnzeroTestResult').textContent=error.message; }
});
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
on("topStopTrading", "click", stopQueue);
on("queueBuyModeSave", "click", () => saveBuyMode("queue"));
on("closeTradingOptions", "click", () => closeTradingOptions(true));
// Also close browser-restored details when returning to or refreshing this page.
window.addEventListener("pageshow", () => closeTradingOptions());
on("saveQueueSwitch", "click", saveQueueSwitch);
on("switchSafeBot", "click", () => switchQueueProfile("safe"));
on("switchDekuBot", "click", () => switchQueueProfile("frog"));
on("switchTrunoestBot", "click", () => switchQueueProfile("truenest"));
on("keepCurrentBot", "click", keepCurrentBot);
on("automaticSwitch", "change", async () => {
  const toggle = $("automaticSwitch");
  const enabled = toggle.checked;
  toggle.disabled = true;
  try {
    renderState(await api("/api/queue/automatic", { method: "POST", body: JSON.stringify({ enabled }) }));
  } catch (error) {
    toggle.checked = latestState.strategy?.autoSwitch === true;
    showBusinessMessage(error.message, true);
  } finally {
    toggle.disabled = false;
  }
});
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

on("changeTrader", "click", () => { $("traderPicker").hidden = !$("traderPicker").hidden; });
on("saveSelectedTrader", "click", () => switchQueueProfile(value("selectedTrader")));
on("queueBuyMode", "change", () => { modeFormDirty = true; explainSelectedMode(); });
on("queueSurviveMax", "input", () => {
  purchaseLimitDirty = true;
  setText("purchaseLimitStatus", `Not saved yet. Current limit: ${money(surviveMax(latestState.settings))}. Press Save limit to apply to every mode and trader.`);
});
on("savePurchaseLimit", "click", savePurchaseLimit);
on("trailingStopPercent", "input", () => { modeFormDirty = true; explainSelectedMode(); });

function renderExecutionReport() {
 const r=latestState.executionReport, today=r?.today;
 setText("myTodayGains",today?.sales ? money(today.gains) : "Not verified");
 setText("myTodayLosses",today?.sales ? money(today.losses) : "Not verified");
 setText("myTodayNet",today?.sales ? signedMoney(today.net) : "Not verified");
 setText("myTodayNote", r?.error ? `Verification unavailable: ${r.error}` : "Confirmed matched sales in Africa/Lagos today. Partial retained history; network fees and open coins are excluded.");
 if($("exitStatusList")) {
   $("exitStatusList").replaceChildren();
   const messages=[...Object.values(r?.notices || {}),...(r?.pendingSells || []).map(x=>`${profileName(x.profile)}: ${x.message}`)];
   for(const msg of messages.length?messages:["No verified exit checks yet. Trading remains off until you press Start."]) {const li=document.createElement("li");li.textContent=msg;$("exitStatusList").appendChild(li);}
 }
 if($("confirmedProfitLog")) {
   $("confirmedProfitLog").replaceChildren();
   const closed=[...(r?.closed||[])].reverse();
   for(const fill of closed.slice(0,100)) {const li=document.createElement("li");li.textContent=`${new Date(fill.time).toLocaleString()} · ${profileName(fill.profile)} · ${fill.mint} · Sold ${money(fill.usd)} · Purchase cost ${money(fill.cost)} · ${signedMoney(fill.pnl)} before SOL network fees${fill.reason ? ' · '+fill.reason : ''}`;$("confirmedProfitLog").appendChild(li);}
   if(!closed.length){const li=document.createElement("li");li.textContent="No matched, confirmed sales loaded yet. Historical records remain below.";$("confirmedProfitLog").appendChild(li);}
 }
 if($("lockedProfitLog")) {
  $("lockedProfitLog").replaceChildren();
  const reserves=Object.values(latestState.profitReserves || {});
  const events=reserves.flatMap(r=>r.history || []).sort((a,b)=>Date.parse(b.time)-Date.parse(a.time));
  for(const row of events){const li=document.createElement("li");li.textContent=`${new Date(row.time).toLocaleString()} · Added ${money(row.added)} · Locked total ${money(row.total)}`;$("lockedProfitLog").appendChild(li);}
  if(!events.length){const li=document.createElement("li");li.textContent="Existing locked balance is shown above. No dated lock events recorded yet.";$("lockedProfitLog").appendChild(li);}
 }
}

function walletValuation(balance, cash, prices, now = Date.now()) {
 const fresh = prices?.wallet === balance.address && Number.isFinite(prices.receivedAt) && now - prices.receivedAt < 90000;
 const priceOf = item => fresh && typeof item?.priceUsd === "number" && item.priceUsd > 0 && Number.isFinite(item.priceUsd) && now - item.checked < 90000 ? item.priceUsd : null;
 const result = { total: Number.isFinite(cash) && !balance.error ? cash : null, coins: 0, unknown: 0, solPriced: false };
 if (result.total === null || !balance.tokens) return { ...result, total: null };
 const solPrice = priceOf(prices?.solMarket);
 result.solPriced = Number.isFinite(balance.sol) && (balance.sol === 0 || solPrice !== null);
 if (result.solPriced) result.total += balance.sol * (solPrice || 0);
 for (const [mint, token] of Object.entries(balance.tokens)) {
  if (mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" || BigInt(token.raw || "0") <= 0n) continue;
  const price = priceOf(prices?.coins?.find(c => c.mint === mint));
  if (price === null || !Number.isFinite(token.amount)) result.unknown++;
  else result.coins += token.amount * price;
 }
 result.total += result.coins;
 return result;
}

function renderRemainingWallet(settings = {}) {
 const b=walletBalance("frog"), cash=balanceUsdc("frog");
 setText("savedTradingBudget",settings.frogDeposit !== undefined && settings.frogDeposit !== "" ? money(Number(settings.frogDeposit)) : "Not set");
 const validCash=Number.isFinite(cash);
 const validSol=!b.error && typeof b.sol === "number" && Number.isFinite(b.sol);
 const wallet=b.address || settings.frogTradeWallet || "";
 const reserve=latestState.profitReserves?.[wallet];
 const locked=reserve && Number.isFinite(Number(reserve.lockedUsd)) ? Number(reserve.lockedUsd) : null;
 const tokenCount=b.tokens && !b.error ? Object.entries(b.tokens).filter(([mint,t])=>mint!=="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" && BigInt(t.raw||"0")>0n).length : null;
 setText("remainingUsdc",validCash ? money(cash) : "Unable to check");
 setText("remainingSol",validSol ? solAmount(b.sol) : "Unable to check");
 setText("remainingLocked",locked!==null ? money(locked) : "Unable to check");
 const growth=latestState.growth;
 const available=settings.profitMode === "target"
   ? growth ? Math.max(0,Math.min(growth.availableUsd,cash-Math.max(locked,growth.excludedCash))) : 0
   : Math.max(0,Math.min(cash-locked,profileDeposit(settings)));
 setText("remainingTradeable",validCash && locked!==null ? money(available) : "Unable to check");
 setText("remainingCoins",tokenCount===null ? "Unable to check" : `${tokenCount} coin types`);
 const valuation = walletValuation(b, cash, walletPriceSnapshot);
 const complete = valuation.total !== null && valuation.solPriced && valuation.unknown === 0;
 setText("remainingCoinValue",tokenCount===null ? "Waiting for verified holdings" : `${valuation.unknown ? "Priced coins" : "Other coin value"}: ${money(valuation.coins)}${valuation.unknown ? `; ${valuation.unknown} coin price unavailable` : ""}`);
 setText("remainingTotal",valuation.total === null ? "Unable to check" : money(valuation.total));
 setText("remainingTotalLabel",complete ? "Estimated total wallet value" : "Priced wallet subtotal");
 const exclusions = [!valuation.solPriced ? "SOL price unavailable" : "", valuation.unknown ? `${valuation.unknown} coin price unavailable` : ""].filter(Boolean);
 setText("remainingTotalNote",valuation.total === null ? "Waiting for verified wallet balances." : complete ? "USDC plus current SOL and coin market estimates, before fees." : `Excludes unpriced assets: ${exclusions.join("; ")}. Their value is unknown, not zero.`);
 setText("remainingBalanceStatus",b.error ? "Balance check failed. Your provider is not returning a verified balance. This does not mean your wallet is empty." : b.updatedAt ? `Balance checked: ${new Date(b.updatedAt).toLocaleString()}. Market estimates exclude any assets whose prices are unavailable.` : "Waiting for a verified wallet balance.");
 setText("remainingWalletAddress",wallet ? `My wallet: ${wallet}` : "Wallet not connected");
}

// Whole-wallet holdings are independent of copied-trade history.
function heldCoinProfile(state, wallet, mint) {
  const profiles = [...new Set(Object.values(state.executionReport?.positions || {})
    .filter(p => p.wallet === wallet && p.mint === mint && BigInt(p.raw || "0") > 0n).map(p => p.profile))];
  return profiles.length === 1 ? profiles[0] : state.strategy?.activeProfile || "frog";
}
let walletCoinsLoading = false;
async function loadWalletCoins() {
  if (!$("walletCoinsList") || walletCoinsLoading) return;
  walletCoinsLoading = true;
  $("refreshWalletCoins").disabled = true;
  setText("walletCoinsStatus", "Checking wallet coins and market prices…");
  try {
    const data = await api("/api/owner/wallet-coins");
    walletPriceSnapshot = { ...data, receivedAt: Date.now() };
    renderRemainingWallet(latestState.settings);
    $("walletCoinsList").replaceChildren();
    for (const coin of data.coins) {
      const card = document.createElement("article");
      card.className = "wallet-coin-card";
      card.innerHTML = `<strong>${escapeHtml(coin.name)} (${escapeHtml(coin.symbol)})</strong>
        <p>Amount: ${escapeHtml(String(coin.amount))}</p>
        <p>Estimated worth: <strong>${coin.estimatedUsd === null ? "Price unavailable" : money(coin.estimatedUsd)}</strong></p>
        <small class="coin-mint">${escapeHtml(coin.mint)}</small>`;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `Sell ${coin.symbol} — check quote`;
      button.disabled = !coin.canSell;
      button.onclick = () => ownerSellToken(heldCoinProfile(latestState, data.wallet, coin.mint), {mint:coin.mint});
      card.append(button);
      $("walletCoinsList").append(card);
    }
    setText("walletCoinsStatus", data.coins.length ? `Checked ${new Date(data.checkedAt).toLocaleString()}. Market estimates before fees; check a sale quote for the amount you could receive.` : "No other tokens remain in this wallet.");
    setText("stuckCoinSaleStatus", data.coins.length ? `${data.coins.length} held coin types. Choose a coin below to review its sale.` : "No stuck or unsold coins found in the latest wallet check.");
  } catch(error) {
    $("walletCoinsList").replaceChildren();
    setText("walletCoinsStatus", `Unable to check coins: ${error.message}`);
    setText("stuckCoinSaleStatus", "Holdings unavailable. Press Sell stuck coins to check again.");
  } finally { walletCoinsLoading = false; $("refreshWalletCoins").disabled = false; }
}
$("refreshWalletCoins")?.addEventListener("click", loadWalletCoins);
async function openStuckCoinSales() {
  const panel = $("stuckCoinSales");
  if (!panel) return;
  panel.focus({preventScroll:true});
  panel.scrollIntoView({behavior:"smooth",block:"start"});
  await loadWalletCoins();
}
$("openStuckCoinSales")?.addEventListener("click", openStuckCoinSales);
if ($("walletCoinsList")) { loadWalletCoins(); setInterval(loadWalletCoins, 60000); }

$("checkGmgnConnection")?.addEventListener("click", async () => {
  const button = $("checkGmgnConnection");
  button.disabled = true;
  setText("gmgnCheckResult", "Checking GMGN from this site's server. Automatic trading stays OFF…");
  try {
    const result = await api("/api/gmgn/check", {method:"POST"});
    latestState.backend = {...latestState.backend, gmgnConnectionCheck:result};
    renderState(latestState);
    setText("gmgnCheckResult", `${result.message} Checked ${new Date(result.checkedAt).toLocaleString()}.`);
  } catch(error) { setText("gmgnCheckResult", error.message); }
  finally { button.disabled = false; }
});


let growthFormDirty = false;
function explainGrowthPlan() {
  const target = value("profitPlan") === "target";
  if ($("growthInputs")) $("growthInputs").hidden = !target;
  setText("growthPlanExplanation", target
    ? `Start with ${money(Number(value("growthStartingAmount") || 100))}. Reinvest only the new profits earned by this amount until the plan's total reaches ${money(Number(value("growthTargetAmount") || 200))}, then sell its remaining coins and stop after confirmed cash reaches the target. Previously locked profit and other wallet funds stay outside this plan. Your selected trader and per-purchase limits still apply. Losses can reduce the balance; reaching the target is not guaranteed.`
    : "Save profits separately keeps them out of later purchases.");
}
function renderGrowthPlan() {
  if (!$('profitPlan')) return;
  const settings = latestState.settings || {}, goal = latestState.growth;
  const running = Object.values(latestState.profiles || {}).some(p => p.running);
  if (!growthFormDirty) {
    $('profitPlan').value = settings.profitMode || 'save';
    $('growthStartingAmount').value = settings.growthPrincipal || '100';
    $('growthTargetAmount').value = settings.growthTarget || '200';
  }
  for (const id of ['profitPlan','growthStartingAmount','growthTargetAmount','saveProfitPlan']) $(id).disabled = running;
  setText('growthEditHelp', running
    ? 'Stop trading to unlock these profit-plan controls. This protects the current plan’s accounting.'
    : 'Profit-plan controls are unlocked. Saving a plan does not start trading.');
  $('saveProfitPlan').textContent = goal ? 'Save a new profit plan' : 'Save profit plan';
  $('growthProgress').hidden = !goal;
  if (goal) {
    setText('growthStarted', money(goal.principal));
    setText('growthCash', goal.netCashUsd === null ? 'Costs awaiting confirmation' : money(goal.netCashUsd));
    setText('growthGoal', money(goal.target));
    const message = goal.reviewMessage ? goal.reviewMessage : goal.status === 'completed' ? 'Target reached — automatic trading stopped.'
      : !running ? 'Paused. Start Trading resumes this same plan.'
      : goal.status === 'closing' ? 'Target estimate reached. New buys are blocked while the plan sells and confirms its holdings.'
      : !goal.costsPriced || !goal.verified ? 'New buys are paused while costs or holdings are verified. Existing exits remain watched.'
      : `Growing toward ${money(goal.target)}. Available for later purchases: ${money(goal.availableUsd)}. ${goal.pendingCount} transaction(s) awaiting confirmation.`;
    setText('growthProgressStatus', message);
    setText('growthEstimate', Number.isFinite(goal.estimatedTotalUsd)
      ? `Last estimated cash plus sellable coins: ${money(goal.estimatedTotalUsd)} before final sale costs. Checked ${new Date(goal.quoteCheckedAt).toLocaleTimeString()}.`
      : `Money still invested at purchase cost: ${money(goal.openCostUsd)}. No current total sale value confirmed.`);
    if (goal.status === 'completed') setText('topStopStatus', `TARGET REACHED — ${money(goal.netCashUsd)}. Automatic trading stopped.`);
  }
  explainGrowthPlan();
}
async function saveGrowthPlan() {
  const button = $('saveProfitPlan'); button.disabled = true;
  setText('growthSaveStatus', 'Saving profit plan…');
  try {
    const result = await api('/api/growth/settings', {method:'POST',body:JSON.stringify({
      profitMode:value('profitPlan'), growthPrincipal:value('growthStartingAmount'), growthTarget:value('growthTargetAmount')
    })});
    growthFormDirty = false;
    renderState(result);
    setText('growthSaveStatus', result.settings.profitMode === 'target'
      ? `Saved: ${money(Number(result.settings.growthPrincipal))} → ${money(Number(result.settings.growthTarget))}. Trading remains stopped. Start Trading begins the plan after checking available funds.`
      : 'Saved: profits will be kept separately. Trading remains stopped.');
  } catch (error) { setText('growthSaveStatus', `Not saved: ${error.message}`); }
  finally { button.disabled = Object.values(latestState.profiles || {}).some(p=>p.running); }
}
on('profitPlan','change',()=>{growthFormDirty=true;explainGrowthPlan();});
on('growthStartingAmount','input',()=>{growthFormDirty=true;explainGrowthPlan();});
on('growthTargetAmount','input',()=>{growthFormDirty=true;explainGrowthPlan();});
on('saveProfitPlan','click',saveGrowthPlan);
