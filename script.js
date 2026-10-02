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
  "frogWalletSync",
  "frogRiskControl",
  "frogLiveTradingSwitch",
  "truenestWalletSync",
  "truenestRiskControl",
  "truenestLiveTradingSwitch",
  "vaultMode",
  "vaultFeePercent",
  "ownerProfitSharePercent",
  "ownerFeeWallet",
  "vaultNote"
];

const page = document.body.dataset.page || "customer";
const $ = (id) => document.getElementById(id);
let activeCustomerToken = "";
let latestState = { settings: {}, profiles: {}, trades: [], backend: {} };

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
  const truenestDeposit = Number(settings.truenestDeposit || 0);
  const frogPnl = Number(profiles.frog?.profit || 0);
  const truenestPnl = Number(profiles.truenest?.profit || 0);
  const deposited = frogDeposit + truenestDeposit;
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
    data.truenestTradeWallet &&
    data.frogSignerToken &&
    data.truenestSignerToken
  );
}

function profileName(profile) {
  return profile === "frog" ? "Smart Win" : "Risk Win";
}

function profileStatusName(profile) {
  return profileName(profile);
}

function profileTradeMatches(profile, trade) {
  const text = String(trade.profile || "").toLowerCase();
  if (profile === "frog") return text.includes("smart win") || text.includes("frog");
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
}

function syncRoomModeFromProtection(profile) {
  const prefix = roomPrefix(profile);
  const riskNode = $(`${prefix}RiskControl`);
  const modeNode = $(`${prefix}Mode`);
  if (!riskNode || !modeNode) return;
  modeNode.value = riskNode.value === "on" ? "Copy exact amount after safety check" : "Copy exact amount";
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
  const walletSync = profileSetting(settings, profile, "walletSync", "Turnkey server wallet");
  const productionExecution = backend.productionExecution === true || backend.liveTrading === true;

  setText(`${profile}Wins`, String(wins));
  setText(`${profile}Signals`, String(roomTrades.length));
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

function renderState(state) {
  latestState = {
    ...latestState,
    ...state,
    settings: { ...(latestState.settings || {}), ...(state.settings || {}) },
    profiles: { ...(latestState.profiles || {}), ...(state.profiles || {}) },
    trades: state.trades || latestState.trades || [],
    backend: { ...(latestState.backend || {}), ...(state.backend || {}) }
  };
  const settings = latestState.settings || {};
  const profiles = latestState.profiles || {};
  const trades = latestState.trades || [];
  const backend = latestState.backend || {};
  const liveTradingEnv = backend.liveTradingEnv === true;
  const productionExecution = backend.productionExecution === true || backend.liveTrading === true;

  fields.forEach((id) => {
    const node = $(id);
    if (node && settings[id] && document.activeElement !== node) node.value = settings[id];
  });
  ["frog", "truenest"].forEach(syncRoomProtectionFromMode);

  const ready = localReady(settings);
  if ($("frogStart")) $("frogStart").disabled = !ready || profiles.frog?.running;
  if ($("truenestStart")) $("truenestStart").disabled = !ready || profiles.truenest?.running;
  if ($("frogStop")) $("frogStop").disabled = !profiles.frog?.running;
  if ($("truenestStop")) $("truenestStop").disabled = !profiles.truenest?.running;

  setText("frogProfit", money(profiles.frog?.profit));
  setText("truenestProfit", money(profiles.truenest?.profit));
  setText("frogRoomProfit", money(profiles.frog?.profit));
  setText("truenestRoomProfit", money(profiles.truenest?.profit));
  setText("frogBalance", `Deposit: ${money(settings.frogDeposit)}`);
  setText("truenestBalance", `Deposit: ${money(settings.truenestDeposit)}`);
  renderRoomStatus("frog", settings, trades, backend);
  renderRoomStatus("truenest", settings, trades, backend);
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
    if (!settings.frogTradeWallet) missing.push("Waiting for Smart Win wallet.");
    if (!settings.truenestTradeWallet) missing.push("Waiting for Risk Win wallet.");
    if (!settings.frogSignerToken) missing.push("Waiting for Smart Win Turnkey wallet ID.");
    if (!settings.truenestSignerToken) missing.push("Waiting for Risk Win Turnkey wallet ID.");
    missing.push(productionExecution ? "Production execution: ON." : "Production execution: OFF - real trading stays locked.");
    setLog(missing);
    return;
  }

  const running = [];
  if (profiles.frog?.running) running.push("Smart Win is running.");
  if (profiles.truenest?.running) running.push("Risk Win is running.");

  if (!productionExecution) {
    setText("engineStatus", running.length ? "Monitoring running" : "Ready to monitor");
    setText("engineSubtext", running.length
      ? "SignalPilot is watching the trader wallet. Real buy/sell execution is still locked in Render."
      : "Keys are saved. To allow real trades, set EXECUTE_REAL_SWAPS=true in Render Environment.");
    setLog(state.activity?.length ? state.activity : ["Keys are ready. Production execution is still locked."]);
    return;
  }

  setText("engineStatus", running.length ? "Production copy engine running" : "Production execution enabled");
  setText("engineSubtext", running.length
    ? "Each room uses its own wallet engine and safety switch. Render is watching the trader and execution is enabled."
    : "Press Start inside Smart Win or Risk Win. Each room has its own safety and live trading switch.");
  setLog(state.activity?.length ? state.activity : ["Ready. Press Start Smart Win or Start Risk Win."]);
}

function renderManualDeposit(settings = {}) {
  const frogWallet = settings.frogTradeWallet || "";
  const truenestWallet = settings.truenestTradeWallet || "";
  const frogDeposit = Number(settings.frogDeposit || 0);
  const truenestDeposit = Number(settings.truenestDeposit || 0);

  setText("manualFrogWallet", frogWallet || "Wallet not connected yet");
  setText("manualTruenestWallet", truenestWallet || "Wallet not connected yet");
  setText("manualDepositTotal", money(frogDeposit + truenestDeposit));
  if ($("manualFrogDeposit") && document.activeElement !== $("manualFrogDeposit")) $("manualFrogDeposit").value = settings.frogDeposit || "";
  if ($("manualTruenestDeposit") && document.activeElement !== $("manualTruenestDeposit")) $("manualTruenestDeposit").value = settings.truenestDeposit || "";
  if ($("copyManualFrogWallet")) $("copyManualFrogWallet").disabled = !frogWallet;
  if ($("copyManualTruenestWallet")) $("copyManualTruenestWallet").disabled = !truenestWallet;
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
  setText("customerWelcome", `${customer.name || customer.email || "Customer"} account`);
  setText("customerDeposited", money(customer.deposited));
  setText("customerProfit", money(customer.profit));
  setText("customerOwnerShare", money(customer.ownerProfitShare));
  setText("customerNetProfit", money(customer.customerNetProfit));
  setText("customerWithdrawable", money(customer.withdrawable));
  setText("customerShareRule", `Business share: ${percent(customer.ownerProfitSharePercent)} of gain only.`);
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
  setText("ownerProfitShareRule", `${percent(data.summary?.ownerProfitSharePercent)} of customer gain`);
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
        <a class="mini-link" href="${escapeHtml(customerLink)}" target="_blank" rel="noreferrer">Open link</a>
      </div>
      <label>Plan
        <select data-field="plan">
          <option value="frog">Smart Win</option>
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
        password: value("signupPassword")
      })
    });
    showBusinessMessage("Customer account created. Your deposit wallet is below.");
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
  const data = {
    ...currentPayload(),
    frogDeposit: value("manualFrogDeposit"),
    truenestDeposit: value("manualTruenestDeposit")
  };
  renderState({ settings: data, profiles: {}, activity: ["Saving manual deposit..."] });
  renderState(await api("/api/settings", { method: "POST", body: JSON.stringify(data) }));
  showBusinessMessage("Manual deposit saved.");
}

async function ownerWithdraw(profile = "frog") {
  const prefix = profile === "truenest" ? "truenest" : "frog";
  const resultNode = $(`${prefix}WithdrawResult`) || $("ownerWithdrawResult");
  if (resultNode) resultNode.textContent = "Sending withdrawal...";
  try {
    const result = await api("/api/owner/withdraw", {
      method: "POST",
      body: JSON.stringify({
        profile,
        wallet: value(`${prefix}WithdrawWallet`) || value("ownerWithdrawWallet"),
        amountSol: value(`${prefix}WithdrawAmount`) || value("ownerWithdrawAmount")
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

async function copyTextFromNode(id, label) {
  const text = $(id)?.textContent?.trim() || "";
  if (!text || text === "Wallet not connected yet") return;
  await navigator.clipboard.writeText(text);
  showBusinessMessage(`${label} copied.`);
}

async function startProfile(profile) {
  renderState(await api(`/api/start/${profile}`, { method: "POST" }));
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
on("saveFrogDeposit", "click", saveManualDeposit);
on("saveTruenestDeposit", "click", saveManualDeposit);
on("saveFrogSafety", "click", saveSettings);
on("saveTruenestSafety", "click", saveSettings);
on("ownerWithdrawButton", "click", () => ownerWithdraw(value("ownerWithdrawProfile") || "frog"));
on("frogWithdrawButton", "click", () => ownerWithdraw("frog"));
on("truenestWithdrawButton", "click", () => ownerWithdraw("truenest"));
on("copyManualFrogWallet", "click", () => copyTextFromNode("manualFrogWallet", "Smart Win wallet"));
on("copyManualTruenestWallet", "click", () => copyTextFromNode("manualTruenestWallet", "Risk Win wallet"));
on("ownerLogin", "click", ownerLogin);
on("customerLogin", "click", customerLogin);
on("customerSignup", "click", customerSignup);
on("openCustomerLink", "click", openCustomerLink);
on("ownerCreateCustomer", "click", ownerCreateCustomer);
on("saveCustomerPlan", "click", saveCustomerPlan);
on("requestWithdraw", "click", requestWithdrawal);
on("logoutButton", "click", logout);
on("frogStart", "click", () => startProfile("frog"));
on("frogStop", "click", () => stopProfile("frog"));
on("truenestStart", "click", () => startProfile("truenest"));
on("truenestStop", "click", () => stopProfile("truenest"));
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
