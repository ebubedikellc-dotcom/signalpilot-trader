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
const liveEnvStatus = document.getElementById("liveEnvStatus");
const authPanel = document.getElementById("authPanel");
const ownerPanel = document.getElementById("ownerPanel");
const customerPanel = document.getElementById("customerPanel");
const logoutButton = document.getElementById("logoutButton");
const businessMessage = document.getElementById("businessMessage");

let currentUser = null;

function money(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
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
  const liveTradingUnlocked = state.backend?.liveTrading === true;

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
  liveEnvStatus.textContent = liveTradingUnlocked
    ? "Render live trading is unlocked. If the site switch is ON, SignalPilot can move from monitoring into execution."
    : "Render live trading is locked. To unlock it, open Render > Environment, set ENABLE_LIVE_TRADING to true, save, then Manual Deploy latest commit.";

  if (!ready) {
    engineStatus.textContent = "Trading locked - keys missing";
    engineSubtext.textContent = "Backend is alive. Add the missing keys and wallet IDs below, then Save.";
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
    missing.push(`Site live trading switch: ${settings.liveTradingSwitch === "off" ? "OFF - monitor only" : "ON - allow live trading"}.`);
    missing.push(liveTradingUnlocked ? "Render unlock: ON." : "Render unlock: OFF - real trading stays locked.");
    setLog(missing);
    return;
  }

  const running = [];
  if (profiles.frog?.running) running.push("Frog beginner is running.");
  if (profiles.truenest?.running) running.push("Truenest Big Win is running.");

  if (!liveTradingUnlocked) {
    engineStatus.textContent = running.length ? "Monitoring running" : "Ready to monitor";
    engineSubtext.textContent = running.length
      ? "SignalPilot is watching the trader wallet. Real trading is still locked in Render."
      : "Keys are saved. To allow real trades, set ENABLE_LIVE_TRADING=true in Render Environment.";
    setLog(state.activity?.length ? state.activity : ["Keys are ready. Render live trading is still locked."]);
    return;
  }

  engineStatus.textContent = running.length ? "Live copy engine running" : "Live trading unlocked";
  engineSubtext.textContent = running.length
    ? `${settings.walletSync || "Turnkey server wallet"} is selected. Render is watching the trader and live execution is unlocked.`
    : `Wallet sync: ${settings.walletSync || "Turnkey server wallet"}. Press Start on Frog or Truenest.`;
  setLog(state.activity?.length ? state.activity : ["Ready. Press Start Frog or Start Truenest."]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = JSON.parse(text).error || text;
    } catch {}
    throw new Error(message);
  }
  return response.json();
}

function showBusinessMessage(text, error = false) {
  businessMessage.textContent = text || "";
  businessMessage.className = error ? "message-line error" : "message-line";
}

function setMode(role) {
  document.body.dataset.role = role || "guest";
  authPanel.classList.toggle("hidden", Boolean(role));
  ownerPanel.classList.toggle("hidden", role !== "owner");
  customerPanel.classList.toggle("hidden", role !== "customer");
  logoutButton.classList.toggle("hidden", !role);
  document.querySelectorAll(".owner-area").forEach((node) => {
    node.classList.toggle("hidden", role !== "owner");
  });
}

function renderAddresses(addresses = []) {
  const wrap = document.getElementById("depositAddresses");
  wrap.innerHTML = "";
  addresses.forEach((item) => {
    const row = document.createElement("div");
    row.className = "address-card";
    row.innerHTML = `
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.address || "Wallet not connected yet")}</strong>
      <button type="button" ${item.address ? "" : "disabled"}>Copy</button>
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
  document.getElementById("customerWelcome").textContent = `${customer.name || customer.email} account`;
  document.getElementById("customerDeposited").textContent = money(customer.deposited);
  document.getElementById("customerProfit").textContent = money(customer.profit);
  document.getElementById("customerWithdrawable").textContent = money(customer.withdrawable);
  document.getElementById("customerStatus").textContent = customer.status || "active";
  document.getElementById("customerPlan").value = customer.plan || "frog";
  renderAddresses(customer.depositAddresses || []);
}

function renderOwner(data) {
  document.getElementById("ownerIdentity").textContent = `Logged in as ${data.owner?.email || "owner"}.`;
  document.getElementById("ownerCustomerCount").textContent = data.summary?.customers || 0;
  document.getElementById("ownerTotalDeposits").textContent = money(data.summary?.deposited);
  document.getElementById("ownerTotalProfit").textContent = money(data.summary?.profit);
  document.getElementById("ownerPendingWithdrawals").textContent = data.summary?.pendingWithdrawals || 0;

  const list = document.getElementById("customerList");
  list.innerHTML = "";
  if (!data.customers?.length) {
    list.innerHTML = '<p class="muted">No customer account yet.</p>';
    return;
  }

  data.customers.forEach((customer) => {
    const row = document.createElement("article");
    row.className = "customer-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(customer.name || customer.email)}</strong>
        <span>${escapeHtml(customer.email)}</span>
      </div>
      <label>Plan
        <select data-field="plan">
          <option value="frog">Frog</option>
          <option value="truenest">Truenest</option>
          <option value="both">Both</option>
        </select>
      </label>
      <label>Deposited <input data-field="deposited" inputmode="decimal" value="${escapeHtml(customer.deposited)}"></label>
      <label>Profit <input data-field="profit" inputmode="decimal" value="${escapeHtml(customer.profit)}"></label>
      <label>Status
        <select data-field="status">
          <option value="active">Active</option>
          <option value="paused">Paused</option>
        </select>
      </label>
      <button type="button" class="secondary-action">Save</button>
    `;
    row.querySelector('[data-field="plan"]').value = customer.plan || "frog";
    row.querySelector('[data-field="status"]').value = customer.status || "active";
    row.querySelector("button").addEventListener("click", async () => {
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
    const data = await api("/api/business");
    if (data.role === "owner") {
      currentUser = { role: "owner" };
      setMode("owner");
      renderOwner(data);
    }
    if (data.role === "customer") {
      currentUser = { role: "customer" };
      setMode("customer");
      renderCustomer(data.customer);
    }
  } catch {
    currentUser = null;
    setMode(null);
  }
}

async function ownerLogin() {
  try {
    const email = document.getElementById("ownerEmail").value.trim();
    await api("/api/auth/owner", { method: "POST", body: JSON.stringify({ email }) });
    showBusinessMessage("Owner control panel opened.");
    await loadBusiness();
    await refresh();
  } catch (error) {
    showBusinessMessage(error.message, true);
  }
}

async function customerLogin() {
  try {
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: document.getElementById("customerLoginEmail").value,
        password: document.getElementById("customerLoginPassword").value
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
        name: document.getElementById("signupName").value,
        email: document.getElementById("signupEmail").value,
        password: document.getElementById("signupPassword").value
      })
    });
    showBusinessMessage("Customer account created.");
    await loadBusiness();
  } catch (error) {
    showBusinessMessage(error.message, true);
  }
}

async function ownerCreateCustomer() {
  try {
    const result = await api("/api/owner/customer", {
      method: "POST",
      body: JSON.stringify({
        name: document.getElementById("ownerCustomerName").value,
        email: document.getElementById("ownerCustomerEmail").value,
        password: document.getElementById("ownerCustomerPassword").value,
        plan: document.getElementById("ownerCustomerPlan").value,
        deposited: document.getElementById("ownerCustomerDeposit").value
      })
    });
    renderOwner({ owner: { email: document.getElementById("ownerEmail").value }, ...result });
    showBusinessMessage("Customer saved in owner panel.");
  } catch (error) {
    showBusinessMessage(error.message, true);
  }
}

async function saveCustomerPlan() {
  try {
    const result = await api("/api/customer/plan", {
      method: "POST",
      body: JSON.stringify({ plan: document.getElementById("customerPlan").value })
    });
    renderCustomer(result.customer);
    showBusinessMessage("Trading wallet choice saved.");
  } catch (error) {
    showBusinessMessage(error.message, true);
  }
}

async function requestWithdrawal() {
  try {
    const result = await api("/api/customer/withdraw", {
      method: "POST",
      body: JSON.stringify({
        amount: document.getElementById("withdrawAmount").value,
        wallet: document.getElementById("withdrawWallet").value
      })
    });
    renderCustomer(result.customer);
    showBusinessMessage("Withdrawal request sent to the owner panel.");
  } catch (error) {
    showBusinessMessage(error.message, true);
  }
}

async function logout() {
  await api("/api/auth/logout", { method: "POST" });
  currentUser = null;
  setMode(null);
  showBusinessMessage("Logged out.");
}

async function refresh() {
  try {
    const state = await api("/api/status");
    if (state.auth?.role === "owner") {
      renderState(state);
    }
  } catch {
    engineStatus.textContent = "Backend not connected";
    engineSubtext.textContent = "Render is not answering right now. The site cannot monitor until backend returns.";
    frogStart.disabled = true;
    truenestStart.disabled = true;
    frogStop.disabled = true;
    truenestStop.disabled = true;
    liveEnvStatus.textContent = "Backend is not answering, so live trading cannot be checked.";
    setLog(["Backend is not answering yet. Check Render service status."]);
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
document.getElementById("saveSettingsInline").addEventListener("click", saveSettings);
document.getElementById("ownerLogin").addEventListener("click", ownerLogin);
document.getElementById("customerLogin").addEventListener("click", customerLogin);
document.getElementById("customerSignup").addEventListener("click", customerSignup);
document.getElementById("ownerCreateCustomer").addEventListener("click", ownerCreateCustomer);
document.getElementById("saveCustomerPlan").addEventListener("click", saveCustomerPlan);
document.getElementById("requestWithdraw").addEventListener("click", requestWithdrawal);
logoutButton.addEventListener("click", logout);
fields.forEach((id) => document.getElementById(id).addEventListener("input", () => {
  renderState({ settings: payload(), profiles: {}, activity: [] });
}));
frogStart.addEventListener("click", () => startProfile("frog"));
frogStop.addEventListener("click", () => stopProfile("frog"));
truenestStart.addEventListener("click", () => startProfile("truenest"));
truenestStop.addEventListener("click", () => stopProfile("truenest"));

setMode(null);
loadBusiness().then(refresh);
setInterval(refresh, 5000);
