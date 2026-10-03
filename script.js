const fields = [
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
  "frogWallet",
  "frogMax",
  "frogMode",
  "frogCopySizing",
  "frogTraderBankroll",
  "frogUseProfit",
  "frogTradeMode",
  "truenestWallet",
  "truenestMax",
  "truenestMode",
  "truenestCopySizing",
  "truenestTraderBankroll",
  "truenestUseProfit",
  "truenestTradeMode",
  "walletSync",
  "riskControl",
  "liveTradingSwitch",
  "frogWalletSync",
  "frogRiskControl",
  "frogLiveTradingSwitch",
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
  return balanceUsdc(profile) - profileDeposit(settings, profile);
}

function profileLoss(settings = {}, profile = "frog") {
  return Math.max(0, -profileNet(settings, profile));
}

function profileLockedProfit(settings = {}, profile = "frog") {
  return Math.max(0, profileNet(settings, profile));
}

function profileTradeableUsdc(settings = {}, profile = "frog") {
  if (settings.frogUseProfit === "on") return Math.max(0, balanceUsdc(profile));
  return Math.max(0, Math.min(balanceUsdc(profile), profileDeposit(settings, profile)));
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
  return profile === "frog" ? "Decu Win" : "Risk Win";
}

function profileStatusName(profile) {
  return profileName(profile);
}

function profileTradeMatches(profile, trade) {
  const text = String(trade.profile || "").toLowerCase();
  if (profile === "frog") return text.includes("decu win") || text.includes("deku") || text.includes("decu") || text.includes("smart win") || text.includes("frog");
  return text.includes("risk win") || text.includes("truenest") || text.includes("big win");
}

function profileSetting(settings, profile, key, fallback = "") {
  const prefix = profile === "frog" ? "frog" : "truenest";
  const profileKey = `${prefix}${key[0].toUpperCase()}${key.slice(1)}`;
  return settings[profileKey] || settings[key] || fallback;
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
  return profile === "frog" ? "frog" : "truenest";
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
  const productionExecution = backend.productionExecution === true || backend.liveTrading === true;
  const lastTraderResult = latestTraderClosedResult(trades, profile);
  const todayTraderPnl = traderTodayPnlFromTrades(trades, profile);
  const traderName = profile === "frog" ? "Decu" : "Risk guy";

  setText(`${profile}Wins`, String(wins));
  setText(`${profile}Signals`, String(roomTrades.length));
  setText(`${profile}RoomUsdc`, money(balanceUsdc(profile)));
  setText(`${profile}RoomLockedProfit`, money(profileLockedProfit(settings, profile)));
  setText(`${profile}RoomTradeable`, money(profileTradeableUsdc(settings, profile)));
  setText(`${profile}RoomLoss`, money(profileLoss(settings, profile)));
  setText(`${profile}RoomTraderPnl`, signedMoney(traderPnlFromTrades(trades, profile)));
  setText(`${profile}RoomTraderToday`, signedMoney(todayTraderPnl));
  setText(`${profile}RoomTraderLast`, lastTraderResult.label);
  setText(`${profile}RoomTraderTodayNote`, todayPnlLabel(todayTraderPnl, traderName));
  setText(`${profile}TradeModeStatus`, sellOnly
    ? `${label} is SELL ONLY: new buys are blocked, sells still work.`
    : `${label} can buy and sell.`);
  if ($(`${profile}SellOnly`)) $(`${profile}SellOnly`).disabled = sellOnly;
  if ($(`${profile}ResumeBuying`)) $(`${profile}ResumeBuying`).disabled = !sellOnly;
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

function renderLiveWatch(settings = {}, profiles = {}, trades = []) {
  const profile = profiles.frog?.running || !profiles.truenest?.running ? "frog" : "truenest";
  const label = profileName(profile);
  const prefix = roomPrefix(profile);
  const deposit = settings[`${prefix}Deposit`] || 0;
  const wallet = settings[`${prefix}TradeWallet`] || "";
  const balance = walletBalance(profile);
  const gasText = balance.error ? `Gas check: ${balance.error}` : `SOL gas: ${solAmount(balance.sol)}`;
  const profit = Number(profiles[profile]?.profit || 0);
  const usdcNow = balanceUsdc(profile);
  const lossNow = profileLoss(settings, profile);
  const traderPnl = traderPnlFromTrades(trades, profile);
  const traderTodayPnl = traderTodayPnlFromTrades(trades, profile);
  const lastTraderResult = latestTraderClosedResult(trades, profile);
  const running = Boolean(profiles[profile]?.running);
  const roomTrades = trades.filter((trade) => profileTradeMatches(profile, trade));
  const lastTrade = roomTrades[0];

  setText("watchProfileName", label);
  setText("watchProfileStatus", running ? `${label} is watching and ready to copy.` : `${label} is ready. Press Start when you want it to watch Decu.`);
  setText("watchDeposit", money(deposit));
  setText("watchWallet", wallet ? `Wallet ${wallet} | ${gasText}` : "Wallet not connected yet");
  setText("watchProfit", money(profit));
  setText("watchProfitNote", profit > 0 ? "Profit is positive." : profit < 0 ? "Profit is negative." : "No profit recorded yet.");
  setText("watchUsdcNow", money(usdcNow));
  setText("watchLossNow", `Loss from deposit: ${money(lossNow)}`);
  setText("watchTraderPnl", signedMoney(traderPnl));
  setText("watchTraderNote", `${label === "Decu Win" ? "Decu" : "Copied trader"} total visible made/lost from buy and sell signals.`);
  setText("watchTraderToday", signedMoney(traderTodayPnl));
  setText("watchTraderTodayNote", todayPnlLabel(traderTodayPnl, label === "Decu Win" ? "Decu" : "Risk guy"));
  setText("watchTraderLast", lastTraderResult.label);
  setText("watchLastAction", lastTrade?.action || "Waiting");
  setText("watchLastToken", lastTrade ? `${lastTrade.token || "-"} - ${lastTrade.status || "Observed"}` : "No buy or sell shown yet.");
  setText("watchLiveBadge", running ? "Live watch ON" : "Waiting");
  setText("watchChartNote", roomTrades.length ? `${roomTrades.length} copied signal${roomTrades.length === 1 ? "" : "s"} on screen.` : "Chart starts when copied trades appear.");

  const badge = $("watchLiveBadge");
  if (badge) badge.classList.toggle("is-live", running);

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

  setText("frogProfit", money(profiles.frog?.profit));
  setText("truenestProfit", money(profiles.truenest?.profit));
  setText("frogRoomProfit", money(profiles.frog?.profit));
  setText("truenestRoomProfit", money(profiles.truenest?.profit));
  setText("frogBalance", `Deposit: ${money(settings.frogDeposit)}`);
  setText("truenestBalance", `Shared deposit: ${money(settings.frogDeposit)}`);
  setText("frogUsdcNow", money(balanceUsdc("frog")));
  setText("truenestUsdcNow", money(balanceUsdc("truenest")));
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
  renderLiveWatch(settings, profiles, trades);
  renderManualDeposit(settings);
  renderVault(settings, profiles);
  renderTrades(trades);
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
  if (profiles.truenest?.running) running.push("Risk Win is running.");
  const activeStrategyLabel = strategy.activeProfile === "truenest" ? "Trunoest" : "Deku";
  const strategyLine = strategy.paused
    ? `Auto-paused: ${strategy.pauseReason || "restart required."}`
    : `One-chart mode: ${activeStrategyLabel} active. Deku losses ${Number(strategy.frogLosses || 0)}/3, Trunoest losses ${Number(strategy.truenestLosses || 0)}/3.`;

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
    : strategy.paused ? strategyLine : "Press Start Decu Win to run Deku first, then auto-switch to Trunoest after 3 Deku losses.");
  setLog(state.activity?.length ? state.activity : ["Ready. Press Start Decu Win or Start Risk Win."]);
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
    if (state.auth?.role === "owner") renderState(state);
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

async function ownerSellToken(profile = "frog") {
  const prefix = profile === "truenest" ? "truenest" : "frog";
  const resultNode = $(`${prefix}SellTokenResult`);
  if (resultNode) resultNode.textContent = "Selling token to USDC...";
  try {
    const result = await api("/api/owner/sell-token", {
      method: "POST",
      body: JSON.stringify({
        profile,
        mint: value(`${prefix}SellMint`)
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
on("frogStart", "click", () => startProfile("frog"));
on("frogStop", "click", () => stopProfile("frog"));
on("frogSellOnly", "click", () => saveTradeMode("frog", "sellOnly"));
on("frogResumeBuying", "click", () => saveTradeMode("frog", "both"));
on("truenestStart", "click", () => startProfile("truenest"));
on("truenestStop", "click", () => stopProfile("truenest"));
on("truenestSellOnly", "click", () => saveTradeMode("truenest", "sellOnly"));
on("truenestResumeBuying", "click", () => saveTradeMode("truenest", "both"));
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
loadBusiness();
if (page === "owner") setInterval(refresh, 5000);
