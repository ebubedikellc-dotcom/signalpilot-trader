import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Turnkey } from "@turnkey/sdk-server";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  Transaction,
  clusterApiUrl
} from "@solana/web3.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");
const dataDir = process.env.DATA_DIR || path.join(__dirname, ".data");
const dataFile = path.join(dataDir, "signalpilot-state.json");
const workerIntervalMs = Number(process.env.WORKER_INTERVAL_MS || 500);
const maxSignalAgeMs = Number(process.env.MAX_SIGNAL_AGE_MS || 5000);
const ownerEmail = (process.env.OWNER_EMAIL || "ebubedikellc@gmail.com").toLowerCase();
const sessionMaxAge = 60 * 60 * 24 * 30;
const solMint = "So11111111111111111111111111111111111111112";
const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const usdtMint = "Es9vMFrzaCERmJfrF4H2FYD4AWuEJ1hDPPpQdjCXg82h";
const legacyFrogWallet = "4DdrfiDHpmx55i4SPssxVzS9ZaKLb8qr45NKY9Er9nNh";
const decuWallet = "4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9";
const protectedCapStrategyVersion = "decu-50-cap-v1";
const usdcDecimals = 6;
const tokenProgramId = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const associatedTokenProgramId = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const defaultState = {
  settings: {
    frogWallet: decuWallet,
    frogMax: "50",
    frogMode: "Copy exact amount after safety check",
    frogCopySizing: "Copy exact amount",
    frogTraderBankroll: "500",
    frogUseProfit: "off",
    frogTradeMode: "both",
    truenestWallet: "ardinRsN1mNYVeoJWTBsWeYeXvuR9UUDGMsCDKpb6AT",
    truenestMax: "50",
    truenestMode: "Copy exact amount after safety check",
    truenestCopySizing: "Copy exact amount",
    truenestTraderBankroll: "500",
    truenestUseProfit: "off",
    truenestTradeMode: "both",
    walletSync: "Turnkey server wallet",
    riskControl: "on",
    liveTradingSwitch: "on",
    frogWalletSync: "Turnkey server wallet",
    frogRiskControl: "on",
    frogLiveTradingSwitch: "on",
    truenestWalletSync: "Turnkey server wallet",
    truenestRiskControl: "on",
    truenestLiveTradingSwitch: "on",
    vaultMode: "private",
    vaultFeePercent: "0",
    ownerProfitSharePercent: "30",
    referralRewardPercent: "5",
    ownerFeeWallet: "",
    vaultNote: "Private vault first. Open to users later.",
    protectedCapStrategyVersion
  },
  profiles: {
    frog: { running: false, profit: 0, lastAction: null, lastSignature: null },
    truenest: { running: false, profit: 0, lastAction: null, lastSignature: null }
  },
  owner: {
    email: ownerEmail
  },
  customers: [],
  deposits: [],
  withdrawals: [],
  sessions: {},
  activity: ["Site engine created. Add API and wallet details, then press Save."],
  strategy: {
    activeProfile: "frog",
    frogLosses: 0,
    truenestLosses: 0,
    paused: false,
    pauseReason: "",
    processedClosedTrades: []
  },
  trades: []
};

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

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function line(text) {
  return `${new Date().toLocaleString("en-US", { hour12: false })} - ${text}`;
}

async function readState() {
  try {
    return normalizeState(JSON.parse(await readFile(dataFile, "utf8")));
  } catch {
    return normalizeState(structuredClone(defaultState));
  }
}

async function saveState(state) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(dataFile, JSON.stringify(state, null, 2));
}

async function readBody(request) {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function send(response, status, data, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(data));
}

function normalizeState(state) {
  const incomingSettings = state.settings || {};
  state.settings = { ...defaultState.settings, ...incomingSettings };
  if (incomingSettings.protectedCapStrategyVersion !== protectedCapStrategyVersion) {
    if (!state.settings.frogWallet || state.settings.frogWallet === legacyFrogWallet) {
      state.settings.frogWallet = decuWallet;
    }
    state.settings.frogMax = "50";
    state.settings.truenestMax = "50";
    state.settings.frogMode = "Copy exact amount after safety check";
    state.settings.truenestMode = "Copy exact amount after safety check";
    state.settings.frogCopySizing = "Copy exact amount";
    state.settings.truenestCopySizing = "Copy exact amount";
    state.settings.frogTraderBankroll ||= "500";
    state.settings.truenestTraderBankroll ||= "500";
    state.settings.frogRiskControl = "on";
    state.settings.truenestRiskControl = "on";
    state.settings.protectedCapStrategyVersion = protectedCapStrategyVersion;
  }
  state.settings.frogMode = normalizeCopyMode(state.settings.frogMode);
  state.settings.truenestMode = normalizeCopyMode(state.settings.truenestMode);
  state.settings.frogWalletSync ||= state.settings.walletSync || defaultState.settings.walletSync;
  state.settings.frogRiskControl ||= state.settings.riskControl || defaultState.settings.riskControl;
  state.settings.frogLiveTradingSwitch ||= state.settings.liveTradingSwitch || defaultState.settings.liveTradingSwitch;
  state.settings.truenestWalletSync ||= state.settings.walletSync || defaultState.settings.walletSync;
  state.settings.truenestRiskControl ||= state.settings.riskControl || defaultState.settings.riskControl;
  state.settings.truenestLiveTradingSwitch ||= state.settings.liveTradingSwitch || defaultState.settings.liveTradingSwitch;
  state.profiles = { ...structuredClone(defaultState.profiles), ...(state.profiles || {}) };
  state.owner = { email: (state.owner?.email || ownerEmail).toLowerCase() };
  state.customers = Array.isArray(state.customers) ? state.customers : [];
  state.customers.forEach((customer) => {
    if (!customer.id) customer.id = randomUUID();
    if (!customer.accessToken) customer.accessToken = customer.id;
    if (!customer.referralToken) customer.referralToken = randomUUID();
  });
  if (!state.settings.ownerProfitSharePercent || state.settings.ownerProfitSharePercent === "0") {
    state.settings.ownerProfitSharePercent = defaultState.settings.ownerProfitSharePercent;
  }
  if (!state.settings.referralRewardPercent) {
    state.settings.referralRewardPercent = defaultState.settings.referralRewardPercent;
  }
  state.deposits = Array.isArray(state.deposits) ? state.deposits : [];
  state.withdrawals = Array.isArray(state.withdrawals) ? state.withdrawals : [];
  state.sessions = state.sessions && typeof state.sessions === "object" ? state.sessions : {};
  state.activity = Array.isArray(state.activity) ? state.activity : [];
  state.strategy = { ...structuredClone(defaultState.strategy), ...(state.strategy || {}) };
  state.strategy.activeProfile = state.strategy.activeProfile === "truenest" ? "truenest" : "frog";
  state.strategy.frogLosses = Math.max(0, Number(state.strategy.frogLosses || 0));
  state.strategy.truenestLosses = Math.max(0, Number(state.strategy.truenestLosses || 0));
  state.strategy.paused = state.strategy.paused === true;
  state.strategy.processedClosedTrades = Array.isArray(state.strategy.processedClosedTrades)
    ? state.strategy.processedClosedTrades.slice(0, 50)
    : [];
  state.trades = Array.isArray(state.trades) ? state.trades : [];
  return state;
}

function normalizeCopyMode(mode) {
  const value = String(mode || "Copy exact amount").toLowerCase();
  if (value.includes("safety") || value.includes("protect")) return "Copy exact amount after safety check";
  return "Copy exact amount";
}

function normalizeCopySizing(value) {
  return String(value || "").toLowerCase().includes("percent") ? "Copy by percentage" : "Copy exact amount";
}

function copyModeFromProtection(value) {
  return value === "on" ? "Copy exact amount after safety check" : "Copy exact amount";
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function makePasswordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const candidate = pbkdf2Sync(String(password), salt, 120000, 32, "sha256");
  const known = Buffer.from(hash, "hex");
  return known.length === candidate.length && timingSafeEqual(known, candidate);
}

function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function cookieFor(token) {
  return `sp_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionMaxAge}`;
}

function clearCookie() {
  return "sp_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
}

function sessionFromRequest(request, state) {
  const token = parseCookies(request).sp_session;
  if (!token || !state.sessions?.[token]) return null;
  return { token, ...state.sessions[token] };
}

function createSession(state, role, id) {
  const token = randomUUID();
  state.sessions[token] = {
    role,
    id,
    createdAt: new Date().toISOString()
  };
  return token;
}

function publicSettings(settings = {}, includeSecrets = false) {
  if (includeSecrets) return settings;
  return {
    frogTradeWallet: settings.frogTradeWallet || "",
    truenestTradeWallet: settings.truenestTradeWallet || "",
    frogWallet: settings.frogWallet || "",
    truenestWallet: settings.truenestWallet || "",
    frogMax: settings.frogMax || "",
    truenestMax: settings.truenestMax || "",
    frogMode: normalizeCopyMode(settings.frogMode),
    truenestMode: normalizeCopyMode(settings.truenestMode),
    frogCopySizing: normalizeCopySizing(settings.frogCopySizing),
    truenestCopySizing: normalizeCopySizing(settings.truenestCopySizing),
    frogTraderBankroll: settings.frogTraderBankroll || "",
    truenestTraderBankroll: settings.truenestTraderBankroll || "",
    frogUseProfit: settings.frogUseProfit === "on" ? "on" : "off",
    truenestUseProfit: settings.truenestUseProfit === "on" ? "on" : "off",
    frogTradeMode: settings.frogTradeMode === "sellOnly" ? "sellOnly" : "both",
    truenestTradeMode: settings.truenestTradeMode === "sellOnly" ? "sellOnly" : "both",
    walletSync: settings.walletSync || "Turnkey server wallet",
    riskControl: settings.riskControl || "on",
    liveTradingSwitch: settings.liveTradingSwitch || "on",
    frogWalletSync: settings.frogWalletSync || settings.walletSync || "Turnkey server wallet",
    frogRiskControl: settings.frogRiskControl || settings.riskControl || "on",
    frogLiveTradingSwitch: settings.frogLiveTradingSwitch || settings.liveTradingSwitch || "on",
    truenestWalletSync: settings.truenestWalletSync || settings.walletSync || "Turnkey server wallet",
    truenestRiskControl: settings.truenestRiskControl || settings.riskControl || "on",
    truenestLiveTradingSwitch: settings.truenestLiveTradingSwitch || settings.liveTradingSwitch || "on",
    vaultMode: settings.vaultMode || "private",
    vaultFeePercent: settings.vaultFeePercent || "0",
    ownerProfitSharePercent: settings.ownerProfitSharePercent || "0",
    vaultNote: settings.vaultNote || ""
  };
}

function depositAddresses(state, plan = "frog") {
  const main = tradeWallet(state);
  const label = plan === "truenest" ? "Main trading wallet (Risk watcher)" : "Main trading wallet";
  return [{ label, address: main }];
}

function customerPublic(customer, state) {
  const deposited = Number(customer.deposited || 0);
  const profit = Number(customer.profit || 0);
  const ownerProfitSharePercent = clampPercent(state.settings.ownerProfitSharePercent);
  const referralRewardPercent = clampPercent(state.settings.referralRewardPercent);
  const grossGain = Math.max(0, profit);
  const ownerProfitShare = grossGain * (ownerProfitSharePercent / 100);
  const referralReward = customer.referredBy
    ? grossGain * (referralRewardPercent / 100)
    : 0;
  const ownerNetProfitShare = Math.max(0, ownerProfitShare - referralReward);
  const referralRewards = (state.customers || []).reduce((sum, item) => {
    if (item.referredBy !== customer.id) return sum;
    return sum + (Math.max(0, Number(item.profit || 0)) * (referralRewardPercent / 100));
  }, 0);
  const customerNetProfit = profit - ownerProfitShare;
  const withdrawn = Number(customer.withdrawn || 0);
  const withdrawable = deposited + customerNetProfit + referralRewards - withdrawn;
  const referrer = customer.referredBy
    ? (state.customers || []).find((item) => item.id === customer.referredBy)
    : null;
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone || "",
    accessToken: customer.accessToken,
    accessPath: `/player/${customer.accessToken}`,
    referralToken: customer.referralToken,
    referralPath: `/join/${customer.referralToken}`,
    referredBy: customer.referredBy || "",
    referredByName: referrer ? (referrer.name || referrer.email || "") : "",
    plan: customer.plan || "frog",
    status: customer.status || "active",
    deposited,
    profit,
    ownerProfitSharePercent,
    referralRewardPercent,
    ownerProfitShare,
    ownerNetProfitShare,
    referralReward,
    referralRewards,
    customerNetProfit,
    withdrawn,
    withdrawable,
    depositAddresses: depositAddresses(state, customer.plan)
  };
}

function clampPercent(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, number));
}

function businessSummary(state) {
  const customers = state.customers || [];
  const deposited = customers.reduce((sum, customer) => sum + Number(customer.deposited || 0), 0);
  const profit = customers.reduce((sum, customer) => sum + Number(customer.profit || 0), 0);
  const ownerProfitSharePercent = clampPercent(state.settings.ownerProfitSharePercent);
  const referralRewardPercent = clampPercent(state.settings.referralRewardPercent);
  const ownerProfitShare = customers.reduce((sum, customer) => {
    return sum + (Math.max(0, Number(customer.profit || 0)) * (ownerProfitSharePercent / 100));
  }, 0);
  const referralRewards = customers.reduce((sum, customer) => {
    if (!customer.referredBy) return sum;
    return sum + (Math.max(0, Number(customer.profit || 0)) * (referralRewardPercent / 100));
  }, 0);
  const pendingWithdrawals = (state.withdrawals || []).filter((item) => item.status === "pending").length;
  return {
    customers: customers.length,
    deposited,
    profit,
    ownerProfitSharePercent,
    referralRewardPercent,
    ownerProfitShare,
    referralRewards,
    ownerNetProfitShare: Math.max(0, ownerProfitShare - referralRewards),
    customerNetProfit: profit - ownerProfitShare,
    pendingWithdrawals
  };
}

function statusPayload(state, session) {
  const isOwner = session?.role === "owner";
  const liveTradingEnv = process.env.ENABLE_LIVE_TRADING === "true";
  const productionExecution = liveTradingAllowed(state);
  return {
    ...state,
    settings: publicSettings(state.settings, isOwner),
    sessions: undefined,
    customers: isOwner ? state.customers.map((customer) => customerPublic(customer, state)) : [],
    backend: {
      liveTrading: productionExecution,
      liveTradingEnv,
      productionExecution,
      workerIntervalMs,
      maxSignalAgeMs
    },
    auth: session ? { role: session.role, id: session.id } : null
  };
}

async function walletBalances(state) {
  const connection = solanaConnection(state.settings);
  const balances = {};

  for (const profile of ["frog", "truenest"]) {
    const wallet = tradeWallet(state, profile);
    const key = solanaAddress(wallet);
    balances[profile] = {
      address: wallet || "",
      sol: null,
      usdc: null,
      error: ""
    };

    if (!key) {
      balances[profile].error = "Wallet not connected";
      continue;
    }

    try {
      const [lamports, tokenAccounts] = await Promise.all([
        connection.getBalance(key, "confirmed"),
        connection.getParsedTokenAccountsByOwner(key, { mint: new PublicKey(usdcMint) }, "confirmed")
      ]);
      const usdc = (tokenAccounts.value || []).reduce((sum, item) => {
        return sum + Number(item.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0);
      }, 0);
      balances[profile] = {
        address: wallet,
        sol: lamports / LAMPORTS_PER_SOL,
        usdc,
        error: "",
        updatedAt: new Date().toISOString()
      };
    } catch (error) {
      balances[profile].error = error.message || "Balance check failed";
    }
  }

  return balances;
}

async function tokenUiBalance(connection, owner, mint) {
  const ownerKey = solanaAddress(owner);
  const mintKey = solanaAddress(mint);
  if (!ownerKey || !mintKey) return 0;
  const accounts = await connection.getParsedTokenAccountsByOwner(ownerKey, { mint: mintKey }, "confirmed");
  return (accounts.value || []).reduce((sum, item) => {
    return sum + Number(item.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0);
  }, 0);
}

function associatedTokenAddress(owner, mint) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgramId.toBuffer(), mint.toBuffer()],
    associatedTokenProgramId
  )[0];
}

function createAssociatedTokenAccountInstruction(payer, ata, owner, mint) {
  return new TransactionInstruction({
    programId: associatedTokenProgramId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false }
    ],
    data: Buffer.alloc(0)
  });
}

function createTransferCheckedInstruction(source, mint, destination, owner, amount, decimals) {
  const data = Buffer.alloc(10);
  data[0] = 12;
  data.writeBigUInt64LE(BigInt(amount), 1);
  data[9] = decimals;
  return new TransactionInstruction({
    programId: tokenProgramId,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false }
    ],
    data
  });
}

function requireOwner(response, session) {
  if (session?.role === "owner") return false;
  send(response, 401, { error: "Owner login required." });
  return true;
}

function clean(input) {
  const out = {};
  for (const field of fields) {
    if (typeof input[field] === "string") out[field] = input[field].trim();
  }
  if (out.frogMode) out.frogMode = normalizeCopyMode(out.frogMode);
  if (out.truenestMode) out.truenestMode = normalizeCopyMode(out.truenestMode);
  if (out.frogCopySizing) out.frogCopySizing = normalizeCopySizing(out.frogCopySizing);
  if (out.truenestCopySizing) out.truenestCopySizing = normalizeCopySizing(out.truenestCopySizing);
  if (out.frogRiskControl === "on" || out.frogRiskControl === "off") out.frogMode = copyModeFromProtection(out.frogRiskControl);
  if (out.truenestRiskControl === "on" || out.truenestRiskControl === "off") out.truenestMode = copyModeFromProtection(out.truenestRiskControl);
  return out;
}

function ready(state) {
  const s = state.settings;
  return Boolean(
    s.heliusKey &&
    s.routeApi &&
    s.turnkeyOrgId &&
    s.turnkeyApiPublicKey &&
    s.turnkeyApiPrivateKey &&
    s.frogTradeWallet &&
    s.frogSignerToken
  );
}

function profileSetting(state, profile, key, fallback = "") {
  const prefix = profile === "frog" ? "frog" : "truenest";
  const profileKey = `${prefix}${key[0].toUpperCase()}${key.slice(1)}`;
  return state.settings[profileKey] || state.settings[key] || fallback;
}

function profileWalletSync(state, profile) {
  return state.settings.frogWalletSync || state.settings.walletSync || "Turnkey server wallet";
}

function profileRiskControl(state, profile) {
  return profileSetting(state, profile, "riskControl", "on");
}

function profileMode(state, profile) {
  const mode = profile === "frog" ? state.settings.frogMode : state.settings.truenestMode;
  return String(mode || "Copy exact amount");
}

function profileCopySizing(state, profile) {
  const value = profile === "frog" ? state.settings.frogCopySizing : state.settings.truenestCopySizing;
  return normalizeCopySizing(value);
}

function profileProtectionEnabled(state, profile) {
  const mode = profileMode(state, profile).toLowerCase();
  if (mode.includes("safety") || mode.includes("protect")) return true;
  if (mode.includes("exact amount")) return false;
  return profileRiskControl(state, profile) === "on";
}

function profileLiveTradingSwitch(state, profile) {
  return profileSetting(state, profile, "liveTradingSwitch", "on");
}

function profileSellOnly(state, profile) {
  const value = profile === "frog" ? state.settings.frogTradeMode : state.settings.truenestTradeMode;
  return value === "sellOnly";
}

function liveTradingAllowed(state, profile = "") {
  if (!ready(state) || process.env.ENABLE_LIVE_TRADING !== "true" || process.env.EXECUTE_REAL_SWAPS !== "true") {
    return false;
  }
  if (!profile) return ["frog", "truenest"].some((item) => liveTradingAllowed(state, item));
  return profileLiveTradingSwitch(state, profile) === "on" && profileWalletSync(state, profile) === "Turnkey server wallet";
}

function profileLabel(profile) {
  return profile === "frog" ? "Decu Win" : "Risk Win";
}

function strategyLossKey(profile) {
  return profile === "frog" ? "frogLosses" : "truenestLosses";
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

function closedTraderPnlUsd(trades = [], sellTrade = {}, profile = "frog") {
  if (tradeSide(sellTrade) !== "sell" || !roomMatchesProfile(sellTrade, profile)) return null;
  const sellReceived = Number(sellTrade.sourceReceivedUsd || sellTrade.traderPnlUsd || 0);
  if (!Number.isFinite(sellReceived) || sellReceived <= 0) return null;

  const sellIndex = trades.findIndex((trade) => (trade.signature || trade.id) === (sellTrade.signature || sellTrade.id));
  const olderTrades = sellIndex === -1 ? trades : trades.slice(sellIndex + 1);
  const tokenKey = tradeTokenKey(sellTrade);
  const priorBuy = olderTrades.find((trade) => {
    return roomMatchesProfile(trade, profile)
      && tradeSide(trade) === "buy"
      && (!tokenKey || tradeTokenKey(trade) === tokenKey)
      && Number(trade.sourceUsd || 0) > 0;
  });

  const buyUsed = Number(priorBuy?.sourceUsd || 0);
  if (!Number.isFinite(buyUsed) || buyUsed <= 0) return null;
  return sellReceived - buyUsed;
}

function applyAutoSwitchStrategy(state, newTrades = []) {
  state.strategy = { ...structuredClone(defaultState.strategy), ...(state.strategy || {}) };
  if (state.strategy.paused) return;

  const combinedTrades = state.trades || [];
  const processed = new Set(state.strategy.processedClosedTrades || []);
  const strategyEvents = [];

  for (const trade of newTrades) {
    const profile = trade.profile === "Risk Win" || trade.profile === "truenest" ? "truenest" : "frog";
    const tradeId = trade.signature || trade.id;
    if (!tradeId || processed.has(tradeId) || tradeSide(trade) !== "sell") continue;

    const closedPnl = closedTraderPnlUsd(combinedTrades, trade, profile);
    if (closedPnl === null) continue;
    processed.add(tradeId);

    const lossKey = strategyLossKey(profile);
    if (closedPnl < 0) {
      state.strategy[lossKey] = Number(state.strategy[lossKey] || 0) + 1;
      strategyEvents.push(`${profileLabel(profile)} closed loss ${state.strategy[lossKey]}/3 (${closedPnl.toFixed(2)}).`);
    } else {
      state.strategy[lossKey] = 0;
      strategyEvents.push(`${profileLabel(profile)} closed profit ${closedPnl.toFixed(2)}; loss count reset.`);
    }

    if (profile === "frog" && state.strategy.frogLosses >= 3) {
      state.profiles.frog.running = false;
      state.profiles.truenest.running = true;
      state.profiles.truenest.lastAction = new Date().toISOString();
      state.strategy.activeProfile = "truenest";
      state.strategy.truenestLosses = 0;
      strategyEvents.push("Deku reached 3 losses. SignalPilot switched to Trunoest.");
    }

    if (profile === "truenest" && state.strategy.truenestLosses >= 3) {
      state.profiles.frog.running = false;
      state.profiles.truenest.running = false;
      state.strategy.paused = true;
      state.strategy.pauseReason = "Trunoest reached 3 losses. Trading paused until owner restarts.";
      strategyEvents.push(state.strategy.pauseReason);
      break;
    }
  }

  state.strategy.processedClosedTrades = Array.from(processed).slice(-50);
  if (strategyEvents.length) {
    state.activity = [
      ...strategyEvents.reverse().map((message) => line(message)),
      ...(state.activity || [])
    ].slice(0, 20);
  }
}

function targetWallet(state, profile) {
  return profile === "frog" ? state.settings.frogWallet : state.settings.truenestWallet;
}

function newestSignature(transactions) {
  return transactions.find((transaction) => transaction?.signature)?.signature || null;
}

function looksLikeSwap(transaction) {
  const type = `${transaction.type || transaction.transactionType || ""}`.toUpperCase();
  const source = `${transaction.source || ""}`.toUpperCase();
  return type.includes("SWAP") || source.includes("JUPITER") || source.includes("RAYDIUM") || source.includes("METEORA");
}

function copyableSignal(profile, transaction, state) {
  return looksLikeSwap(transaction) || Boolean(extractCopySignal(profile, transaction, state));
}

function movementSummary(transaction = {}) {
  const type = `${transaction.type || transaction.transactionType || "movement"}`;
  const source = `${transaction.source || "unknown source"}`;
  return `${type} from ${source}`;
}

function tokenName(transaction) {
  const transfer = transaction.tokenTransfers?.[0] || transaction.events?.swap?.tokenInputs?.[0] || transaction.events?.swap?.tokenOutputs?.[0];
  return transfer?.symbol || transfer?.mint || transfer?.tokenMint || "Solana token";
}

function tradeAmount(transaction) {
  const nativeAmount = transaction.nativeTransfers?.reduce((total, transfer) => total + Math.abs(Number(transfer.amount || 0)), 0) || 0;
  if (nativeAmount) return nativeAmount / 1_000_000_000;
  const tokenAmount = transaction.tokenTransfers?.[0]?.tokenAmount || transaction.events?.swap?.tokenInputs?.[0]?.tokenAmount;
  return Number(tokenAmount || 0);
}

function transferMint(transfer = {}) {
  return transfer.mint || transfer.tokenMint || transfer.rawTokenAmount?.mint || "";
}

function transferAmount(transfer = {}) {
  const raw = transfer.rawTokenAmount?.tokenAmount || transfer.rawAmount || transfer.amountRaw;
  if (raw !== undefined && raw !== null && String(raw) !== "") return String(raw);
  const decimals = Number(transfer.rawTokenAmount?.decimals ?? transfer.decimals ?? 0);
  const tokenAmount = Number(transfer.tokenAmount ?? transfer.amount ?? 0);
  if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) return "";
  return String(Math.round(tokenAmount * (10 ** decimals)));
}

function rawAmountToNumber(rawAmount = {}) {
  const tokenAmount = Number(rawAmount.tokenAmount ?? rawAmount.amount ?? 0);
  const decimals = Number(rawAmount.decimals ?? 0);
  if (!Number.isFinite(tokenAmount) || !Number.isFinite(decimals)) return 0;
  return tokenAmount / (10 ** decimals);
}

function isQuoteMint(mint = "") {
  return [solMint, usdcMint, usdtMint].includes(String(mint));
}

function sameAddress(left = "", right = "") {
  return String(left || "").trim() && String(left || "").trim() === String(right || "").trim();
}

function transferLeavesWallet(transfer = {}, wallet = "") {
  return sameAddress(transfer.fromUserAccount, wallet);
}

function transferEntersWallet(transfer = {}, wallet = "") {
  return sameAddress(transfer.toUserAccount, wallet);
}

function accountTokenChanges(transaction = {}, wallet = "") {
  const account = (transaction.accountData || []).find((item) => sameAddress(item.account, wallet));
  const changes = Array.isArray(account?.tokenBalanceChanges) ? account.tokenBalanceChanges : [];
  return changes
    .map((change) => ({
      mint: transferMint(change),
      amount: rawAmountToNumber(change.rawTokenAmount || change),
      rawAmount: change.rawTokenAmount?.tokenAmount || ""
    }))
    .filter((change) => change.mint && change.amount);
}

function nativeChange(transaction = {}, wallet = "") {
  const account = (transaction.accountData || []).find((item) => sameAddress(item.account, wallet));
  if (account?.nativeBalanceChange) return Number(account.nativeBalanceChange || 0) / LAMPORTS_PER_SOL;
  const transfers = Array.isArray(transaction.nativeTransfers) ? transaction.nativeTransfers : [];
  return transfers.reduce((sum, transfer) => {
    if (sameAddress(transfer.fromUserAccount, wallet)) return sum - (Number(transfer.amount || 0) / LAMPORTS_PER_SOL);
    if (sameAddress(transfer.toUserAccount, wallet)) return sum + (Number(transfer.amount || 0) / LAMPORTS_PER_SOL);
    return sum;
  }, 0);
}

function usdcRawFromUsd(value) {
  const usd = Number(value || 0);
  if (!Number.isFinite(usd) || usd <= 0) return "";
  return String(Math.max(1, Math.floor(usd * 1_000_000)));
}

function buyUsdAmount(state, profile, sourceUsd = 0) {
  const deposit = profileDepositUsd(state, profile);
  const maxUsd = profileMaxUsd(state, profile);
  const traderBankroll = profileTraderBankrollUsd(state, profile);
  let usd = Number(sourceUsd || 0);

  if (profileCopySizing(state, profile) === "Copy by percentage" && sourceUsd && traderBankroll && deposit) {
    usd = (Number(sourceUsd) / traderBankroll) * deposit;
  } else if (!usd) {
    usd = maxUsd || Math.min(deposit || 0, 50);
  }

  if (maxUsd) usd = Math.min(usd, maxUsd);
  if (deposit) usd = Math.min(usd, deposit);
  return Number.isFinite(usd) && usd > 0 ? usd : 0;
}

function sourceUsdFromSignal(transaction = {}, wallet = "") {
  const transfers = Array.isArray(transaction.tokenTransfers) ? transaction.tokenTransfers : [];
  const quoteTransfer = transfers.find((item) => transferLeavesWallet(item, wallet) && [usdcMint, usdtMint].includes(transferMint(item)));
  if (quoteTransfer) return Number(quoteTransfer.tokenAmount || quoteTransfer.amount || 0);

  const changes = accountTokenChanges(transaction, wallet);
  const quoteChange = changes.find((item) => [usdcMint, usdtMint].includes(item.mint) && item.amount < 0);
  if (quoteChange) return Math.abs(quoteChange.amount);

  const swap = transaction.events?.swap || {};
  const tokenInput = (swap.tokenInputs || []).find((item) => [usdcMint, usdtMint].includes(transferMint(item)));
  if (tokenInput) return Number(tokenInput.tokenAmount || tokenInput.amount || 0);
  return 0;
}

function receivedUsdFromSignal(transaction = {}, wallet = "") {
  const transfers = Array.isArray(transaction.tokenTransfers) ? transaction.tokenTransfers : [];
  const quoteTransfer = transfers.find((item) => transferEntersWallet(item, wallet) && [usdcMint, usdtMint].includes(transferMint(item)));
  if (quoteTransfer) return Number(quoteTransfer.tokenAmount || quoteTransfer.amount || 0);

  const changes = accountTokenChanges(transaction, wallet);
  const quoteChange = changes.find((item) => [usdcMint, usdtMint].includes(item.mint) && item.amount > 0);
  if (quoteChange) return Math.abs(quoteChange.amount);

  const swap = transaction.events?.swap || {};
  const tokenOutput = (swap.tokenOutputs || []).find((item) => [usdcMint, usdtMint].includes(transferMint(item)));
  if (tokenOutput) return Number(tokenOutput.tokenAmount || tokenOutput.amount || 0);
  return 0;
}

function extractCopySignal(profile, transaction, state) {
  const wallet = targetWallet(state, profile);
  if (!wallet) return null;

  const swap = transaction.events?.swap || {};
  const eventInput = (swap.tokenInputs || []).find((item) => transferMint(item) && transferAmount(item));
  const eventOutput = (swap.tokenOutputs || []).find((item) => transferMint(item));
  if (eventInput && eventOutput) {
    const inputMint = transferMint(eventInput);
    const outputMint = transferMint(eventOutput);
    return {
      action: isQuoteMint(inputMint) && !isQuoteMint(outputMint) ? "buy" : "sell",
      inputMint,
      outputMint,
      amount: transferAmount(eventInput),
      inputSymbol: eventInput.symbol || inputMint,
      outputSymbol: eventOutput.symbol || outputMint,
      sourceUsd: sourceUsdFromSignal(transaction, wallet)
    };
  }

  const transfers = Array.isArray(transaction.tokenTransfers) ? transaction.tokenTransfers : [];
  const outgoingToken = transfers.find((item) => transferLeavesWallet(item, wallet) && transferMint(item) && !isQuoteMint(transferMint(item)) && transferAmount(item));
  const incomingToken = transfers.find((item) => transferEntersWallet(item, wallet) && transferMint(item) && !isQuoteMint(transferMint(item)));
  const outgoingQuote = transfers.find((item) => transferLeavesWallet(item, wallet) && isQuoteMint(transferMint(item)) && transferAmount(item));
  const incomingQuote = transfers.find((item) => transferEntersWallet(item, wallet) && isQuoteMint(transferMint(item)));
  const native = nativeChange(transaction, wallet);

  if (incomingToken && (outgoingQuote || native < 0)) {
    return {
      action: "buy",
      inputMint: outgoingQuote ? transferMint(outgoingQuote) : solMint,
      outputMint: transferMint(incomingToken),
      amount: outgoingQuote ? transferAmount(outgoingQuote) : String(Math.round(Math.abs(native) * LAMPORTS_PER_SOL)),
      inputSymbol: outgoingQuote?.symbol || "SOL",
      outputSymbol: incomingToken.symbol || transferMint(incomingToken),
      sourceUsd: sourceUsdFromSignal(transaction, wallet)
    };
  }

  if (outgoingToken && (incomingQuote || native > 0)) {
    return {
      action: "sell",
      inputMint: transferMint(outgoingToken),
      outputMint: incomingQuote ? transferMint(incomingQuote) : solMint,
      amount: transferAmount(outgoingToken),
      inputSymbol: outgoingToken.symbol || transferMint(outgoingToken),
      outputSymbol: incomingQuote?.symbol || "SOL",
      sourceUsd: 0
    };
  }

  const changes = accountTokenChanges(transaction, wallet);
  const gainedToken = changes.find((item) => item.amount > 0 && !isQuoteMint(item.mint));
  const lostToken = changes.find((item) => item.amount < 0 && !isQuoteMint(item.mint));
  const lostQuote = changes.find((item) => item.amount < 0 && isQuoteMint(item.mint));
  const gainedQuote = changes.find((item) => item.amount > 0 && isQuoteMint(item.mint));
  if (gainedToken && (lostQuote || native < 0)) {
    return {
      action: "buy",
      inputMint: lostQuote?.mint || solMint,
      outputMint: gainedToken.mint,
      amount: lostQuote?.rawAmount || String(Math.round(Math.abs(native) * LAMPORTS_PER_SOL)),
      inputSymbol: lostQuote?.mint || "SOL",
      outputSymbol: gainedToken.mint,
      sourceUsd: sourceUsdFromSignal(transaction, wallet)
    };
  }
  if (lostToken && (gainedQuote || native > 0)) {
    return {
      action: "sell",
      inputMint: lostToken.mint,
      outputMint: gainedQuote?.mint || solMint,
      amount: String(Math.abs(Number(lostToken.rawAmount || 0))),
      inputSymbol: lostToken.mint,
      outputSymbol: gainedQuote?.mint || "SOL",
      sourceUsd: 0
    };
  }

  return null;
}

function primarySwapLeg(transaction, profile, state) {
  if (profile && state) return extractCopySignal(profile, transaction, state);

  const swap = transaction.events?.swap || {};
  const input = (swap.tokenInputs || []).find((item) => transferMint(item) && transferAmount(item));
  const output = (swap.tokenOutputs || []).find((item) => transferMint(item));
  if (input && output) {
    return {
      inputMint: transferMint(input),
      outputMint: transferMint(output),
      amount: transferAmount(input),
      inputSymbol: input.symbol || transferMint(input),
      outputSymbol: output.symbol || transferMint(output)
    };
  }

  const transfers = Array.isArray(transaction.tokenTransfers) ? transaction.tokenTransfers : [];
  const fromTrader = transfers.find((item) => transferMint(item) && transferAmount(item) && item.fromUserAccount === transaction.accountData?.[0]?.account);
  const toTrader = transfers.find((item) => transferMint(item) && item.toUserAccount === transaction.accountData?.[0]?.account);
  if (fromTrader && toTrader) {
    return {
      inputMint: transferMint(fromTrader),
      outputMint: transferMint(toTrader),
      amount: transferAmount(fromTrader),
      inputSymbol: fromTrader.symbol || transferMint(fromTrader),
      outputSymbol: toTrader.symbol || transferMint(toTrader)
    };
  }

  return null;
}

function tradeWallet(state) {
  return state.settings.frogTradeWallet || state.settings.truenestTradeWallet || "";
}

function signerId(state) {
  return state.settings.frogSignerToken || state.settings.truenestSignerToken || tradeWallet(state);
}

function solanaConnection(settings = {}) {
  const key = String(settings.heliusKey || "").trim();
  const endpoint = key
    ? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`
    : clusterApiUrl("mainnet-beta");
  return new Connection(endpoint, "confirmed");
}

function solanaAddress(value) {
  try {
    return new PublicKey(String(value || "").trim());
  } catch {
    return null;
  }
}

async function executeSolWithdrawal(state, { profile, destination, amountSol }) {
  if (profile !== "frog" && profile !== "truenest") throw new Error("Choose Decu Win or Risk Win wallet.");
  const sourceWallet = tradeWallet(state, profile);
  const signer = signerId(state, profile) || sourceWallet;
  const from = solanaAddress(sourceWallet);
  const to = solanaAddress(destination);
  const amount = Number(amountSol || 0);

  if (!from || !signer) throw new Error("Trading wallet or Turnkey signer is missing.");
  if (!to) throw new Error("Enter a valid Solana wallet address.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid SOL amount.");

  const lamports = Math.round(amount * LAMPORTS_PER_SOL);
  if (lamports <= 0) throw new Error("Amount is too small.");

  const connection = solanaConnection(state.settings);
  const balance = await connection.getBalance(from, "confirmed");
  const feeReserve = 7000;
  if (balance < lamports + feeReserve) {
    throw new Error(`Not enough SOL in ${profileLabel(profile)} wallet for this withdrawal and network fee.`);
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer: from,
    recentBlockhash: blockhash
  }).add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }));

  const unsignedTransaction = transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
  const signed = await signSolanaTransaction(state, signer, sourceWallet, unsignedTransaction);

  const signature = await connection.sendRawTransaction(Buffer.from(signed.signedTransactionBase64, "base64"), {
    skipPreflight: false,
    maxRetries: 3
  });
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");

  return {
    signature,
    sourceWallet,
    destination: to.toBase58(),
    amountSol: amount
  };
}

async function executeUsdcWithdrawal(state, { profile, destination, amountUsd, profitOnly = false }) {
  if (profile !== "frog" && profile !== "truenest") throw new Error("Choose Decu Win or Risk Win wallet.");
  const sourceWallet = tradeWallet(state, profile);
  const signer = signerId(state, profile) || sourceWallet;
  const from = solanaAddress(sourceWallet);
  const to = solanaAddress(destination);
  const amount = Number(amountUsd || 0);

  if (!from || !signer) throw new Error("Trading wallet or Turnkey signer is missing.");
  if (!to) throw new Error("Enter a valid Solana wallet address.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid USDC amount.");

  const connection = solanaConnection(state.settings);
  const currentUsdc = await tokenUiBalance(connection, sourceWallet, usdcMint);
  const principal = profileDepositUsd(state, profile);
  const lockedProfit = Math.max(0, currentUsdc - principal);
  const available = profitOnly ? lockedProfit : currentUsdc;
  if (amount > available + 0.000001) {
    throw new Error(profitOnly
      ? `Profit available is only $${available.toFixed(2)}. Principal stays locked for trading.`
      : `USDC available is only $${available.toFixed(2)}.`);
  }

  const mint = new PublicKey(usdcMint);
  const sourceAta = associatedTokenAddress(from, mint);
  const destinationAta = associatedTokenAddress(to, mint);
  const rawAmount = Math.floor(amount * (10 ** usdcDecimals));
  if (rawAmount <= 0) throw new Error("USDC amount is too small.");

  const instructions = [];
  const destinationAccount = await connection.getAccountInfo(destinationAta, "confirmed");
  if (!destinationAccount) {
    instructions.push(createAssociatedTokenAccountInstruction(from, destinationAta, to, mint));
  }
  instructions.push(createTransferCheckedInstruction(sourceAta, mint, destinationAta, from, rawAmount, usdcDecimals));

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer: from,
    recentBlockhash: blockhash
  }).add(...instructions);

  const unsignedTransaction = transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
  const signed = await signSolanaTransaction(state, signer, sourceWallet, unsignedTransaction);

  const signature = await connection.sendRawTransaction(Buffer.from(signed.signedTransactionBase64, "base64"), {
    skipPreflight: false,
    maxRetries: 3
  });
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");

  return {
    signature,
    sourceWallet,
    destination: to.toBase58(),
    amountUsd: amount,
    profitOnly,
    lockedProfitBefore: lockedProfit
  };
}

function profileMaxUsd(state, profile) {
  const value = Number(profile === "frog" ? state.settings.frogMax : state.settings.truenestMax);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function profileDepositUsd(state, profile) {
  const value = Number(state.settings.frogDeposit || state.settings.truenestDeposit);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function profileTradeableUsdc(connection, state, profile, wallet) {
  const principal = profileDepositUsd(state, profile);
  const currentUsdc = await tokenUiBalance(connection, wallet, usdcMint);
  const useProfit = state.settings.frogUseProfit === "on";
  if (useProfit) return currentUsdc;
  if (!principal) return currentUsdc;
  return Math.max(0, Math.min(currentUsdc, principal));
}

function profileTraderBankrollUsd(state, profile) {
  const value = Number(profile === "frog" ? state.settings.frogTraderBankroll : state.settings.truenestTraderBankroll);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function scaledCopyAmount(amount, state, profile) {
  if (profileCopySizing(state, profile) !== "Copy by percentage") {
    return { amount: String(amount), note: "Exact amount copy" };
  }
  const deposit = profileDepositUsd(state, profile);
  const traderBankroll = profileTraderBankrollUsd(state, profile);
  if (!deposit || !traderBankroll) {
    return { amount: String(amount), note: "Percentage copy missing deposit or trader wallet size, used exact amount" };
  }
  const scale = Math.max(1, Math.round((deposit / traderBankroll) * 1_000_000));
  const scaled = (BigInt(String(amount)) * BigInt(scale)) / 1_000_000n;
  return {
    amount: String(scaled > 0n ? scaled : 1n),
    note: `Percentage copy ${deposit}/${traderBankroll}`
  };
}

function jupiterApiKey(settings = {}) {
  const value = String(settings.routeApi || "").trim();
  if (!value || value.startsWith("http://") || value.startsWith("https://")) return "";
  return value;
}

function turnkeyClient(settings = {}) {
  return new Turnkey({
    apiBaseUrl: "https://api.turnkey.com",
    apiPublicKey: settings.turnkeyApiPublicKey,
    apiPrivateKey: settings.turnkeyApiPrivateKey,
    defaultOrganizationId: settings.turnkeyOrgId
  }).apiClient();
}

function base64ToHex(value = "") {
  return Buffer.from(value, "base64").toString("hex");
}

function hexToBase64(value = "") {
  return Buffer.from(value, "hex").toString("base64");
}

async function signSolanaTransaction(state, preferredSigner, wallet, unsignedTransactionBase64) {
  const candidates = [...new Set([preferredSigner, wallet].filter(Boolean))];
  const unsignedTransaction = base64ToHex(unsignedTransactionBase64);
  let lastError = null;
  for (const signWith of candidates) {
    try {
      const signed = await turnkeyClient(state.settings).signTransaction({
        signWith,
        unsignedTransaction,
        type: "TRANSACTION_TYPE_SOLANA"
      });
      if (signed?.signedTransaction) {
        return {
          ...signed,
          signWith,
          signedTransactionHex: signed.signedTransaction,
          signedTransactionBase64: hexToBase64(signed.signedTransaction)
        };
      }
      lastError = new Error(`Turnkey did not return a signed Solana transaction for ${signWith}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Turnkey did not return a signed Solana transaction");
}

async function jupiterJson(pathname, { apiKey, method = "GET", query, body } = {}) {
  const url = new URL(`https://api.jup.ag${pathname}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== "") url.searchParams.set(key, String(value));
  });
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "x-api-key": apiKey } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error || payload.errorMessage) {
    throw new Error(payload.errorMessage || payload.error || `Jupiter returned ${response.status}`);
  }
  return payload;
}

async function tokenBalanceRaw(connection, owner, mint) {
  const ownerKey = solanaAddress(owner);
  const mintKey = solanaAddress(mint);
  if (!ownerKey || !mintKey) return "";
  const accounts = await connection.getParsedTokenAccountsByOwner(ownerKey, { mint: mintKey }, "confirmed");
  let total = 0n;
  for (const item of accounts.value || []) {
    const amount = item.account?.data?.parsed?.info?.tokenAmount?.amount;
    if (amount) total += BigInt(amount);
  }
  return total > 0n ? String(total) : "";
}

async function latestHeldCopiedToken(connection, state, profile, wallet) {
  const roomTrades = (state.trades || []).filter((trade) => roomMatchesProfile(trade, profile));

  for (const trade of roomTrades) {
    const action = String(trade.action || trade.execution?.action || "").toLowerCase();
    const status = String(trade.status || "").toLowerCase();
    const mint = trade.tradedTokenMint || trade.execution?.outputMint || trade.token;
    if (!action.includes("buy") || !status.includes("executed") || !mint || isQuoteMint(mint)) continue;
    const amount = await tokenBalanceRaw(connection, wallet, mint);
    if (amount) return { mint, amount };
  }

  return null;
}

async function executeCopiedSwap(profile, transaction, state) {
  const leg = primarySwapLeg(transaction, profile, state);
  if (!leg?.inputMint || !leg?.outputMint || !leg?.amount) {
    return { status: "Skipped - unsupported swap format" };
  }

  const wallet = tradeWallet(state, profile);
  const signer = signerId(state, profile) || wallet;
  const apiKey = jupiterApiKey(state.settings);
  if (!wallet || !signer) return { status: "Skipped - trading wallet or signer missing" };
  const connection = solanaConnection(state.settings);
  let inputMint = leg.inputMint;
  let outputMint = leg.outputMint;
  let copyAmount = scaledCopyAmount(leg.amount, state, profile);

  if (leg.action === "buy") {
    if (profileSellOnly(state, profile)) {
      return { status: "Skipped - Sell Only mode is ON, new buys are blocked" };
    }
    let buyUsd = buyUsdAmount(state, profile, leg.sourceUsd);
    if (!buyUsd) return { status: "Skipped - no deposit amount available for USDC buy" };
    const tradeableUsdc = await profileTradeableUsdc(connection, state, profile, wallet);
    if (tradeableUsdc <= 0) return { status: "Skipped - no tradeable USDC after profit lock" };
    buyUsd = Math.min(buyUsd, tradeableUsdc);
    inputMint = usdcMint;
    outputMint = leg.outputMint;
    copyAmount = {
      amount: usdcRawFromUsd(buyUsd),
      note: `USDC buy ${buyUsd.toFixed(2)}${leg.sourceUsd ? " from source trade size" : " fallback/protected size"}; profit lock kept extra USDC out`
    };
  }

  if (leg.action === "sell") {
    let heldAmount = await tokenBalanceRaw(connection, wallet, leg.inputMint);
    let sellNote = "Sell current copied token balance back to USDC";
    if (!heldAmount) {
      const fallback = await latestHeldCopiedToken(connection, state, profile, wallet);
      if (!fallback) return { status: `Skipped - no ${leg.inputSymbol || "token"} balance to sell` };
      inputMint = fallback.mint;
      heldAmount = fallback.amount;
      sellNote = `Decu sell detected; sold last held copied token ${fallback.mint} because direct sell token was not in wallet`;
    } else {
      inputMint = leg.inputMint;
    }
    outputMint = usdcMint;
    copyAmount = {
      amount: heldAmount,
      note: sellNote
    };
  }

  const order = await jupiterJson("/swap/v2/order", {
    apiKey,
    query: {
      inputMint,
      outputMint,
      amount: copyAmount.amount,
      taker: wallet,
      swapMode: "ExactIn",
      slippageBps: 200
    }
  });

  if (!order.transaction) {
    return { status: `Skipped - Jupiter could not build transaction${order.errorCode ? ` (${order.errorCode})` : ""}` };
  }

  const maxUsd = profileMaxUsd(state, profile);
  if (leg.action !== "sell" && maxUsd && Number(order.inUsdValue || 0) > maxUsd) {
    if (profileProtectionEnabled(state, profile)) {
      return { status: `Skipped - signal value $${Number(order.inUsdValue).toFixed(2)} is over ${profileLabel(profile)} max $${maxUsd}` };
    }
  }

  const signed = await signSolanaTransaction(state, signer, wallet, order.transaction);

  const executed = await jupiterJson("/swap/v2/execute", {
    apiKey,
    method: "POST",
    body: {
      signedTransaction: signed.signedTransactionBase64,
      requestId: order.requestId,
      lastValidBlockHeight: order.lastValidBlockHeight
    }
  });

  return {
    status: "Executed",
    action: leg.action,
    inputMint,
    outputMint,
    inputSymbol: leg.inputSymbol,
    outputSymbol: leg.outputSymbol,
    copySizing: profileCopySizing(state, profile),
    copySizingNote: copyAmount.note,
    copiedSourceAmount: String(leg.amount),
    copiedTradeAmount: copyAmount.amount,
    signedWith: signed.signWith,
    requestId: order.requestId,
    swapUsdValue: order.swapUsdValue,
    outAmount: order.outAmount,
    txid: executed.signature || executed.txid || executed.transactionId || executed.swapTransaction || ""
  };
}

async function executeManualTokenSell(state, { profile, mint }) {
  const wallet = tradeWallet(state, profile);
  const signer = signerId(state, profile) || wallet;
  const tokenMint = solanaAddress(mint)?.toBase58();
  if (!wallet || !signer) throw new Error(`${profileLabel(profile)} trading wallet or signer is missing.`);
  if (!tokenMint || isQuoteMint(tokenMint)) throw new Error("Enter the held token mint to sell.");
  if (!liveTradingAllowed(state, profile)) throw new Error(`${profileLabel(profile)} live trading is not enabled.`);

  const connection = solanaConnection(state.settings);
  const heldAmount = await tokenBalanceRaw(connection, wallet, tokenMint);
  if (!heldAmount) throw new Error(`${profileLabel(profile)} does not hold this token anymore.`);

  const order = await jupiterJson("/swap/v2/order", {
    apiKey: jupiterApiKey(state.settings),
    query: {
      inputMint: tokenMint,
      outputMint: usdcMint,
      amount: heldAmount,
      taker: wallet,
      swapMode: "ExactIn",
      slippageBps: 500
    }
  });

  if (!order.transaction) {
    throw new Error(`Jupiter could not build sell transaction${order.errorCode ? ` (${order.errorCode})` : ""}.`);
  }

  const signed = await signSolanaTransaction(state, signer, wallet, order.transaction);
  const executed = await jupiterJson("/swap/v2/execute", {
    apiKey: jupiterApiKey(state.settings),
    method: "POST",
    body: {
      signedTransaction: signed.signedTransactionBase64,
      requestId: order.requestId,
      lastValidBlockHeight: order.lastValidBlockHeight
    }
  });

  return {
    status: "Executed",
    action: "sell",
    inputMint: tokenMint,
    outputMint: usdcMint,
    inputSymbol: tokenMint,
    outputSymbol: "USDC",
    copySizingNote: "Manual emergency sell of held token to USDC; SOL gas remains in wallet",
    copiedTradeAmount: heldAmount,
    signedWith: signed.signWith,
    requestId: order.requestId,
    swapUsdValue: order.swapUsdValue,
    outAmount: order.outAmount,
    txid: executed.signature || executed.txid || executed.transactionId || executed.swapTransaction || ""
  };
}

function roomMatchesProfile(trade = {}, profile = "") {
  const text = String(trade.profile || "").toLowerCase();
  return profile === "frog"
    ? text.includes("decu win") || text.includes("deku") || text.includes("decu") || text.includes("smart win") || text.includes("frog")
    : text.includes("risk win") || text.includes("truenest") || text.includes("big win");
}

async function autoSellStuckTokenAfterSellSignal(state, profile, leg, sourceTrade = {}) {
  if (leg?.action !== "sell" || !liveTradingAllowed(state, profile)) return null;
  const wallet = tradeWallet(state, profile);
  if (!wallet) return null;

  const connection = solanaConnection(state.settings);
  const candidates = [];
  if (leg.inputMint && !isQuoteMint(leg.inputMint)) candidates.push(leg.inputMint);

  const normalSellExecuted = String(sourceTrade.status || "").toLowerCase().includes("executed");
  if (!normalSellExecuted) {
    const fallback = await latestHeldCopiedToken(connection, state, profile, wallet);
    if (fallback?.mint && !candidates.includes(fallback.mint)) candidates.push(fallback.mint);
  }

  for (const mint of candidates) {
    const balance = await tokenBalanceRaw(connection, wallet, mint);
    if (!balance) continue;

    const result = await executeManualTokenSell(state, { profile, mint });
    return {
      id: result.txid || randomUUID(),
      signature: result.txid || "",
      time: new Date().toLocaleString("en-US", { hour12: false }),
      profile: profileLabel(profile),
      action: "Auto stuck sell",
      token: result.inputMint,
      tradedToken: result.inputMint,
      tradedTokenMint: result.inputMint,
      amount: Number(result.swapUsdValue || 0),
      sourceUsd: 0,
      sourceReceivedUsd: Number(result.swapUsdValue || 0),
      traderPnlUsd: 0,
      pnl: 0,
      status: "Executed",
      execution: {
        ...result,
        copySizingNote: `Auto stuck sell after Decu sell signal${sourceTrade.signature ? ` ${sourceTrade.signature}` : ""}; token was still in wallet`
      }
    };
  }

  return null;
}

function tradeFromTransaction(profile, transaction, state) {
  const status = liveTradingAllowed(state, profile)
    ? "Observed - execution pending"
    : "Observed - live trading locked";
  const leg = primarySwapLeg(transaction, profile, state);
  const wallet = targetWallet(state, profile);
  const sourceUsd = Number(leg?.sourceUsd || 0);
  const sourceReceivedUsd = leg?.action === "sell" ? Number(receivedUsdFromSignal(transaction, wallet) || 0) : 0;
  const tradedToken = leg?.action === "sell"
    ? (leg?.inputSymbol || leg?.inputMint || tokenName(transaction))
    : (leg?.outputSymbol || leg?.outputMint || tokenName(transaction));
  return {
    id: transaction.signature,
    signature: transaction.signature,
    time: transaction.timestamp ? new Date(transaction.timestamp * 1000).toLocaleString("en-US", { hour12: false }) : new Date().toLocaleString("en-US", { hour12: false }),
    profile: profileLabel(profile),
    action: leg?.action === "sell" ? "Sell signal" : "Buy signal",
    token: tradedToken,
    tradedToken,
    tradedTokenMint: leg?.action === "sell" ? leg?.inputMint : leg?.outputMint,
    amount: tradeAmount(transaction),
    sourceUsd,
    sourceReceivedUsd,
    traderPnlUsd: leg?.action === "buy" ? -Math.abs(sourceUsd) : sourceReceivedUsd,
    pnl: 0,
    status
  };
}

async function fetchTransactionsForAddress(apiKey, address) {
  const url = new URL(`https://api.helius.xyz/v0/addresses/${encodeURIComponent(address)}/transactions`);
  url.searchParams.set("api-key", apiKey);
  url.searchParams.set("limit", "25");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Helius returned ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || payload.error || "Helius transaction lookup failed");
  return Array.isArray(payload) ? payload : [];
}

function signalAgeMs(transaction = {}) {
  if (!transaction.timestamp) return 0;
  return Math.max(0, Date.now() - (Number(transaction.timestamp) * 1000));
}

function freshEnoughToCopy(transaction = {}) {
  const age = signalAgeMs(transaction);
  return !age || age <= maxSignalAgeMs;
}

async function runCopyWorkerOnce() {
  const state = await readState();
  if (state.strategy?.paused) return;
  const activeProfile = state.strategy?.activeProfile === "truenest" ? "truenest" : "frog";
  const runningProfiles = state.profiles?.[activeProfile]?.running ? [activeProfile] : [];
  if (!runningProfiles.length) return;

  if (!state.settings?.heliusKey) {
    state.activity = [line("Copy worker is waiting for Helius API key."), ...(state.activity || [])].slice(0, 20);
    await saveState(state);
    return;
  }

  for (const profile of runningProfiles) {
    const wallet = targetWallet(state, profile);
    if (!wallet) continue;
    const transactions = await fetchTransactionsForAddress(state.settings.heliusKey, wallet);
    const newest = newestSignature(transactions);
    if (!newest) continue;

    if (!state.profiles[profile].lastSignature) {
      state.profiles[profile].lastSignature = newest;
      state.activity = [line(`${profileLabel(profile)} worker synced to latest wallet transaction.`), ...(state.activity || [])].slice(0, 20);
      continue;
    }

    const unseen = [];
    for (const transaction of transactions) {
      if (transaction.signature === state.profiles[profile].lastSignature) break;
      if (transaction.signature) unseen.push(transaction);
    }

    if (!unseen.length) continue;
    const existing = new Set((state.trades || []).map((trade) => trade.signature || trade.id));
    const signalTransactions = unseen
      .reverse()
      .filter((transaction) => !existing.has(transaction.signature) && copyableSignal(profile, transaction, state))
    const newTrades = [];

    if (!signalTransactions.length) {
      const sample = unseen[0] ? movementSummary(unseen[0]) : "wallet movement";
      state.activity = [
        line(`${profileLabel(profile)} saw ${unseen.length} new Decu movement${unseen.length === 1 ? "" : "s"}, but no buy/sell swap was found. Latest was ${sample}; use the exact GMGN trade feed or signer wallet to copy this.`),
        ...(state.activity || [])
      ].slice(0, 20);
    }

    for (const transaction of signalTransactions) {
      const trade = tradeFromTransaction(profile, transaction, state);
      const leg = primarySwapLeg(transaction, profile, state);
      if (liveTradingAllowed(state, profile)) {
        const staleSignal = !freshEnoughToCopy(transaction);
        if (staleSignal && leg?.action !== "sell") {
          const seconds = Math.round(signalAgeMs(transaction) / 1000);
          trade.status = `Skipped - signal was ${seconds}s old`;
        } else try {
          const execution = await executeCopiedSwap(profile, transaction, state);
          trade.status = execution.status;
          trade.execution = execution;
          if (execution.outputSymbol) trade.token = execution.outputSymbol;
          if (execution.swapUsdValue) trade.amount = Number(execution.swapUsdValue);
        } catch (error) {
          trade.status = "Execution failed";
          trade.executionError = error.message;
        }
      }
      newTrades.push(trade);

      if (liveTradingAllowed(state, profile) && leg?.action === "sell") {
        try {
          const stuckSellTrade = await autoSellStuckTokenAfterSellSignal(state, profile, leg, trade);
          if (stuckSellTrade) {
            newTrades.push(stuckSellTrade);
            state.activity = [
              line(`${profileLabel(profile)} auto-sold stuck token ${stuckSellTrade.tradedTokenMint.slice(0, 6)}...${stuckSellTrade.tradedTokenMint.slice(-4)} after Decu sell.`),
              ...(state.activity || [])
            ].slice(0, 20);
          }
        } catch (error) {
          state.activity = [
            line(`${profileLabel(profile)} stuck token auto-sell failed: ${error.message}`),
            ...(state.activity || [])
          ].slice(0, 20);
        }
      }
    }

    state.profiles[profile].lastSignature = newest;
    if (newTrades.length) {
      state.trades = [...newTrades, ...(state.trades || [])].slice(0, 100);
      applyAutoSwitchStrategy(state, newTrades);
      state.activity = [
        line(`${profileLabel(profile)} worker found ${newTrades.length} new swap signal${newTrades.length === 1 ? "" : "s"}${liveTradingAllowed(state, profile) ? " and attempted execution" : ""}.`),
        ...(state.activity || [])
      ].slice(0, 20);
    }
  }

  await saveState(state);
}

function startCopyWorker() {
  let working = false;
  setInterval(async () => {
    if (working) return;
    working = true;
    try {
      await runCopyWorkerOnce();
    } catch (error) {
      const state = await readState();
      state.activity = [line(`Copy worker warning: ${error.message}`), ...(state.activity || [])].slice(0, 20);
      await saveState(state);
    } finally {
      working = false;
    }
  }, workerIntervalMs);
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    send(response, 200, {
      ok: true,
      liveTradingEnv: process.env.ENABLE_LIVE_TRADING === "true",
      productionExecution: process.env.EXECUTE_REAL_SWAPS === "true"
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    const state = await readState();
    const session = sessionFromRequest(request, state);
    if (!session) {
      send(response, 200, { user: null, ownerEmail: state.owner.email });
      return true;
    }
    if (session.role === "owner") {
      send(response, 200, { user: { role: "owner", email: state.owner.email }, ownerEmail: state.owner.email });
      return true;
    }
    const customer = state.customers.find((item) => item.id === session.id);
    send(response, 200, { user: customer ? { role: "customer", ...customerPublic(customer, state) } : null, ownerEmail: state.owner.email });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/owner") {
    const state = await readState();
    const body = await readBody(request);
    const email = normalizeEmail(body.email);
    if (email !== state.owner.email) {
      send(response, 403, { error: "That email is not the owner email." });
      return true;
    }
    const token = createSession(state, "owner", "owner");
    state.activity = [line("Owner logged into the business control panel."), ...(state.activity || [])].slice(0, 20);
    await saveState(state);
    send(response, 200, { user: { role: "owner", email: state.owner.email } }, { "Set-Cookie": cookieFor(token) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/signup") {
    const state = await readState();
    const body = await readBody(request);
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    if (!email.includes("@") || password.length < 6) {
      send(response, 400, { error: "Use a valid email and a password with at least 6 characters." });
      return true;
    }
    const existingCustomer = state.customers.find((customer) => customer.email === email);
    if (email === state.owner.email || (existingCustomer && existingCustomer.passwordHash)) {
      send(response, 409, { error: "This email already has an account." });
      return true;
    }
    const referralToken = String(body.referralToken || "").trim();
    const referrer = referralToken
      ? state.customers.find((item) => item.referralToken === referralToken && item.status !== "paused")
      : null;
    const customer = existingCustomer || {
      id: randomUUID(),
      accessToken: randomUUID(),
      referralToken: randomUUID(),
      email,
      plan: "frog",
      status: "active",
      deposited: 0,
      profit: 0,
      withdrawn: 0,
      createdAt: new Date().toISOString()
    };
    if (referrer && referrer.id !== customer.id && !customer.referredBy) {
      customer.referredBy = referrer.id;
    }
    customer.name = String(body.name || customer.name || email.split("@")[0]).trim().slice(0, 80);
    customer.passwordHash = makePasswordHash(password);
    if (!existingCustomer) state.customers.push(customer);
    const token = createSession(state, "customer", customer.id);
    state.activity = [
      line(referrer ? `Customer account created for ${email} from ${referrer.name || referrer.email || "a customer"} referral.` : `Customer account created for ${email}.`),
      ...(state.activity || [])
    ].slice(0, 20);
    await saveState(state);
    send(response, 200, { user: { role: "customer", ...customerPublic(customer, state) } }, { "Set-Cookie": cookieFor(token) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    const state = await readState();
    const body = await readBody(request);
    const email = normalizeEmail(body.email);
    const customer = state.customers.find((item) => item.email === email);
    if (!customer || !checkPassword(body.password || "", customer.passwordHash)) {
      send(response, 403, { error: "Email or password is not correct." });
      return true;
    }
    const token = createSession(state, "customer", customer.id);
    await saveState(state);
    send(response, 200, { user: { role: "customer", ...customerPublic(customer, state) } }, { "Set-Cookie": cookieFor(token) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    const state = await readState();
    const session = sessionFromRequest(request, state);
    if (session?.token) delete state.sessions[session.token];
    await saveState(state);
    send(response, 200, { ok: true }, { "Set-Cookie": clearCookie() });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/status") {
    const state = await readState();
    const payload = statusPayload(state, sessionFromRequest(request, state));
    payload.walletBalances = await walletBalances(state).catch((error) => ({
      error: error.message || "Balance check failed"
    }));
    send(response, 200, payload);
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/business") {
    const state = await readState();
    const session = sessionFromRequest(request, state);
    if (session?.role === "owner") {
      send(response, 200, {
        role: "owner",
        owner: state.owner,
        summary: businessSummary(state),
        customers: state.customers.map((customer) => customerPublic(customer, state)),
        deposits: state.deposits,
        withdrawals: state.withdrawals
      });
      return true;
    }
    if (session?.role === "customer") {
      const customer = state.customers.find((item) => item.id === session.id);
      send(response, 200, { role: "customer", customer: customer ? customerPublic(customer, state) : null });
      return true;
    }
    send(response, 401, { error: "Login required." });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/settings") {
    const state = await readState();
    if (requireOwner(response, sessionFromRequest(request, state))) return true;
    state.settings = { ...state.settings, ...clean(await readBody(request)) };
    state.activity = [line("Engine Room saved."), ...(state.activity || [])].slice(0, 20);
    await saveState(state);
    send(response, 200, statusPayload(state, { role: "owner", id: "owner" }));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/owner/customer") {
    const state = await readState();
    if (requireOwner(response, sessionFromRequest(request, state))) return true;
    const body = await readBody(request);
    const email = normalizeEmail(body.email);
    const phone = String(body.phone || "").trim().slice(0, 40);
    const name = String(body.name || email || phone || "Customer").trim().slice(0, 80);
    if (!name || name === "Customer") {
      send(response, 400, { error: "Customer name or phone is required." });
      return true;
    }
    let customer = email.includes("@")
      ? state.customers.find((item) => item.email === email)
      : state.customers.find((item) => item.phone && item.phone === phone);
    if (!customer) {
      customer = {
        id: randomUUID(),
        accessToken: randomUUID(),
        referralToken: randomUUID(),
        name,
        email: email.includes("@") ? email : "",
        phone,
        passwordHash: body.password ? makePasswordHash(body.password) : "",
        plan: body.plan === "truenest" || body.plan === "both" ? body.plan : "frog",
        status: "active",
        deposited: Number(body.deposited || 0),
        profit: Number(body.profit || 0),
        withdrawn: 0,
        createdAt: new Date().toISOString()
      };
      state.customers.push(customer);
    } else {
      customer.name = name || customer.name;
      customer.phone = phone || customer.phone || "";
      if (email.includes("@")) customer.email = email;
      customer.plan = body.plan === "truenest" || body.plan === "both" ? body.plan : "frog";
      customer.deposited = Number(body.deposited || customer.deposited || 0);
      customer.profit = Number(body.profit || customer.profit || 0);
    }
    state.activity = [line(`Owner printed customer link for ${customer.name}.`), ...(state.activity || [])].slice(0, 20);
    await saveState(state);
    send(response, 200, {
      summary: businessSummary(state),
      customers: state.customers.map((item) => customerPublic(item, state)),
      customer: customerPublic(customer, state)
    });
    return true;
  }

  const ownerCustomerMatch = url.pathname.match(/^\/api\/owner\/customer\/([^/]+)$/);
  if (request.method === "POST" && ownerCustomerMatch) {
    const state = await readState();
    if (requireOwner(response, sessionFromRequest(request, state))) return true;
    const customer = state.customers.find((item) => item.id === ownerCustomerMatch[1]);
    if (!customer) {
      send(response, 404, { error: "Customer not found." });
      return true;
    }
    const body = await readBody(request);
    if (body.plan === "frog" || body.plan === "truenest" || body.plan === "both") customer.plan = body.plan;
    if (body.status === "active" || body.status === "paused") customer.status = body.status;
    if (body.deposited !== undefined) customer.deposited = Number(body.deposited || 0);
    if (body.profit !== undefined) customer.profit = Number(body.profit || 0);
    if (body.withdrawn !== undefined) customer.withdrawn = Number(body.withdrawn || 0);
    await saveState(state);
    send(response, 200, { summary: businessSummary(state), customers: state.customers.map((item) => customerPublic(item, state)) });
    return true;
  }

  const customerReferralLinkMatch = url.pathname.match(/^\/api\/customer\/link\/([^/]+)\/referral$/);
  if (request.method === "POST" && customerReferralLinkMatch) {
    const state = await readState();
    const customer = state.customers.find((item) => item.accessToken === customerReferralLinkMatch[1]);
    if (!customer || customer.status === "paused") {
      send(response, 404, { error: "Customer link is not active." });
      return true;
    }
    if (!customer.referralToken) customer.referralToken = randomUUID();
    state.activity = [line(`${customer.name || customer.email || "Customer"} created a referral link.`), ...(state.activity || [])].slice(0, 20);
    await saveState(state);
    send(response, 200, { customer: customerPublic(customer, state) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/customer/referral") {
    const state = await readState();
    const session = sessionFromRequest(request, state);
    if (session?.role !== "customer") {
      send(response, 401, { error: "Customer login required." });
      return true;
    }
    const customer = state.customers.find((item) => item.id === session.id);
    if (!customer || customer.status === "paused") {
      send(response, 404, { error: "Customer account is not active." });
      return true;
    }
    if (!customer.referralToken) customer.referralToken = randomUUID();
    state.activity = [line(`${customer.name || customer.email || "Customer"} created a referral link.`), ...(state.activity || [])].slice(0, 20);
    await saveState(state);
    send(response, 200, { customer: customerPublic(customer, state) });
    return true;
  }

  const customerLinkMatch = url.pathname.match(/^\/api\/customer\/link\/([^/]+)(?:\/(plan|withdraw))?$/);
  if (customerLinkMatch) {
    const state = await readState();
    const customer = state.customers.find((item) => item.accessToken === customerLinkMatch[1]);
    if (!customer || customer.status === "paused") {
      send(response, 404, { error: "Customer link is not active." });
      return true;
    }

    const action = customerLinkMatch[2] || "";
    if (request.method === "GET" && !action) {
      send(response, 200, { customer: customerPublic(customer, state) });
      return true;
    }

    if (request.method === "POST" && action === "plan") {
      const body = await readBody(request);
      if (body.plan === "frog" || body.plan === "truenest" || body.plan === "both") customer.plan = body.plan;
      await saveState(state);
      send(response, 200, { customer: customerPublic(customer, state) });
      return true;
    }

    if (request.method === "POST" && action === "withdraw") {
      const body = await readBody(request);
      const amount = Number(body.amount || 0);
      const wallet = String(body.wallet || "").trim();
      const available = customerPublic(customer, state).withdrawable;
      if (!amount || amount <= 0 || amount > available || !wallet) {
        send(response, 400, { error: "Enter a wallet and an amount inside your withdrawable balance." });
        return true;
      }
      state.withdrawals.push({
        id: randomUUID(),
        customerId: customer.id,
        customerEmail: customer.email || "",
        customerName: customer.name || "",
        amount,
        wallet,
        status: "pending",
        createdAt: new Date().toISOString()
      });
      await saveState(state);
      send(response, 200, { customer: customerPublic(customer, state), withdrawals: state.withdrawals.filter((item) => item.customerId === customer.id) });
      return true;
    }
  }

  if (request.method === "POST" && url.pathname === "/api/customer/plan") {
    const state = await readState();
    const session = sessionFromRequest(request, state);
    if (session?.role !== "customer") {
      send(response, 401, { error: "Customer login required." });
      return true;
    }
    const customer = state.customers.find((item) => item.id === session.id);
    const body = await readBody(request);
    if (customer && (body.plan === "frog" || body.plan === "truenest" || body.plan === "both")) customer.plan = body.plan;
    await saveState(state);
    send(response, 200, { customer: customer ? customerPublic(customer, state) : null });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/customer/withdraw") {
    const state = await readState();
    const session = sessionFromRequest(request, state);
    if (session?.role !== "customer") {
      send(response, 401, { error: "Customer login required." });
      return true;
    }
    const customer = state.customers.find((item) => item.id === session.id);
    if (!customer) {
      send(response, 404, { error: "Customer not found." });
      return true;
    }
    const body = await readBody(request);
    const amount = Number(body.amount || 0);
    const wallet = String(body.wallet || "").trim();
    const available = customerPublic(customer, state).withdrawable;
    if (!amount || amount <= 0 || amount > available || !wallet) {
      send(response, 400, { error: "Enter a wallet and an amount inside your withdrawable balance." });
      return true;
    }
    state.withdrawals.push({
      id: randomUUID(),
      customerId: customer.id,
      customerEmail: customer.email,
      amount,
      wallet,
      status: "pending",
      createdAt: new Date().toISOString()
    });
    await saveState(state);
    send(response, 200, { customer: customerPublic(customer, state), withdrawals: state.withdrawals.filter((item) => item.customerId === customer.id) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/owner/withdraw") {
    const state = await readState();
    if (requireOwner(response, sessionFromRequest(request, state))) return true;
    const body = await readBody(request);
    const profile = body.profile === "truenest" ? "truenest" : "frog";
    const destination = String(body.wallet || "").trim();
    const amountSol = Number(body.amountSol || body.amount || 0);
    const amountUsd = Number(body.amountUsd || 0);
    const asset = String(body.asset || "SOL").toUpperCase();
    const profitOnly = body.profitOnly === true || body.mode === "profit";

    try {
      const result = asset === "USDC"
        ? await executeUsdcWithdrawal(state, { profile, destination, amountUsd, profitOnly })
        : await executeSolWithdrawal(state, { profile, destination, amountSol });
      state.withdrawals.push({
        id: randomUUID(),
        owner: true,
        profile,
        amount: asset === "USDC" ? result.amountUsd : result.amountSol,
        asset,
        profitOnly,
        sourceWallet: result.sourceWallet,
        wallet: result.destination,
        txid: result.signature,
        status: "sent",
        createdAt: new Date().toISOString()
      });
      state.activity = [
        line(`${profileLabel(profile)} ${profitOnly ? "profit " : ""}withdrawal sent: ${asset === "USDC" ? `$${result.amountUsd} USDC` : `${result.amountSol} SOL`} to ${result.destination.slice(0, 6)}...${result.destination.slice(-4)}.`),
        ...(state.activity || [])
      ].slice(0, 20);
      await saveState(state);
      send(response, 200, { withdrawal: result, status: statusPayload(state, { role: "owner", id: "owner" }) });
    } catch (error) {
      state.withdrawals.push({
        id: randomUUID(),
        owner: true,
        profile,
        amount: asset === "USDC" ? amountUsd : amountSol,
        asset,
        profitOnly,
        wallet: destination,
        status: "failed",
        error: error.message,
        createdAt: new Date().toISOString()
      });
      state.activity = [
        line(`${profileLabel(profile)} withdrawal failed: ${error.message}`),
        ...(state.activity || [])
      ].slice(0, 20);
      await saveState(state);
      send(response, 400, { error: error.message, status: statusPayload(state, { role: "owner", id: "owner" }) });
    }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/owner/sell-token") {
    const state = await readState();
    if (requireOwner(response, sessionFromRequest(request, state))) return true;
    const body = await readBody(request);
    const profile = body.profile === "truenest" ? "truenest" : "frog";
    const mint = String(body.mint || "").trim();

    try {
      const result = await executeManualTokenSell(state, { profile, mint });
      const trade = {
        id: result.txid || randomUUID(),
        signature: result.txid || "",
        time: new Date().toLocaleString("en-US", { hour12: false }),
        profile: profileLabel(profile),
        action: "Manual sell",
        token: result.inputMint,
        tradedToken: result.inputMint,
        tradedTokenMint: result.inputMint,
        amount: Number(result.swapUsdValue || 0),
        sourceUsd: 0,
        sourceReceivedUsd: Number(result.swapUsdValue || 0),
        traderPnlUsd: 0,
        pnl: 0,
        status: "Executed",
        execution: result
      };
      state.trades = [trade, ...(state.trades || [])].slice(0, 80);
      state.activity = [
        line(`${profileLabel(profile)} manual sell sent ${result.inputMint.slice(0, 6)}...${result.inputMint.slice(-4)} to USDC. SOL gas was left in the wallet.`),
        ...(state.activity || [])
      ].slice(0, 20);
      await saveState(state);
      send(response, 200, { trade, status: statusPayload(state, { role: "owner", id: "owner" }) });
    } catch (error) {
      state.activity = [
        line(`${profileLabel(profile)} manual sell failed: ${error.message}`),
        ...(state.activity || [])
      ].slice(0, 20);
      await saveState(state);
      send(response, 400, { error: error.message, status: statusPayload(state, { role: "owner", id: "owner" }) });
    }
    return true;
  }

  const startMatch = url.pathname.match(/^\/api\/start\/(frog|truenest)$/);
  if (request.method === "POST" && startMatch) {
    const state = await readState();
    if (requireOwner(response, sessionFromRequest(request, state))) return true;
    if (!ready(state)) {
      send(response, 400, { error: "Engine Room is not complete yet." });
      return true;
    }
    const profile = startMatch[1];
    state.strategy = { ...structuredClone(defaultState.strategy), ...(state.strategy || {}) };
    state.strategy.activeProfile = profile;
    state.strategy.paused = false;
    state.strategy.pauseReason = "";
    state.strategy.frogLosses = profile === "frog" ? 0 : Number(state.strategy.frogLosses || 0);
    state.strategy.truenestLosses = profile === "truenest" ? 0 : 0;
    state.strategy.processedClosedTrades = [];
    for (const item of ["frog", "truenest"]) {
      state.profiles[item].running = item === profile;
    }
    state.profiles[profile].running = true;
    state.profiles[profile].lastAction = new Date().toISOString();
    state.activity = [
      line(`${profileLabel(profile)} started in one-chart auto switch mode.`),
      line(liveTradingAllowed(state, profile)
        ? "Production execution is enabled. Copy worker can execute with the connected signer."
        : "Monitoring is active. Real swap execution stays locked until EXECUTE_REAL_SWAPS=true is set in Render."),
      ...(state.activity || [])
    ].slice(0, 20);
    await saveState(state);
    send(response, 200, statusPayload(state, { role: "owner", id: "owner" }));
    return true;
  }

  const stopMatch = url.pathname.match(/^\/api\/stop\/(frog|truenest)$/);
  if (request.method === "POST" && stopMatch) {
    const state = await readState();
    if (requireOwner(response, sessionFromRequest(request, state))) return true;
    const profile = stopMatch[1];
    state.profiles[profile].running = false;
    state.profiles[profile].lastAction = new Date().toISOString();
    if (!state.profiles.frog.running && !state.profiles.truenest.running) {
      state.strategy = { ...structuredClone(defaultState.strategy), ...(state.strategy || {}) };
      state.strategy.paused = false;
      state.strategy.pauseReason = "";
    }
    state.activity = [
      line(`${profileLabel(profile)} stopped.`),
      ...(state.activity || [])
    ].slice(0, 20);
    await saveState(state);
    send(response, 200, statusPayload(state, { role: "owner", id: "owner" }));
    return true;
  }

  return false;
}

function serveFile(response, pathname) {
  const safePath = pathname === "/" || pathname === "/control-panel"
    ? "/control-panel.html"
    : pathname.startsWith("/player/")
      ? "/index.html"
      : pathname;
  const filePath = path.normalize(path.join(__dirname, safePath));
  const relativePath = path.relative(__dirname, filePath);
  const hiddenSegment = relativePath.split(path.sep).some((segment) => segment.startsWith("."));
  if (!filePath.startsWith(__dirname) || hiddenSegment) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  const stream = createReadStream(filePath);
  stream.on("error", () => {
    createReadStream(path.join(__dirname, "index.html")).pipe(response);
  });
  response.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream" });
  stream.pipe(response);
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname.startsWith("/api/") && await handleApi(request, response, url)) return;
    serveFile(response, url.pathname);
  } catch (error) {
    send(response, 500, { error: error.message });
  }
}).listen(port, host, () => {
  console.log(`SignalPilot site running on ${host}:${port}`);
  startCopyWorker();
});
