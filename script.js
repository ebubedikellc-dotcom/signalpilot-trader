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
  "truenestWallet",
  "truenestMax",
  "truenestMode",
  "walletSync",
  "riskControl",
  "liveTradingSwitch",
  "vaultMode",
  "vaultFeePercent",
  "ownerFeeWallet",
  "vaultNote"
];

const engineStatus = document.getElementById("engineStatus");
const engineSubtext = document.getElementById("engineSubtext");
const frogStart = document.getElementById("frogStart");
const frogStop = document.getElementById("frogStop");
const truenestStart = document.getElementById("truenestStart");
const truenestStop = document.getElementById("truenestStop");
const frogProfit = document.getElementById("frogProfit");
const truenestProfit = document.getElementById("truenestProfit");
const frogBalance = document.getElementById("frogBalance");
const truenestBalance = document.getElementById("truenestBalance");
const activityLog = document.getElementById("activityLog");
const tradeRows = document.getElementById("tradeRows");
const vaultStatus = document.getElementById("vaultStatus");
const vaultDeposited = document.getElementById("vaultDeposited");
const vaultProfit = document.getElementById("vaultProfit");
const vaultFee = document.getElementById("vaultFee");
const vaultFeeNote = document.getElementById("vaultFeeNote");
const vaultWithdrawable = document.getElementById("vaultWithdrawable");

function money(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function value(id) {
  return document.getElementById(id).value.trim();
}

function payload() {
  const data = {};
  fields.forEach((id) => {
    data[id] = value(id);
  });
  return data;
}

function setLog(lines) {
  activityLog.innerHTML = "";
  lines.forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    activityLog.appendChild(li);
  });
}

function renderTrades(trades = []) {
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
  const truenestDeposit = Number(settings.truenestDeposit || 0);
  const frogPnl = Number(profiles.frog?.profit || 0);
  const truenestPnl = Number(profiles.truenest?.profit || 0);
  const deposited = frogDeposit + truenestDeposit;
  const profit = frogPnl + truenestPnl;
  const feePercent = Number(settings.vaultFeePercent || 0);
  const fee = Math.max(0, profit) * (feePercent / 100);
  const withdrawable = deposited + profit - fee;

  vaultStatus.textContent = settings.vaultMode === "business" ? "Business vault mode" : "Private owner mode";
  vaultDeposited.textContent = money(deposited);
  vaultProfit.textContent = money(profit);
  vaultFee.textContent = money(fee);
  vaultFeeNote.textContent = feePercent
    ? `${feePercent}% profit-share is only for future customer mode.`
    : "No fee taken from your private vault now.";
  vaultWithdrawable.textContent = money(withdrawable);
}

function localReady(data = payload()) {
  return Boolean(
    data.heliusKey &&
    data.routeApi &&
    data.turnkeyOrgId &&
    data.turnkeyApiPublicKey &&
    data.turnkeyApiPrivateKey &&
    data.frogTradeWallet &&
    data.truenestTradeWallet &&
    data.frogSignerToken &&
    data.truenestSignerToken
  );
}

function renderState(state) {
  const settings = state.settings || {};
  const profiles = state.profiles || {};

  fields.forEach((id) => {
    if (settings[id] && document.activeElement !== document.getElementById(id)) {
      document.getElementById(id).value = settings[id];
    }
  });

  const ready = localReady(settings);
  frogStart.disabled = !ready || profiles.frog?.running;
  truenestStart.disabled = !ready || profiles.truenest?.running;
  frogStop.disabled = !profiles.frog?.running;
  truenestStop.disabled = !profiles.truenest?.running;

  frogProfit.textContent = money(profiles.frog?.profit);
  truenestProfit.textContent = money(profiles.truenest?.profit);
  frogBalance.textContent = `Deposit: ${money(settings.frogDeposit)}`;
  truenestBalance.textContent = `Deposit: ${money(settings.truenestDeposit)}`;
  renderVault(settings, profiles);
  renderTrades(state.trades || []);

  if (!ready) {
    engineStatus.textContent = "Engine Room needs keys";
    engineSubtext.textContent = "Add the boxes below, then Save.";
    const missing = [];
    if (!settings.heliusKey) missing.push("Waiting for Helius API key.");
    if (!settings.routeApi) missing.push("Waiting for Jupiter / trading route API.");
    if (!settings.turnkeyOrgId) missing.push("Waiting for Turnkey organization ID.");
    if (!settings.turnkeyApiPublicKey) missing.push("Waiting for Turnkey API public key.");
    if (!settings.turnkeyApiPrivateKey) missing.push("Waiting for Turnkey API private key.");
    if (!settings.frogTradeWallet) missing.push("Waiting for Frog beginner wallet.");
    if (!settings.truenestTradeWallet) missing.push("Waiting for Truenest Big Win wallet.");
    if (!settings.frogSignerToken) missing.push("Waiting for Frog Turnkey wallet ID.");
    if (!settings.truenestSignerToken) missing.push("Waiting for Truenest Turnkey wallet ID.");
    missing.push(`Wallet sync: ${settings.walletSync || "Turnkey server wallet"}.`);
    missing.push(`Vault: ${settings.vaultMode === "business" ? "Business mode later" : "Private owner mode now"}.`);
    missing.push(`Risk control: ${settings.riskControl === "off" ? "OFF - exact copy only" : "ON - protect me"}.`);
    missing.push(`Live trading switch: ${settings.liveTradingSwitch === "off" ? "OFF - monitor only" : "ON - allow live trading"}.`);
    setLog(missing);
    return;
  }

  const running = [];
  if (profiles.frog?.running) running.push("Frog beginner is running.");
  if (profiles.truenest?.running) running.push("Truenest Big Win is running.");

  engineStatus.textContent = running.length ? "Copy engine running" : "Engine ready";
  engineSubtext.textContent = running.length
    ? `${settings.walletSync || "Turnkey server wallet"} is selected. Render is watching the selected trader wallets.`
    : `Wallet sync: ${settings.walletSync || "Turnkey server wallet"}. Press Start on the account you want to run.`;
  setLog(state.activity?.length ? state.activity : ["Ready. Press Start Frog or Start Truenest."]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function refresh() {
  try {
    renderState(await api("/api/status"));
  } catch {
    engineStatus.textContent = "Backend not connected";
    engineSubtext.textContent = "Run this on Render to make the buttons live.";
    frogStart.disabled = true;
    truenestStart.disabled = true;
    frogStop.disabled = true;
    truenestStop.disabled = true;
    setLog(["This page is open, but the Render backend is not running yet."]);
  }
}

async function saveSettings() {
  renderState({ settings: payload(), profiles: {}, activity: ["Saving Engine Room..."] });
  renderState(await api("/api/settings", { method: "POST", body: JSON.stringify(payload()) }));
}

async function startProfile(profile) {
  renderState(await api(`/api/start/${profile}`, { method: "POST" }));
}

async function stopProfile(profile) {
  renderState(await api(`/api/stop/${profile}`, { method: "POST" }));
}

document.getElementById("saveSettings").addEventListener("click", saveSettings);
fields.forEach((id) => document.getElementById(id).addEventListener("input", () => {
  renderState({ settings: payload(), profiles: {}, activity: [] });
}));
frogStart.addEventListener("click", () => startProfile("frog"));
frogStop.addEventListener("click", () => stopProfile("frog"));
truenestStart.addEventListener("click", () => startProfile("truenest"));
truenestStop.addEventListener("click", () => stopProfile("truenest"));

refresh();
setInterval(refresh, 5000);
