import { createTradingJournal } from "./lib/trading-journal.mjs";
import { sellFraction, proportionalAmount, exitReason, trailingExit, takeBackExit, tokenAmounts, buildPositions, dailyResults } from "./lib/position-accounting.mjs";
import { decodeDirectSwap, canonicalSignalId } from "./lib/direct-signals.mjs";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Turnkey } from "@turnkey/sdk-server";
import {
  VersionedTransaction,
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
const profitReserveFile = path.join(dataDir, "profit-reserves.json");
let profitReserves;
const walletJobs = [];
let walletBusy = false;
async function drainWalletJobs() {
  if (walletBusy) return;
  walletBusy = true;
  try {
    while (walletJobs.length) {
      walletJobs.sort((a,b) => b.priority - a.priority);
      const job = walletJobs.shift();
      try { job.resolve(await job.action()); } catch (error) { job.reject(error); }
    }
  } finally { walletBusy = false; }
}

function withWalletOperation(action, priority = 0) {
  return new Promise((resolve, reject) => {
    walletJobs.push({ action, priority, resolve, reject });
    drainWalletJobs();
  });
}

async function readProfitReserves() {
  if (!profitReserves) {
    profitReserves = (async () => {
      try {
        return JSON.parse(await readFile(profitReserveFile, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        return {};
      }
    })();
  }
  return profitReserves;
}

async function saveProfitReserves() {
  const reserves = await readProfitReserves();
  await mkdir(dataDir, { recursive: true });
  await writeFile(`${profitReserveFile}.tmp`, JSON.stringify(reserves));
  await rename(`${profitReserveFile}.tmp`, profitReserveFile);
}

async function protectProfit(state, wallet, cash) {
  const reserves = await readProfitReserves();
  if (!Number.isFinite(cash) || cash < 0) throw new Error("Cannot verify cash for profit protection");
  const prior = reserves[wallet];
  // Restore this owner's previously displayed reserve once, on ledger migration.
  const initial = wallet === "12HrFUw9v7em5ZQ1c3jcAFcSrfXSxqhHLqv1mSCbRprb" ? 35.327375 : 0;
  const principal = profileDepositUsd(state, "frog");
  const locked = Math.max(prior?.lockedUsd ?? initial, principal > 0 ? cash - principal : 0);
  if (!prior || locked !== prior.lockedUsd) {
    reserves[wallet] = { ...prior, lockedUsd: locked, updatedAt: new Date().toISOString(), history: [...(prior?.history || []), ...(prior && locked > prior.lockedUsd ? [{time:new Date().toISOString(),added:locked-prior.lockedUsd,total:locked}] : [])] };
    await saveProfitReserves();
  }
  state.profitReserves = reserves;
  return locked;
}
const workerIntervalMs = Number(process.env.WORKER_INTERVAL_MS || 500);
const maxSignalAgeMs = Number(process.env.MAX_SIGNAL_AGE_MS || 5000);
const ownerEmail = (process.env.OWNER_EMAIL || "ebubedikellc@gmail.com").toLowerCase();
const sessionMaxAge = 60 * 60 * 24 * 30;
const solMint = "So11111111111111111111111111111111111111112";
const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const usdtMint = "Es9vMFrzaCERmJfrF4H2FYD4AWuEJ1hDPPpQdjCXg82h";
const legacyFrogWallet = "4DdrfiDHpmx55i4SPssxVzS9ZaKLb8qr45NKY9Er9nNh";
const decuWallet = "4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9";
const supportedProfiles = ["safe", "frog", "truenest"];
const protectedCapStrategyVersion = "decu-50-cap-v1";
const surviveBuyUsd = 5;
const defaultBuyMode = "limits";
const gmgnPollMs = Number(process.env.GMGN_POLL_MS || 2000);
const usdcDecimals = 6;
const tokenProgramId = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const associatedTokenProgramId = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const executionJournal = createTradingJournal(path.join(dataDir, "execution-journal.json"), usdcMint);
let executionReport = null;
let emergencyStopRequested = false;

const defaultState = {
  settings: {
    gmgnApiKey: "",
    safeWallet: legacyFrogWallet,
    safeMax: "50",
    safeMode: "Copy exact amount after safety check",
    safeCopySizing: "Copy exact amount",
    safeTraderBankroll: "500",
    safeUseProfit: "off",
    safeTradeMode: "both",
    safeSurviveMode: "off",
    safeBuyMode: defaultBuyMode,
    safeSurviveMax: "5",
    frogWallet: decuWallet,
    frogMax: "50",
    frogMode: "Copy exact amount after safety check",
    frogCopySizing: "Copy exact amount",
    frogTraderBankroll: "500",
    frogUseProfit: "off",
    frogTradeMode: "both",
    frogSurviveMode: "off",
    frogBuyMode: defaultBuyMode,
    frogSurviveMax: "5",
    truenestWallet: "ardinRsN1mNYVeoJWTBsWeYeXvuR9UUDGMsCDKpb6AT",
    truenestMax: "50",
    truenestMode: "Copy exact amount after safety check",
    truenestCopySizing: "Copy exact amount",
    truenestTraderBankroll: "500",
    truenestUseProfit: "off",
    truenestTradeMode: "both",
    truenestSurviveMode: "off",
    truenestBuyMode: defaultBuyMode,
    truenestSurviveMax: "5",
    trailingStopPercent: "10",
    queueFailureSwitchLimit: "3",
    walletSync: "Turnkey server wallet",
    riskControl: "on",
    liveTradingSwitch: "on",
    frogWalletSync: "Turnkey server wallet",
    frogRiskControl: "on",
    frogLiveTradingSwitch: "on",
    safeWalletSync: "Turnkey server wallet",
    safeRiskControl: "on",
    safeLiveTradingSwitch: "on",
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
    safe: { running: false, profit: 0, lastAction: null, lastSignature: null, lastGmgnSignature: null, lastGmgnWarningAt: null, lastNoSignalAt: null },
    frog: { running: false, profit: 0, lastAction: null, lastSignature: null, lastGmgnSignature: null, lastGmgnWarningAt: null, lastNoSignalAt: null },
    truenest: { running: false, profit: 0, lastAction: null, lastSignature: null, lastGmgnSignature: null, lastGmgnWarningAt: null, lastNoSignalAt: null }
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
    safeLosses: 0,
    frogLosses: 0,
    truenestLosses: 0,
    paused: false,
    pauseReason: "",
    processedClosedTrades: [],
    processedSwitchFailures: [],
    processedStockAutoSells: []
  },
  trades: []
};

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
  "trailingStopPercent",
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

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
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

let stateSaveQueue = Promise.resolve();
function saveState(state) {
  const result = stateSaveQueue.then(() => saveStateSerialized(state));
  stateSaveQueue = result.catch(() => {});
  return result;
}

async function saveStateSerialized(state) {
  // Owner control changes win over a worker snapshot taken before the click.
  try {
    const saved = JSON.parse(await readFile(dataFile, "utf8"));
    if (Number(saved.strategy?.controlRevision || 0) > Number(state.strategy?.controlRevision || 0)) {
      state.strategy = saved.strategy;
      state.settings = saved.settings;
      for (const profile of supportedProfiles) {
        state.profiles[profile].running = saved.profiles[profile].running;
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(dataDir, { recursive: true });
  await writeFile(`${dataFile}.tmp`, JSON.stringify(state, null, 2));
  await rename(`${dataFile}.tmp`, dataFile);
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

function syncQueueSurviveSettings(settings = {}) {
  if (!settings.safeBuyMode) settings.safeBuyMode = settings.safeSurviveMode === "on" ? "survive" : settings.frogBuyMode || defaultBuyMode;
  if (!settings.frogBuyMode) settings.frogBuyMode = settings.frogSurviveMode === "on" ? "survive" : defaultBuyMode;
  if (!settings.truenestBuyMode) settings.truenestBuyMode = settings.truenestSurviveMode === "on" ? "survive" : settings.frogBuyMode;
  const queueMode = normalizeBuyMode(settings.frogBuyMode || settings.truenestBuyMode || settings.safeBuyMode);
  settings.safeBuyMode = queueMode;
  settings.frogBuyMode = queueMode;
  settings.truenestBuyMode = queueMode;
  settings.safeSurviveMode = queueMode === "survive" ? "on" : "off";
  settings.frogSurviveMode = queueMode === "survive" ? "on" : "off";
  settings.truenestSurviveMode = queueMode === "survive" ? "on" : "off";
  settings.safeSurviveMax = normalizeUsdSetting(settings.safeSurviveMax || settings.frogSurviveMax, settings.frogSurviveMax || "5");
  settings.frogSurviveMax = normalizeUsdSetting(settings.frogSurviveMax, "5");
  settings.truenestSurviveMax = normalizeUsdSetting(settings.truenestSurviveMax || settings.frogSurviveMax, settings.frogSurviveMax || "5");
  settings.queueFailureSwitchLimit = normalizeWholeNumberSetting(settings.queueFailureSwitchLimit, "3");
}

function normalizeBuyMode(mode) {
  if (mode === "takeback") return "takeback";
  if (mode === "trailing") return "trailing";
  if (mode === "exact") return "exact";
  if (mode === "loss") return "loss";
  return "limits";
}

function normalizeUsdSetting(value, fallback) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? String(amount) : String(fallback);
}

function normalizeWholeNumberSetting(value, fallback) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? String(Math.floor(amount)) : String(fallback);
}

function isLegacyUnsupportedSwapSkip(trade = {}) {
  return String(trade.status || "") === "Skipped - unsupported swap format";
}

function normalizeState(state) {
  state.settings ||= {};
  for (const profile of ["safe", "frog", "truenest"]) state.settings[`${profile}UseProfit`] = "off";
  const incomingSettings = state.settings || {};
  state.settings = { ...defaultState.settings, ...incomingSettings };
  if (incomingSettings.protectedCapStrategyVersion !== protectedCapStrategyVersion) {
    if (!state.settings.frogWallet || state.settings.frogWallet === legacyFrogWallet) {
      state.settings.frogWallet = decuWallet;
    }
    state.settings.frogMax = "50";
    state.settings.safeMax = "50";
    state.settings.truenestMax = "50";
    state.settings.frogMode = "Copy exact amount after safety check";
    state.settings.safeMode = "Copy exact amount after safety check";
    state.settings.truenestMode = "Copy exact amount after safety check";
    state.settings.frogCopySizing = "Copy exact amount";
    state.settings.safeCopySizing = "Copy exact amount";
    state.settings.truenestCopySizing = "Copy exact amount";
    state.settings.frogTraderBankroll ||= "500";
    state.settings.safeTraderBankroll ||= "500";
    state.settings.truenestTraderBankroll ||= "500";
    state.settings.frogRiskControl = "on";
    state.settings.safeRiskControl = "on";
    state.settings.truenestRiskControl = "on";
    state.settings.protectedCapStrategyVersion = protectedCapStrategyVersion;
  }
  state.settings.safeWallet ||= legacyFrogWallet;
  state.settings.safeMode = normalizeCopyMode(state.settings.safeMode);
  state.settings.frogMode = normalizeCopyMode(state.settings.frogMode);
  state.settings.truenestMode = normalizeCopyMode(state.settings.truenestMode);
  state.settings.safeWalletSync ||= state.settings.walletSync || defaultState.settings.walletSync;
  state.settings.safeRiskControl ||= state.settings.riskControl || defaultState.settings.riskControl;
  state.settings.safeLiveTradingSwitch ||= state.settings.liveTradingSwitch || defaultState.settings.liveTradingSwitch;
  state.settings.frogWalletSync ||= state.settings.walletSync || defaultState.settings.walletSync;
  state.settings.frogRiskControl ||= state.settings.riskControl || defaultState.settings.riskControl;
  state.settings.frogLiveTradingSwitch ||= state.settings.liveTradingSwitch || defaultState.settings.liveTradingSwitch;
  state.settings.truenestWalletSync ||= state.settings.walletSync || defaultState.settings.walletSync;
  state.settings.truenestRiskControl ||= state.settings.riskControl || defaultState.settings.riskControl;
  state.settings.truenestLiveTradingSwitch ||= state.settings.liveTradingSwitch || defaultState.settings.liveTradingSwitch;
  syncQueueSurviveSettings(state.settings);
  const incomingProfiles = state.profiles || {};
  state.profiles = {
    safe: { ...structuredClone(defaultState.profiles.safe), ...(incomingProfiles.safe || {}) },
    frog: { ...structuredClone(defaultState.profiles.frog), ...(incomingProfiles.frog || {}) },
    truenest: { ...structuredClone(defaultState.profiles.truenest), ...(incomingProfiles.truenest || {}) }
  };
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
  state.strategy.activeProfile = supportedProfiles.includes(state.strategy.activeProfile) ? state.strategy.activeProfile : "frog";
  // Owner requested GMGN takeover with an explicit repair hold. No auto-resume.
  state.settings.marketDataProvider = "gmgn";
  state.settings.providerRepairHold = true;
  for (const profile of supportedProfiles) state.profiles[profile].running = false;
  if (state.settings.manualModesVersion !== "v1") {
    for (const profile of supportedProfiles) state.profiles[profile].running = false;
    for (const profile of supportedProfiles) state.settings[`${profile}TradeMode`] = "both";
    state.settings.manualModesVersion = "v1";
    state.settings.modesConfirmed = "no";
    state.strategy.paused = false;
    state.strategy.pauseReason = "";
  }

  state.strategy.safeLosses = Math.max(0, Number(state.strategy.safeLosses || 0));
  state.strategy.frogLosses = Math.max(0, Number(state.strategy.frogLosses || 0));
  state.strategy.truenestLosses = Math.max(0, Number(state.strategy.truenestLosses || 0));
  state.strategy.paused = state.strategy.paused === true;
  state.strategy.autoSwitch = false;
  state.strategy.exhaustedProfiles = (state.strategy.exhaustedProfiles || []).filter((profile) => supportedProfiles.includes(profile));
  state.strategy.processedClosedTrades = Array.isArray(state.strategy.processedClosedTrades)
    ? state.strategy.processedClosedTrades.slice(0, 50)
    : [];
  state.strategy.processedSwitchFailures = Array.isArray(state.strategy.processedSwitchFailures)
    ? state.strategy.processedSwitchFailures.slice(0, 80)
    : [];
  state.strategy.processedStockAutoSells = Array.isArray(state.strategy.processedStockAutoSells)
    ? state.strategy.processedStockAutoSells.slice(0, 80)
    : [];
  state.trades = Array.isArray(state.trades)
    ? state.trades.filter((trade) => !isLegacyUnsupportedSwapSkip(trade)).slice(0, 100)
    : [];
  return state;
}

function normalizeCopyMode(mode) {
  const value = String(mode || "Copy exact amount").toLowerCase();
  if (value.includes("safety") || value.includes("protect")) return "Copy exact amount after safety check";
  return "Copy exact amount";
}

function normalizeCopySizing(value) {
  return "Copy exact amount";
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
    safeWallet: settings.safeWallet || "",
    frogTradeWallet: settings.frogTradeWallet || "",
    truenestTradeWallet: settings.truenestTradeWallet || "",
    frogWallet: settings.frogWallet || "",
    truenestWallet: settings.truenestWallet || "",
    frogDeposit: settings.frogDeposit || "",
    truenestDeposit: settings.truenestDeposit || "",
    safeMax: settings.safeMax || "",
    frogMax: settings.frogMax || "",
    truenestMax: settings.truenestMax || "",
    safeMode: normalizeCopyMode(settings.safeMode),
    frogMode: normalizeCopyMode(settings.frogMode),
    truenestMode: normalizeCopyMode(settings.truenestMode),
    safeCopySizing: normalizeCopySizing(settings.safeCopySizing),
    frogCopySizing: normalizeCopySizing(settings.frogCopySizing),
    truenestCopySizing: normalizeCopySizing(settings.truenestCopySizing),
    safeTraderBankroll: settings.safeTraderBankroll || "",
    frogTraderBankroll: settings.frogTraderBankroll || "",
    truenestTraderBankroll: settings.truenestTraderBankroll || "",
    safeUseProfit: settings.safeUseProfit === "on" ? "on" : "off",
    frogUseProfit: settings.frogUseProfit === "on" ? "on" : "off",
    truenestUseProfit: settings.truenestUseProfit === "on" ? "on" : "off",
    safeTradeMode: settings.safeTradeMode === "sellOnly" ? "sellOnly" : "both",
    frogTradeMode: settings.frogTradeMode === "sellOnly" ? "sellOnly" : "both",
    truenestTradeMode: settings.truenestTradeMode === "sellOnly" ? "sellOnly" : "both",
    safeSurviveMode: settings.safeSurviveMode === "on" ? "on" : "off",
    frogSurviveMode: settings.frogSurviveMode === "on" ? "on" : "off",
    truenestSurviveMode: settings.truenestSurviveMode === "on" ? "on" : "off",
    trailingStopPercent: settings.trailingStopPercent || "10",
    safeBuyMode: normalizeBuyMode(settings.safeBuyMode),
    frogBuyMode: normalizeBuyMode(settings.frogBuyMode),
    truenestBuyMode: normalizeBuyMode(settings.truenestBuyMode),
    safeSurviveMax: normalizeUsdSetting(settings.safeSurviveMax, settings.frogSurviveMax || "5"),
    frogSurviveMax: normalizeUsdSetting(settings.frogSurviveMax, "5"),
    truenestSurviveMax: normalizeUsdSetting(settings.truenestSurviveMax, settings.frogSurviveMax || "5"),
    queueFailureSwitchLimit: normalizeWholeNumberSetting(settings.queueFailureSwitchLimit, "3"),
    walletSync: settings.walletSync || "Turnkey server wallet",
    riskControl: settings.riskControl || "on",
    liveTradingSwitch: settings.liveTradingSwitch || "on",
    frogWalletSync: settings.frogWalletSync || settings.walletSync || "Turnkey server wallet",
    frogRiskControl: settings.frogRiskControl || settings.riskControl || "on",
    frogLiveTradingSwitch: settings.frogLiveTradingSwitch || settings.liveTradingSwitch || "on",
    safeWalletSync: settings.safeWalletSync || settings.walletSync || "Turnkey server wallet",
    safeRiskControl: settings.safeRiskControl || settings.riskControl || "on",
    safeLiveTradingSwitch: settings.safeLiveTradingSwitch || settings.liveTradingSwitch || "on",
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
    trades: (state.trades || []).map(t => {
      const fill=executionReport?.confirmed?.find(f=>f.txid===t.execution?.txid);
      return fill ? {...t,status:"Executed",pnl:fill.pnl ?? 0,amount:fill.usd,execution:{...t.execution,status:"Executed",confirmedAt:new Date(fill.time).toISOString()}} : t;
    }),
    executionReport: isOwner ? executionReport : undefined,
    sessions: undefined,
    customers: isOwner ? state.customers.map((customer) => customerPublic(customer, state)) : [],
    backend: {
      appVersion: "gmgn-primary-repair-hold-v1",
      marketDataProvider: "GMGN",
      walletVerificationProvider: "Public Solana RPC",
      paidHeliusEnabled: false,
      providerRepairHold: true,
      liveTrading: productionExecution,
      liveTradingEnv,
      productionExecution,
      workerIntervalMs,
      maxSignalAgeMs: null,
      pollIntervalMs: 500,
      observationUntil: observationUntil > Date.now() ? new Date(observationUntil).toISOString() : null,
      feeds: feedHealth(),
      liveNotifications: Array.from(liveSubscriptions, ([wallet, sub]) => ({ wallet, lastNotificationAt: sub.lastNotificationAt, status: sub.lastNotificationAt ? "Notification received" : "Registered; awaiting notification" }))
    },
    auth: session ? { role: session.role, id: session.id } : null
  };
}

async function walletBalances(state) {
  const primaryConnection = solanaConnection(state.settings, { fastRead: true });
  const fallbackConnection = solanaConnection({}, { fastRead: true });
  const balances = {};
  const checkedWallets = new Map();

  for (const profile of supportedProfiles) {
    const wallet = tradeWallet(state, profile);
    const key = solanaAddress(wallet);
    if (checkedWallets.has(wallet)) { balances[profile] = checkedWallets.get(wallet); continue; }
    balances[profile] = {
      address: wallet || "",
      sol: null,
      usdc: null,
      error: ""
    };
    // Share failures too: all profiles can use the same wallet, and retrying
    // each one would block the dashboard behind repeated provider failures.
    checkedWallets.set(wallet, balances[profile]);

    if (!key) {
      balances[profile].error = "Wallet not connected";
      continue;
    }

    try {
      balances[profile] = await walletBalanceFromConnection(primaryConnection, wallet, key);
      checkedWallets.set(wallet, balances[profile]);
    } catch (error) {
      if (state.settings.marketDataProvider === "gmgn" || !isRateLimitError(error)) {
        balances[profile].error = error.message || "Balance check failed";
        continue;
      }
      try {
        balances[profile] = await walletBalanceFromConnection(fallbackConnection, wallet, key);
        balances[profile].warning = "Public Solana balance check was rate-limited. Trading remains stopped during GMGN repair.";
        checkedWallets.set(wallet, balances[profile]);
      } catch (fallbackError) {
        balances[profile].error = `Public Solana balance check unavailable: ${fallbackError.message || "Balance check failed"}`;
      }
    }
  }

  return balances;
}

async function walletBalanceFromConnection(connection, wallet, key) {
  const [lamports, ordinary, extensions] = await Promise.all([
    connection.getBalance(key, "confirmed"),
    connection.getParsedTokenAccountsByOwner(key, { programId: tokenProgramId }, "confirmed"),
    connection.getParsedTokenAccountsByOwner(key, { programId: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb") }, "confirmed")
  ]);
  const tokens = {};
  for (const item of [...ordinary.value, ...extensions.value]) {
    const info = item.account?.data?.parsed?.info;
    if (!info?.mint) continue;
    const previous = tokens[info.mint];
    const raw = BigInt(previous?.raw || "0") + BigInt(info.tokenAmount.amount);
    tokens[info.mint] = { raw: String(raw), decimals: info.tokenAmount.decimals, amount: Number(raw) / 10 ** info.tokenAmount.decimals };
  }
  return { address: wallet, sol: lamports / LAMPORTS_PER_SOL, usdc: tokens[usdcMint]?.amount || 0, tokens, error: "", updatedAt: new Date().toISOString() };
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
  if (out.safeMode) out.safeMode = normalizeCopyMode(out.safeMode);
  if (out.truenestMode) out.truenestMode = normalizeCopyMode(out.truenestMode);
  if (out.frogCopySizing) out.frogCopySizing = normalizeCopySizing(out.frogCopySizing);
  if (out.safeCopySizing) out.safeCopySizing = normalizeCopySizing(out.safeCopySizing);
  if (out.truenestCopySizing) out.truenestCopySizing = normalizeCopySizing(out.truenestCopySizing);
  if (out.frogRiskControl === "on" || out.frogRiskControl === "off") out.frogMode = copyModeFromProtection(out.frogRiskControl);
  if (out.safeRiskControl === "on" || out.safeRiskControl === "off") out.safeMode = copyModeFromProtection(out.safeRiskControl);
  if (out.truenestRiskControl === "on" || out.truenestRiskControl === "off") out.truenestMode = copyModeFromProtection(out.truenestRiskControl);
  return out;
}

function ready(state) {
  const s = state.settings;
  return Boolean(
    (s.gmgnApiKey || process.env.GMGN_API_KEY) &&
    s.routeApi &&
    s.turnkeyOrgId &&
    s.turnkeyApiPublicKey &&
    s.turnkeyApiPrivateKey &&
    s.frogTradeWallet &&
    s.frogSignerToken
  );
}

function profileSetting(state, profile, key, fallback = "") {
  const prefix = supportedProfiles.includes(profile) ? profile : "frog";
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
  const mode = profileSetting(state, profile, "mode", "Copy exact amount");
  return String(mode || "Copy exact amount");
}

function profileCopySizing(state, profile) {
  const value = profileSetting(state, profile, "copySizing", "Copy exact amount");
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
  const value = profileSetting(state, profile, "tradeMode", "both");
  return value === "sellOnly";
}

function profileSurviveMode(state, profile) {
  return profileBuyMode(state, profile) === "survive";
}

function profileBuyMode(state, profile) {
  return normalizeBuyMode(profileSetting(state, profile, "buyMode", defaultBuyMode));
}

function profileSurviveMaxUsd(state, profile) {
  const value = Number(profileSetting(state, profile, "surviveMax", "5"));
  return Number.isFinite(value) && value > 0 ? value : surviveBuyUsd;
}

function liveTradingAllowed(state, profile = "") {
  if (state.settings.providerRepairHold || !ready(state) || process.env.ENABLE_LIVE_TRADING !== "true" || process.env.EXECUTE_REAL_SWAPS !== "true") {
    return false;
  }
  if (!profile) return supportedProfiles.some((item) => liveTradingAllowed(state, item));
  return profileLiveTradingSwitch(state, profile) === "on" && profileWalletSync(state, profile) === "Turnkey server wallet";
}

function profileLabel(profile) {
  if (profile === "safe") return "Frog safe bot";
  if (profile === "truenest") return "Trunoest risk bot";
  return "Deku riskier bot";
}

function strategyLossKey(profile) {
  if (profile === "safe") return "safeLosses";
  return profile === "truenest" ? "truenestLosses" : "frogLosses";
}

function queueFailureSwitchLimit(state) {
  const amount = Number(state.settings?.queueFailureSwitchLimit || 3);
  return Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 3;
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

function traderSignalUsd(trade = {}) {
  const explicit = Number(trade.traderPnlUsd);
  if (Number.isFinite(explicit) && explicit !== 0) return explicit;
  const sourceBuy = Number(trade.sourceUsd || trade.execution?.sourceUsd || 0);
  const sourceSell = Number(trade.sourceReceivedUsd || trade.execution?.sourceReceivedUsd || 0);
  const action = tradeSide(trade);
  if (sourceSell) return sourceSell;
  if (sourceBuy && action === "buy") return -Math.abs(sourceBuy);
  return 0;
}

function profileTraderScore(state, profile) {
  return (state.trades || [])
    .filter((trade) => roomMatchesProfile(trade, profile))
    .reduce((sum, trade) => sum + traderSignalUsd(trade), 0);
}

function bestRemainingProfile(state, failedProfile) {
  const candidates = supportedProfiles.filter((profile) => profile !== failedProfile && !(state.strategy.exhaustedProfiles || []).includes(profile));
  const scored = candidates.map((profile) => ({
    profile,
    score: profileTraderScore(state, profile)
  }));
  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return supportedProfiles.indexOf(left.profile) - supportedProfiles.indexOf(right.profile);
  });
  return scored[0]?.profile || null;
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

function profileFromTrade(trade = {}) {
  if (trade.profile === "Frog safe bot" || trade.profile === "safe") return "safe";
  if (trade.profile === "Risk Win" || trade.profile === "Trunoest risk bot" || trade.profile === "truenest") return "truenest";
  return "frog";
}

function tradeIsBuyExecutionFailure(trade = {}) {
  return tradeSide(trade) === "buy" && String(trade.status || "").toLowerCase().includes("execution failed");
}

function applyAutoSwitchStrategy(state) { state.strategy.autoSwitch = false; }

function targetWallet(state, profile) {
  return profileSetting(state, profile, "wallet", "");
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
  return Boolean(extractCopySignal(profile, transaction, state));
}

function movementSummary(transaction = {}) {
  const type = `${transaction.type || transaction.transactionType || "movement"}`;
  const source = `${transaction.source || "unknown source"}`;
  return `${type} from ${source}`;
}

function nonTradeMovementReason(profile, transaction = {}, state) {
  const wallet = targetWallet(state, profile);
  if (!wallet) return "";

  const transfers = Array.isArray(transaction.tokenTransfers) ? transaction.tokenTransfers : [];
  const incomingToken = transfers.some((item) => transferEntersWallet(item, wallet) && transferMint(item) && !isQuoteMint(transferMint(item)) && transferAmount(item));
  const outgoingToken = transfers.some((item) => transferLeavesWallet(item, wallet) && transferMint(item) && !isQuoteMint(transferMint(item)) && transferAmount(item));
  const incomingQuote = transfers.some((item) => transferEntersWallet(item, wallet) && isQuoteMint(transferMint(item)) && transferAmount(item));
  const outgoingQuote = transfers.some((item) => transferLeavesWallet(item, wallet) && isQuoteMint(transferMint(item)) && transferAmount(item));
  const native = nativeChange(transaction, wallet);
  const changes = accountTokenChanges(transaction, wallet);
  const gainedToken = changes.some((item) => item.amount > 0 && !isQuoteMint(item.mint));
  const lostToken = changes.some((item) => item.amount < 0 && !isQuoteMint(item.mint));
  const gainedQuote = changes.some((item) => item.amount > 0 && isQuoteMint(item.mint));
  const lostQuote = changes.some((item) => item.amount < 0 && isQuoteMint(item.mint));

  const hasReceivedToken = incomingToken || gainedToken;
  const hasSentToken = outgoingToken || lostToken;
  const hasReceivedQuote = incomingQuote || gainedQuote || native > 0;
  const hasSentQuote = outgoingQuote || lostQuote || native < 0;

  if (hasReceivedToken && !hasSentQuote && !hasSentToken) {
    return "received-only token transfer or airdrop";
  }
  if (hasSentToken && !hasReceivedQuote && !hasReceivedToken) {
    return "sent-only token transfer";
  }
  if (!hasReceivedToken && !hasSentToken && !hasReceivedQuote && !hasSentQuote) {
    return "wallet/account update";
  }
  return "";
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
  const changes = (transaction.accountData || []).flatMap((item) => {
    const accountMatchesWallet =
      sameAddress(item.account, wallet) ||
      sameAddress(item.owner, wallet) ||
      sameAddress(item.userAccount, wallet);
    const tokenChanges = Array.isArray(item?.tokenBalanceChanges) ? item.tokenBalanceChanges : [];
    return tokenChanges.filter((change) =>
      accountMatchesWallet ||
      sameAddress(change.owner, wallet) ||
      sameAddress(change.userAccount, wallet) ||
      sameAddress(change.tokenAccountOwner, wallet)
    );
  });
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
  const buyMode = profileBuyMode(state, profile);
  const usd = Number(sourceUsd);
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  if (buyMode !== "exact") return Math.min(usd, profileSurviveMaxUsd(state, profile));
  return usd;
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

function solanaConnection(settings = {}, { fastRead = false } = {}) {
  const key = ""; // Paid Helius disabled: use public Solana verification only.
  const endpoint = key
    ? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`
    : clusterApiUrl("mainnet-beta");
  return new Connection(endpoint, fastRead ? {
    commitment: "confirmed", disableRetryOnRateLimit: true,
    fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(2500) })
  } : "confirmed");
}

function publicSolanaConnection() {
  return new Connection(clusterApiUrl("mainnet-beta"), "confirmed");
}

function isRateLimitError(error) {
  return /429|max usage|rate limit|resource exhausted/i.test(String(error?.message || error || ""));
}

function solanaAddress(value) {
  try {
    return new PublicKey(String(value || "").trim());
  } catch {
    return null;
  }
}

async function executeSolWithdrawal(state, { profile, destination, amountSol }) {
  if (!supportedProfiles.includes(profile)) throw new Error("Choose Frog, Deku, or Trunoest wallet.");
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

async function executeUsdcWithdrawal(state, options) {
  return withWalletOperation(() => executeUsdcWithdrawalLocked(state, options));
}

async function executeUsdcWithdrawalLocked(state, { profile, destination, amountUsd, profitOnly = false }) {
  if (!supportedProfiles.includes(profile)) throw new Error("Choose Frog, Deku, or Trunoest wallet.");
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
  const lockedProfit = await protectProfit(state, sourceWallet, currentUsdc);
  const available = profitOnly ? Math.min(currentUsdc, lockedProfit) : Math.max(0, currentUsdc - lockedProfit);
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
  const confirmation = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (confirmation.value.err) throw new Error(`USDC withdrawal failed: ${JSON.stringify(confirmation.value.err)}`);
  if (profitOnly) {
    const reserves = await readProfitReserves();
    reserves[sourceWallet].lockedUsd = Math.max(0, lockedProfit - rawAmount / (10 ** usdcDecimals));
    reserves[sourceWallet].lastWithdrawal = signature;
    await saveProfitReserves();
    state.profitReserves = reserves;
  }

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
  const value = Number(profileSetting(state, profile, "max", "0"));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function profileDepositUsd(state, profile) {
  const value = Number(state.settings.frogDeposit || state.settings.truenestDeposit);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function profileTradeableUsdc(connection, state, profile, wallet) {
  const principal = profileDepositUsd(state, profile);
  const currentUsdc = await tokenUiBalance(connection, wallet, usdcMint);
  const locked = await protectProfit(state, wallet, currentUsdc);
  return Math.max(0, Math.min(currentUsdc - locked, principal));
}

function profileTraderBankrollUsd(state, profile) {
  const value = Number(profileSetting(state, profile, "traderBankroll", "0"));
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
  // Only unsigned quote requests are retried; execution outcomes may be uncertain.
  const attempts = method === "GET" && pathname === "/swap/v2/order" ? 3 : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "x-api-key": apiKey } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error || payload.errorMessage) {
        const error = new Error(payload.errorMessage || payload.error || `Jupiter returned ${response.status}`);
        error.retryable = response.status === 429 || response.status >= 500 || /failed to get quotes/i.test(error.message);
        throw error;
      }
      if (pathname === "/swap/v2/execute" && payload.status !== "Success") {
        throw new Error(`Jupiter execution not confirmed: ${payload.status || "unknown status"}${payload.code !== undefined ? ` (code ${payload.code})` : ""}${payload.signature ? `; transaction ${payload.signature}` : ""}`);
      }
      return payload;
    } catch (error) {
      const retryable = error.retryable || /fetch failed|timeout|timed out|ECONNRESET/i.test(error.message);
      if (attempt === attempts || !retryable) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
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

function beginTradingSession(state) {
  if (!supportedProfiles.some((p) => state.profiles?.[p]?.running)) {
    state.strategy.buySessionStartedAt = Date.now();
    state.strategy.controlRevision = Math.max(Date.now(), Number(state.strategy.controlRevision || 0) + 1);
  }
}

// Poll cadence is not a buy-expiration deadline. A known source exit cancels a pending buy.
function buySignalError(profile, transaction, state) {
  const started = Number(state.strategy?.buySessionStartedAt || 0);
  if (started && (!Number(transaction.timestamp) || Number(transaction.timestamp) * 1000 < Math.floor(started / 1000) * 1000)) {
    return "Buy blocked: source trade predates this trading session";
  }
  const buy = primarySwapLeg(transaction, profile, state);
  for (const feed of signalFeeds.values()) {
    if (feed.profile !== profile || feed.wallet !== targetWallet(state, profile)) continue;
    for (const other of feed.transactions || []) {
      const sell = primarySwapLeg(other, profile, state);
      if (sell?.action === "sell" && sell.inputMint === buy?.outputMint &&
          Number(other.timestamp) >= Number(transaction.timestamp)) {
        return "Buy blocked: trader already sold this coin in the received signals";
      }
    }
  }
  return "";
}

async function executeCopiedSwap(profile, transaction, state) {
  if (primarySwapLeg(transaction, profile, state)?.action === "sell") {
    // Recheck the held balance after any submitted buy finishes.
    return withWalletOperation(() => executeCopiedSwapLocked(profile, transaction, state, true), 100);
  }
  // Buy quote preparation must not monopolize the wallet while a sell is waiting.
  return executeCopiedSwapLocked(profile, transaction, state);
}

async function executeCopiedSwapLocked(profile, transaction, state, walletLocked = false) {
  const currentControls = await readState();
  if (emergencyStopRequested || !supportedProfiles.some((key) => currentControls.profiles?.[key]?.running)) {
    return { status: "Skipped - trading stopped by owner" };
  }
  if (Number(currentControls.strategy?.controlRevision || 0) > Number(state.strategy?.controlRevision || 0)) {
    state.strategy = currentControls.strategy;
    state.settings = currentControls.settings;
  }
  const leg = primarySwapLeg(transaction, profile, state);
  if (!leg?.inputMint || !leg?.outputMint || !leg?.amount) {
    return { status: "Skipped - unsupported swap format" };
  }

  if (leg.action === "buy") {
    if (state.strategy?.activeProfile !== profile) return { status: "Buy blocked: trader selection changed" };
    const reason = buySignalError(profile, transaction, state);
    if (reason) return { status: reason };
  }
  const detectedAt = transaction.detectedAt || new Date().toISOString();
  const wallet = tradeWallet(state, profile);
  const signer = signerId(state, profile) || wallet;
  const apiKey = jupiterApiKey(state.settings);
  if (!wallet || !signer) return { status: "Skipped - trading wallet or signer missing" };
  const connection = solanaConnection(state.settings);
  let inputMint = leg.inputMint;
  let outputMint = leg.outputMint;
  let copyAmount = scaledCopyAmount(leg.amount, state, profile);
  let sourceBuyUsd = 0;

  if (leg.action === "buy" && isQuoteMint(leg.outputMint)) {
    return { status: "Skipped - buy signal did not show a token bought" };
  }

  if (leg.action === "sell" && isQuoteMint(leg.inputMint)) {
    return { status: "Skipped - USDC movement, no token to sell" };
  }

  if (leg.action === "buy") {
    if (state.strategy?.paused) return { status: `Game stopped - ${state.strategy.pauseReason || "new buys paused"}` };
    if (profileSellOnly(state, profile)) {
      return { status: "Skipped - Sell Only mode is ON, new buys are blocked" };
    }
    let sourceUsd = Number(leg.sourceUsd || 0);
    if (!sourceUsd && isQuoteMint(leg.inputMint)) {
      if (leg.inputMint === usdcMint) {
        sourceUsd = Number(leg.amount) / 1_000_000;
      } else {
        // Quote only: value the trader's SOL/USDT input without spending it.
        const valuation = await jupiterJson("/swap/v2/order", {
          apiKey,
          query: { inputMint: leg.inputMint, outputMint: usdcMint, amount: leg.amount }
        });
        sourceUsd = Number(valuation.outAmount || 0) / 1_000_000;
      }
    }
    sourceBuyUsd = sourceUsd;
    let buyUsd = buyUsdAmount(state, profile, sourceUsd);
    if (!buyUsd) return { status: "Skipped - trader buy value could not be determined" };
    const tradeableUsdc = await withWalletOperation(() => profileTradeableUsdc(connection, state, profile, wallet));
    if (tradeableUsdc <= 0) return { status: "Skipped - no tradeable USDC after profit lock" };
    if (profileBuyMode(state, profile) === "exact" && buyUsd > tradeableUsdc) {
      return { status: "Skipped - insufficient tradeable USDC to copy the exact amount" };
    }
    buyUsd = Math.min(buyUsd, tradeableUsdc);
    inputMint = usdcMint;
    outputMint = leg.outputMint;
    copyAmount = {
      amount: usdcRawFromUsd(buyUsd),
      note: `USDC buy ${buyUsd.toFixed(2)} from source trade value ${sourceUsd.toFixed(2)}; profit lock kept extra USDC out`
    };
  }

  if (leg.action === "sell") {
    const tracked = await trackedPosition(state, profile, leg.inputMint);
    if (!tracked || BigInt(tracked.raw) <= 0n) return {status:"Skipped - no verified copied holding for this trader"};
    const sourceTx = await connection.getParsedTransaction(canonicalSignalId(transaction.signature), {commitment:"confirmed",maxSupportedTransactionVersion:1});
    const fraction = sellFraction(sourceTx, targetWallet(state,profile), leg.inputMint);
    if (!fraction) throw new Error("Cannot verify the trader's sold proportion yet; sell remains queued");
    const heldAmount = await tokenBalanceRaw(connection,wallet,leg.inputMint);
    if (BigInt(heldAmount || '0') < BigInt(tracked.raw)) throw new Error("Wallet holding differs from recorded holding; review required");
    const amount = proportionalAmount(tracked.raw, fraction);
    if (BigInt(amount) === 0n) return {status:"Skipped - proportional amount below one token unit"};
    inputMint = leg.inputMint; outputMint = usdcMint;
    copyAmount = {amount,note:"Copy the verified proportion sold by the original trader"};

  }

  const order = await jupiterJson("/swap/v2/order", {
    apiKey,
    query: {
      inputMint,
      outputMint,
      amount: copyAmount.amount,
      taker: wallet,
      swapMode: "ExactIn"
    }
  });

  if (!order.transaction) {
    return { status: `Skipped - Jupiter could not build transaction${order.errorCode ? ` (${order.errorCode})` : ""}` };
  }
  if (leg.action === "buy" && (!order.inAmount || BigInt(order.inAmount) > BigInt(copyAmount.amount))) {
    throw new Error("Swap request exceeds the authorized buy amount; locked profit was not released");
  }

  const submit = async () => {
    const checkControls = async () => {
      const current = await readState();
      if (emergencyStopRequested || !supportedProfiles.some((key) => current.profiles?.[key]?.running)) return "Skipped - trading stopped by owner";
      if (leg.action === "buy") {
        if (current.strategy?.activeProfile !== profile || current.strategy?.paused || profileSellOnly(current, profile)) {
          return "Buy blocked: trading controls changed";
        }
        const reason = buySignalError(profile, transaction, current);
        if (reason) return reason;
      }
      return "";
    };
    if (await hasPendingMint(wallet, leg.action === "buy" ? outputMint : inputMint)) return {status:"Skipped - prior transaction for this coin awaits confirmation"};
    let reason = await checkControls();
    if (reason) return { status: reason, detectedAt };
    if (leg.action === "buy") {
      const current = await readState();
      const available = Math.min(await profileTradeableUsdc(connection, current, profile, wallet),
        buyUsdAmount(current, profile, sourceBuyUsd));
      if (BigInt(copyAmount.amount) > BigInt(usdcRawFromUsd(available))) {
        return { status: "Buy blocked: available trading funds changed; locked profit protected", detectedAt };
      }
    }
    const signed = await signSolanaTransaction(state, signer, wallet, order.transaction);
    reason = await checkControls();
    if (reason) return { status: reason, detectedAt };

  const submittedAt = new Date().toISOString();
  const journalKey = await recordPendingSwap({wallet,profile,mint:leg.action === "buy" ? outputMint : inputMint,side:leg.action,source:canonicalSignalId(transaction.signature)},signed,order);
  if (emergencyStopRequested) {
    const d=await executionJournal.load();delete d.pending[journalKey];await executionJournal.save();
    return {status:"Skipped - trading stopped by owner"};
  }
  const executed = await jupiterJson("/swap/v2/execute", {
    apiKey,
    method: "POST",
    body: {
      signedTransaction: signed.signedTransactionBase64,
      requestId: order.requestId,
      lastValidBlockHeight: order.lastValidBlockHeight
    }
  });

  await recordExecutionResponse(journalKey,executed);
  return {
    status: "Submitted - confirmation pending",
    detectedAt,
    submittedAt,

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
    txid: journalKey
  };
  };
  return walletLocked ? submit() : withWalletOperation(submit, leg.action === "sell" ? 100 : 0);
}

function transactionSignature(signed) {
  const bytes=VersionedTransaction.deserialize(Buffer.from(signed.signedTransactionBase64,'base64')).signatures[0];
  const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n=BigInt('0x'+Buffer.from(bytes).toString('hex')), out='';
  while(n){out=alphabet[Number(n%58n)]+out;n/=58n;}
  for(const b of bytes){if(b!==0)break;out='1'+out;}
  if(!out || bytes.every(b=>b===0))throw new Error('Transaction is not signed');
  return out;
}
async function hasPendingMint(wallet,mint) {
  const d=await executionJournal.load();
  return Object.values(d.pending).some(p=>p.wallet===wallet && p.mint===mint);
}
async function recordPendingSwap(info,signed,order) {
  const d=await executionJournal.load(),txid=transactionSignature(signed);
  if(await hasPendingMint(info.wallet,info.mint))throw new Error('Previous transaction for this coin awaits confirmation');
  d.pending[txid]={...info,txid,expires:order.lastValidBlockHeight,requestId:order.requestId,submittedAt:Date.now()};
  await executionJournal.save();return txid;
}
async function recordExecutionResponse(key,result) {
  const d=await executionJournal.load();
  if(result.status && result.status!=='Success') {
    d.notices[key]=`Execution response: ${result.status}; checking chain before retrying`;
    await executionJournal.save();throw new Error(d.notices[key]);
  }
  const returned=result.signature || result.txid;
  if(returned && returned!==key)throw new Error('Execution returned a different signature; confirmation requires review');
}
async function trackedPosition(state,profile,mint) {
  const snapshot=await executionJournal.snapshot();
  const position=snapshot.positions[`${tradeWallet(state)}:${profile}:${mint}`];
  return position?.verified ? position : null;
}
const sourceSellQueue = new Map();
async function queueSourceSell(profile,transaction) {
  const d=await executionJournal.load();d.sourceSells ||= {};
  const key=canonicalSignalId(transaction.signature);
  d.sourceSells[key] ||= {profile,transaction,queuedAt:Date.now()};
  await executionJournal.save();
}
async function retrySourceSells(state) {
  const d=await executionJournal.load();
  for(const [key,job] of Object.entries(d.sourceSells || {})) {
    if(Object.values(d.pending).some(p=>p.source===key))continue;
    if(d.fills.some(f=>f.source===key && f.side==='sell')){delete d.sourceSells[key];await executionJournal.save();continue;}
    if(job.lastAttempt && Date.now()-job.lastAttempt<5000)continue;
    job.lastAttempt=Date.now();
    try {
      const result=await executeCopiedSwap(job.profile,job.transaction,state);
      job.message=result.status;
      // No position can be temporary while an earlier buy is being confirmed.
      if(result.status.includes('no verified copied holding') && Date.now()-job.queuedAt>60000){
        d.notices[key]='Source sale observed, but no verified copied holding was found. Check holdings.';
      }
    }catch(error){job.message=error.message;d.notices[key]=`Sell retry: ${error.message}`;}
    await executionJournal.save();
  }
}
const sourceObservationQueue = new Map();
function queueSourceObservation(profile,transaction,state) {
  const key=canonicalSignalId(transaction.signature);
  sourceObservationQueue.set(key,{profile,transaction,wallet:targetWallet(state,profile),leg:primarySwapLeg(transaction,profile,state)});
  if(sourceObservationQueue.size>500)sourceObservationQueue.delete(sourceObservationQueue.keys().next().value);
}
async function updateSourceReports(connection) {
 const d=await executionJournal.load();d.sourceFills ||= [];d.sourceChecked ||= {};d.sourceUnknown ||= {};
 for(const [key,job] of [...sourceObservationQueue].slice(0,3)) {
   if(d.sourceChecked[key]){sourceObservationQueue.delete(key);continue;}
   const {profile,transaction,wallet,leg}=job;
   const tx=await connection.getParsedTransaction(key,{commitment:'confirmed',maxSupportedTransactionVersion:1});
   if(!tx?.meta || tx.meta.err){sourceObservationQueue.delete(key);continue;}
   const mint=leg.action==='buy'?leg.outputMint:leg.inputMint;
   const amounts=tokenAmounts(tx,wallet,mint),cash=tokenAmounts(tx,wallet,usdcMint);
   const raw=amounts.after-amounts.before,usd=Number(cash.after-cash.before)/1e6;
   if((raw>0n && usd<0)||(raw<0n && usd>0))d.sourceFills.push({txid:key,wallet,profile,mint,side:raw>0n?'buy':'sell',raw:(raw<0n?-raw:raw).toString(),usd:Math.abs(usd),time:tx.blockTime*1000});
   else d.sourceUnknown[profile]=true; // SOL trades need historical USD prices; don't invent them.
   d.sourceChecked[key]=true;sourceObservationQueue.delete(key);await executionJournal.save();
 }
}
async function refreshExecutionReport(state) {
 const connection=solanaConnection(state.settings,{fastRead:true});
 const d=await executionJournal.load();
 // Import retained execution signatures read-only. Missing history remains explicitly incomplete.
 for(const trade of [...(state.trades || [])].reverse()) {
   const e=trade.execution, txid=e?.txid;
   if(!txid || d.checked[txid] || d.pending[txid] || !['buy','sell'].includes(e.action))continue;
   d.pending[txid]={txid,wallet:tradeWallet(state),profile:profileFromTrade(trade),mint:e.action==='buy'?e.outputMint:e.inputMint,side:e.action,source:canonicalSignalId(trade.signature),historical:true,submittedAt:Date.now()};
 }
 await executionJournal.save();
 await executionJournal.reconcile(connection);
 await updateSourceReports(connection);
 const report=await executionJournal.snapshot();
 report.source={};
 const source=buildPositions(d.sourceFills || []);
 for(const profile of supportedProfiles) {
   const closed=source.closed.filter(f=>f.profile===profile);
   report.source[profile]={...dailyResults(closed),total:closed.reduce((n,f)=>n+f.pnl,0),partial:true,unpriced:Boolean(d.sourceUnknown?.[profile]),updatedAt:new Date().toISOString()};
 }
 report.confirmed=d.fills.map(f=>({...f,pnl:report.closed.find(c=>c.txid===f.txid)?.pnl}));
 report.updatedAt=new Date().toISOString();report.partialHistory=true;
 report.pendingSells=Object.values(d.sourceSells || {}).map(j=>({profile:j.profile,message:j.message || 'Waiting to retry'}));
 executionReport=report;
}
let riskWorking=false;
async function runPositionWatch() {
 if(riskWorking)return;riskWorking=true;
 try {
  const state=await readState();
  if(!ready(state))return;
  await refreshExecutionReport(state);
  if(emergencyStopRequested || !supportedProfiles.some(p=>state.profiles[p].running))return;
  const d=await executionJournal.load();
  for(const position of Object.values(executionReport.positions)) {
   if(!position.verified || BigInt(position.raw)<=0n || !(position.cost>0) || profileBuyMode(state,position.profile)==='exact')continue;
   if(await hasPendingMint(position.wallet,position.mint))continue;
   try {
    await withWalletOperation(async()=>{
     const current=await readState();
     if(emergencyStopRequested || !supportedProfiles.some(p=>current.profiles[p].running) || !liveTradingAllowed(current,position.profile))return;
     const p=await trackedPosition(current,position.profile,position.mint);
     if(!p || BigInt(p.raw)<=0n || await hasPendingMint(p.wallet,p.mint))return;
     const connection=solanaConnection(current.settings,{fastRead:true});
     const held=await tokenBalanceRaw(connection,p.wallet,p.mint);
     if(BigInt(held||'0')<BigInt(p.raw))throw new Error('Wallet balance changed; holding needs reconciliation');
     let order=await jupiterJson('/swap/v2/order',{apiKey:jupiterApiKey(current.settings),query:{inputMint:p.mint,outputMint:usdcMint,amount:p.raw,taker:p.wallet,swapMode:'ExactIn'}});
     if(!order.outAmount || order.inAmount!==p.raw || !order.transaction)throw new Error('Sell value unavailable; missing data is not a zero price');
     const proceeds=Number(order.outAmount)/1e6,mode=profileBuyMode(current,p.profile);
     let reason, salePosition=p;
     if(mode==='trailing') {
      d.trailingStops ||= {};
      const mark=trailingExit(p,proceeds,Number(current.settings.trailingStopPercent || 10),d.trailingStops[p.key]);
      if(!mark)throw new Error('Trailing stop needs a valid sell quote and verified purchase');
      d.trailingStops[p.key]=mark;
      // Save before signing/submission, so restart or failed sale cannot lose the peak/exit.
      await executionJournal.save();
      reason=mark.reason;
     }else if(mode==='takeback') {
      d.takeBackStops ||= {};
      const mark=takeBackExit(p,proceeds,d.takeBackStops[p.key]);
      if(!mark)throw new Error('Take My Money Back needs a valid sell quote and verified purchase');
      d.takeBackStops[p.key]=mark;
      await executionJournal.save();
      reason=mark.reason;
      if(reason && mark.raw && mark.raw!==p.raw) {
       salePosition={...p,raw:mark.raw};
       order=await jupiterJson('/swap/v2/order',{apiKey:jupiterApiKey(current.settings),query:{inputMint:p.mint,outputMint:usdcMint,amount:mark.raw,taker:p.wallet,swapMode:'ExactIn'}});
       if(!order.outAmount || order.inAmount!==mark.raw || !order.transaction)throw new Error('Partial sale value unavailable; missing data is not a zero price');
      }
     }else reason=exitReason(mode,p.cost,proceeds);
     const noticeProceeds=Number(order.outAmount || 0)/1e6 || proceeds;
     const takeBackTrigger=mode==='takeback' && d.takeBackStops?.[p.key]?.trigger ? `; protection sell trigger $${d.takeBackStops[p.key].trigger.toFixed(2)}` : '';
     d.notices[p.key]=`${reason || 'Watching'}: estimated sale $${noticeProceeds.toFixed(2)}, remaining cost $${p.cost.toFixed(2)}${mode==='trailing' ? `; trailing sell trigger $${d.trailingStops[p.key].trigger.toFixed(2)}` : ''}${takeBackTrigger}`;
     if(!reason){await executionJournal.save();return;}
     const signed=await signSolanaTransaction(current,signerId(current),p.wallet,order.transaction);
     const before=await readState();
     if(emergencyStopRequested || !supportedProfiles.some(x=>before.profiles[x].running) || before.strategy.controlRevision!==current.strategy.controlRevision)return;
     const key=await recordPendingSwap({...salePosition,side:'sell',reason},signed,order);
     if(emergencyStopRequested){delete d.pending[key];await executionJournal.save();return;}
     const result=await jupiterJson('/swap/v2/execute',{apiKey:jupiterApiKey(current.settings),method:'POST',body:{signedTransaction:signed.signedTransactionBase64,requestId:order.requestId,lastValidBlockHeight:order.lastValidBlockHeight}});
     await recordExecutionResponse(key,result);
     d.notices[p.key]=`${reason}: sale submitted; awaiting chain confirmation`;
     await executionJournal.save();
    },100);
   }catch(error){d.notices[position.key]=`Exit check: ${error.message}`;await executionJournal.save();}
  }
 }catch(error){executionReport={...(executionReport||{}),error:error.message};}
 finally{riskWorking=false;}
}

// Read-only market metadata. Never signs or submits a transaction.
const coinMarketCache = new Map();
const sellPreviews = new Map();
async function coinMarket(mint) {
  const cached = coinMarketCache.get(mint);
  if (cached && Date.now() - cached.checked < 30000) return cached;
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Market data unavailable');
    const data = await response.json();
    const pairs = (data.pairs || []).filter(p => p.chainId === 'solana' && p.baseToken?.address === mint && Number(p.priceUsd) > 0)
      .sort((a,b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0));
    const best = pairs[0];
    const result = { name: best?.baseToken?.name || 'Unknown token', symbol: best?.baseToken?.symbol || mint.slice(0,6), priceUsd: best ? Number(best.priceUsd) : null, checked: Date.now() };
    coinMarketCache.set(mint, result);
    return result;
  } catch { return { name: 'Unknown token', symbol: mint.slice(0,6), priceUsd: null, checked: Date.now() }; }
}

async function executeManualTokenSell(state, { profile, mint, automatic = false, previewId }) {
  return withWalletOperation(async () => {
    if (automatic) {
      const current = await readState();
      if (!supportedProfiles.some((key) => current.profiles?.[key]?.running)) {
        throw new Error("Trading stopped by owner; automatic sell cancelled.");
      }
    }
    return executeManualTokenSellLocked(state, { profile, mint, automatic, previewId });
  }, 100);
}

async function executeManualTokenSellLocked(state, { profile, mint, automatic = false, previewId }) {
  const wallet = tradeWallet(state, profile);
  const signer = signerId(state, profile) || wallet;
  const tokenMint = solanaAddress(mint)?.toBase58();
  if (!wallet || !signer) throw new Error(`${profileLabel(profile)} trading wallet or signer is missing.`);
  if (!tokenMint || isQuoteMint(tokenMint)) throw new Error("Enter the held token mint to sell.");
  if (!liveTradingAllowed(state, profile)) throw new Error(`${profileLabel(profile)} live trading is not enabled.`);

  const connection = solanaConnection(state.settings);
  const heldAmount = await tokenBalanceRaw(connection, wallet, tokenMint);
  if (!heldAmount) throw new Error(`${profileLabel(profile)} does not hold this token anymore.`);

  let order;
  if (!automatic) {
    const preview = sellPreviews.get(previewId);
    sellPreviews.delete(previewId); // single-use even when a later step fails
    if (!preview || preview.expiresAt < Date.now()) throw new Error('Sale preview expired. Check a new quote.');
    if (preview.wallet !== wallet || preview.mint !== tokenMint || preview.profile !== profile || preview.raw !== heldAmount) throw new Error('Wallet or coin amount changed. Check a new quote.');
    if (await hasPendingMint(wallet, tokenMint)) throw new Error('A transaction for this coin is still pending. Check its receipt before retrying.');
    order = preview.order;
  } else {
    order = await jupiterJson('/swap/v2/order', { apiKey: jupiterApiKey(state.settings), query: { inputMint: tokenMint, outputMint: usdcMint, amount: heldAmount, taker: wallet, swapMode: 'ExactIn' } });
  }

  if (!order.transaction) {
    throw new Error(`Jupiter could not build sell transaction${order.errorCode ? ` (${order.errorCode})` : ""}.`);
  }

  const signed = await signSolanaTransaction(state, signer, wallet, order.transaction);
  const pendingKey = !automatic ? await recordPendingSwap({ wallet, mint: tokenMint, profile, side: 'sell', raw: heldAmount, source: `manual:${previewId}` }, signed, order) : null;
  if (automatic) {
    const check=await readState();
    if(emergencyStopRequested || !supportedProfiles.some(p=>check.profiles[p].running)) throw new Error("Trading stopped; sell cancelled before submission");
  }
  const executed = await jupiterJson("/swap/v2/execute", {
    apiKey: jupiterApiKey(state.settings),
    method: "POST",
    body: {
      signedTransaction: signed.signedTransactionBase64,
      requestId: order.requestId,
      lastValidBlockHeight: order.lastValidBlockHeight
    }
  });

  if (pendingKey) await recordExecutionResponse(pendingKey, executed);

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
  if (profile === "safe") return text.includes("frog safe") || text.includes("safe bot") || text.includes("beginner") || text === "frog";
  if (profile === "truenest") return text.includes("risk win") || text.includes("truenest") || text.includes("trunoest") || text.includes("big win") || text.includes("risk bot");
  return text.includes("decu win") || text.includes("deku") || text.includes("decu") || text.includes("smart win") || text.includes("deku riskier");
}

async function autoSellStuckTokenAfterSellSignal() { return null; }

function tradeMint(trade = {}) {
  return String(trade.tradedTokenMint || trade.execution?.inputMint || trade.execution?.outputMint || trade.token || "").trim();
}

function tradeLooksExecuted(trade = {}) {
  return String(trade.status || "").toLowerCase().includes("executed");
}

function autoStockSellKey(profile, mint, sellTrade = {}) {
  return `${profile}:${mint}:${sellTrade.signature || sellTrade.id || sellTrade.time || "sell"}`;
}

async function autoSellStockCoinsFromHistory(state) { return retrySourceSells(state); }

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
    action: leg?.action === "sell" ? "Sell signal" : leg?.action === "buy" ? "Buy signal" : "Observed movement",
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
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) {
    const help = response.status === 429
      ? "Helius returned 429. Refresh the paid Helius API key in Settings before starting live copy trading."
      : `Helius returned ${response.status}`;
    throw new Error(help);
  }
  const payload = await response.json();
  if (payload.error) {
    const message = payload.error.message || payload.error || "";
    if (!/continue search|failed to find events/i.test(message)) {
      throw new Error(message || "Helius Enhanced transaction lookup failed");
    }
    return [];
  }
  return Array.isArray(payload) ? payload.map(normalizeHeliusEnhancedTransaction) : [];
}

function normalizeHeliusEnhancedTransaction(transaction = {}) {
  const swap = transaction.events?.swap;
  if (!swap) return transaction;

  const tokenInputs = Array.isArray(swap.tokenInputs) ? [...swap.tokenInputs] : [];
  const tokenOutputs = Array.isArray(swap.tokenOutputs) ? [...swap.tokenOutputs] : [];

  if (swap.nativeInput?.amount && !tokenInputs.some((item) => transferMint(item) === solMint)) {
    tokenInputs.push({
      mint: solMint,
      symbol: "SOL",
      tokenAmount: Number(swap.nativeInput.amount || 0) / LAMPORTS_PER_SOL,
      rawTokenAmount: {
        tokenAmount: String(swap.nativeInput.amount),
        decimals: 9,
        mint: solMint
      }
    });
  }

  if (swap.nativeOutput?.amount && !tokenOutputs.some((item) => transferMint(item) === solMint)) {
    tokenOutputs.push({
      mint: solMint,
      symbol: "SOL",
      tokenAmount: Number(swap.nativeOutput.amount || 0) / LAMPORTS_PER_SOL,
      rawTokenAmount: {
        tokenAmount: String(swap.nativeOutput.amount),
        decimals: 9,
        mint: solMint
      }
    });
  }

  return {
    ...transaction,
    events: {
      ...transaction.events,
      swap: {
        ...swap,
        tokenInputs,
        tokenOutputs
      }
    }
  };
}

const gmgnCache = new Map();

function normalizedGmgnTimestamp(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return Math.floor(Date.now() / 1000);
  return numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
}

function gmgnActivityId(activity = {}) {
  const token = activity.token?.address || activity.token_address || activity.base_token?.address || "token";
  const hash = activity.tx_hash || activity.hash || activity.signature || activity.tx || "";
  return `gmgn:${hash || `${activity.timestamp || activity.time || Date.now()}:${activity.event_type}:${token}`}`;
}

function gmgnUsdValue(activity = {}) {
  const value = activity.cost_usd ?? activity.amount_usd ?? activity.usd ?? activity.value_usd;
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function gmgnTokenAmount(activity = {}) {
  const value = activity.token_amount ?? activity.amount ?? activity.base_amount ?? activity.balance_amount;
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function gmgnRawTokenAmount(activity = {}, fallback = "1") {
  const raw = activity.raw_token_amount || activity.token_amount_raw || activity.raw_amount;
  if (raw !== undefined && raw !== null && String(raw) !== "") return String(raw);
  const amount = gmgnTokenAmount(activity);
  const decimals = Number(activity.token?.decimals ?? activity.decimals ?? 0);
  if (amount > 0 && Number.isFinite(decimals)) return String(Math.max(1, Math.round(amount * (10 ** decimals))));
  return fallback;
}

function gmgnActivityToTransaction(activity = {}, wallet = "") {
  const action = String(activity.event_type || activity.event || activity.side || "").toLowerCase();
  if (!["buy", "sell"].includes(action)) return null;

  const tokenMint = activity.token?.address || activity.token_address || activity.base_token?.address;
  if (!tokenMint || isQuoteMint(tokenMint)) return null;

  const tokenSymbol = activity.token?.symbol || activity.symbol || tokenMint;
  const usd = gmgnUsdValue(activity);
  const quoteMint = [solMint, usdcMint, usdtMint].includes(activity.quote_address) ? activity.quote_address : usdcMint;
  const quoteAmount = Number(activity.quote_amount || activity.quoteAmount || 0);
  const timestamp = normalizedGmgnTimestamp(activity.timestamp || activity.time || activity.block_time);
  const id = gmgnActivityId(activity);

  const quoteTransfer = {
    mint: quoteMint,
    symbol: quoteMint === solMint ? "SOL" : quoteMint === usdtMint ? "USDT" : "USDC",
    tokenAmount: quoteAmount > 0 ? quoteAmount : usd,
    rawTokenAmount: {
      tokenAmount: quoteMint === solMint
        ? String(Math.max(1, Math.round((quoteAmount > 0 ? quoteAmount : usd) * LAMPORTS_PER_SOL)))
        : usdcRawFromUsd(usd || quoteAmount || surviveBuyUsd),
      decimals: quoteMint === solMint ? 9 : 6,
      mint: quoteMint
    }
  };

  const tokenTransfer = {
    mint: tokenMint,
    symbol: tokenSymbol,
    tokenAmount: gmgnTokenAmount(activity),
    rawTokenAmount: {
      tokenAmount: gmgnRawTokenAmount(activity),
      decimals: Number(activity.token?.decimals ?? activity.decimals ?? 0),
      mint: tokenMint
    }
  };

  return {
    signature: id,
    timestamp,
    type: "GMGN_WALLET_ACTIVITY",
    source: "GMGN",
    description: `${action.toUpperCase()} ${tokenSymbol}`,
    gmgn: activity,
    events: {
      swap: action === "buy"
        ? { tokenInputs: [quoteTransfer], tokenOutputs: [tokenTransfer] }
        : { tokenInputs: [tokenTransfer], tokenOutputs: [quoteTransfer] }
    },
    tokenTransfers: action === "buy"
      ? [
          { ...quoteTransfer, fromUserAccount: wallet, toUserAccount: "GMGN_QUOTE" },
          { ...tokenTransfer, fromUserAccount: "GMGN_TOKEN", toUserAccount: wallet }
        ]
      : [
          { ...tokenTransfer, fromUserAccount: wallet, toUserAccount: "GMGN_TOKEN" },
          { ...quoteTransfer, fromUserAccount: "GMGN_QUOTE", toUserAccount: wallet }
        ]
  };
}

async function fetchOfficialGmgnTransactionsForAddress(apiKey, address) {
  const url = new URL("https://openapi.gmgn.ai/v1/user/wallet_activity");
  url.searchParams.set("chain", "sol");
  url.searchParams.set("wallet_address", address);
  url.searchParams.set("timestamp", String(Math.floor(Date.now() / 1000)));
  url.searchParams.set("client_id", randomUUID());
  url.searchParams.set("limit", "25");
  url.searchParams.append("type", "buy");
  url.searchParams.append("type", "sell");
  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "X-APIKEY": apiKey
    },
    signal: AbortSignal.timeout(3000)
  });
  if (!response.ok) {
    const detail = response.status === 401 || response.status === 403
      ? "GMGN official API rejected the key or server IP"
      : `GMGN official API returned ${response.status}`;
    throw new Error(detail);
  }
  const payload = await response.json();
  if (payload.code !== undefined && String(payload.code) !== "0") {
    throw new Error(`GMGN data API returned code ${payload.code}: ${String(payload.message || payload.error || "Request rejected").slice(0, 180)}`);
  }
  const data = payload?.data || payload;
  const activities = Array.isArray(data?.activities)
    ? data.activities
    : Array.isArray(payload?.activities)
      ? payload.activities
      : [];
  return activities
    .map((activity) => gmgnActivityToTransaction(activity, address))
    .filter(Boolean);
}

async function fetchGmgnTransactionsForAddress(settings, address) {
  const apiKey = String(settings?.gmgnApiKey || process.env.GMGN_API_KEY || "").trim();
  const now = Date.now();
  const cacheKey = `${apiKey ? "official" : "web"}:${address}`;
  const cached = gmgnCache.get(cacheKey);
  if (cached && now - cached.at < gmgnPollMs) {
    if (cached.error) throw cached.error;
    return cached.transactions;
  }

  if (apiKey) {
    try {
      const transactions = await fetchOfficialGmgnTransactionsForAddress(apiKey, address);
      gmgnCache.set(cacheKey, { at: now, transactions });
      return transactions;
    } catch (error) {
      gmgnCache.set(cacheKey, { at: now, transactions: [], error });
      throw error;
    }
  }

  const params = new URLSearchParams();
  params.append("event", "buy");
  params.append("event", "sell");
  params.set("wallet", address);
  params.set("limit", "25");
  params.set("cost", "10");

  const urls = [
    `https://gmgn.ai/vas/api/v1/wallet_activity/sol?${params.toString()}`,
    `https://gmgn.ai/defi/quotation/v1/wallet_activity/sol?${params.toString()}`
  ];
  let lastError = null;

  for (const endpoint of urls) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          "accept": "application/json, text/plain, */*",
          "accept-language": "en-US,en;q=0.9",
          "origin": "https://gmgn.ai",
          "referer": `https://gmgn.ai/sol/address/${address}`,
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
        }
      });
      if (!response.ok) {
        lastError = new Error(`GMGN returned ${response.status}`);
        continue;
      }
      const payload = await response.json();
      const data = payload?.data || payload;
      const activities = Array.isArray(data?.activities)
        ? data.activities
        : Array.isArray(payload?.activities)
          ? payload.activities
          : [];
      const transactions = activities
        .map((activity) => gmgnActivityToTransaction(activity, address))
        .filter(Boolean);
      gmgnCache.set(cacheKey, { at: now, transactions });
      return transactions;
    } catch (error) {
      lastError = error;
    }
  }

  const finalError = lastError || new Error("GMGN wallet activity lookup failed");
  gmgnCache.set(cacheKey, { at: now, transactions: [], error: finalError });
  throw finalError;
}

async function assertHeliusReadyForProfile(state, profile) {
  if (state.settings.providerRepairHold) throw new Error("Trading stays stopped while GMGN access is being repaired.");
  const wallet = targetWallet(state, profile);
  if (!wallet) throw new Error("Choose a trader wallet before starting.");
  const apiKey=String(state.settings.gmgnApiKey || process.env.GMGN_API_KEY || "").trim();
  if (!apiKey) throw new Error("GMGN API key is missing.");
  await fetchOfficialGmgnTransactionsForAddress(apiKey,wallet);
}

function signalAgeMs(transaction = {}) {
  if (!transaction.timestamp) return 0;
  return Math.max(0, Date.now() - (Number(transaction.timestamp) * 1000));
}

function freshEnoughToCopy(transaction = {}) {
  const age = signalAgeMs(transaction);
  return !age || age <= maxSignalAgeMs;
}

function shouldLogGmgnWarning(state, profile) {
  const last = Number(state.profiles?.[profile]?.lastGmgnWarningAt || 0);
  return !last || Date.now() - last > 60_000;
}

function shouldLogNoSignal(state, profile) {
  const last = Number(state.profiles?.[profile]?.lastNoSignalAt || 0);
  return !last || Date.now() - last > 60_000;
}

async function processSignalTransactions(state, profile, transactions, newest, checkpointField, sourceLabel, options = {}) {
  if (!newest) return [];

  if (!state.profiles[profile][checkpointField] && !options.realtime) {
    state.profiles[profile][checkpointField] = newest;
    state.activity = [line(`${profileLabel(profile)} ${sourceLabel} worker synced to latest wallet activity.`), ...(state.activity || [])].slice(0, 20);
    return [];
  }

  const unseen = [];
  for (const transaction of transactions) {
    if (transaction.signature === state.profiles[profile][checkpointField]) break;
    if (transaction.signature) unseen.push(transaction);
  }

  if (!unseen.length) return [];
  const existing = new Set((state.trades || []).map((trade) => canonicalSignalId(trade.signature || trade.id)));
  const orderedUnseen = [...unseen].reverse();
  const signalTransactions = orderedUnseen
    .filter((transaction) => {
      const id = canonicalSignalId(transaction.signature);
      if (existing.has(id) || !copyableSignal(profile, transaction, state)) return false;
      existing.add(id);
      return true;
    });
  const newTrades = [];

  if (!signalTransactions.length && shouldLogNoSignal(state, profile)) {
    state.profiles[profile].lastNoSignalAt = Date.now();
    const sample = unseen[0] ? movementSummary(unseen[0]) : "wallet movement";
    const swapLikeCount = orderedUnseen.filter(looksLikeSwap).length;
    const nonTradeReasons = orderedUnseen
      .map((transaction) => nonTradeMovementReason(profile, transaction, state))
      .filter(Boolean);
    const latestNonTradeReason = unseen[0] ? nonTradeMovementReason(profile, unseen[0], state) : "";
    const note = nonTradeReasons.length === orderedUnseen.length
      ? `${profileLabel(profile)} ignored ${unseen.length} non-trade movement${unseen.length === 1 ? "" : "s"} (${latestNonTradeReason || "not a wallet buy/sell"}). Latest was ${sample}.`
      : swapLikeCount
        ? `${profileLabel(profile)} saw ${swapLikeCount} swap-like movement${swapLikeCount === 1 ? "" : "s"}, but none showed a safe ${profileLabel(profile)} token-in/token-out trade, so it did not copy blindly. Latest was ${sample}.`
        : `${profileLabel(profile)} saw ${unseen.length} new ${sourceLabel} movement${unseen.length === 1 ? "" : "s"}, but no buy/sell swap was found. Latest was ${sample}.`;
    state.activity = [
      line(`${note}${nonTradeReasons.length === orderedUnseen.length || sourceLabel === "GMGN" ? "" : " Use the exact GMGN trade feed or signer wallet if these are real trades that Helius cannot decode."}`),
      ...(state.activity || [])
    ].slice(0, 20);
  }

  for (const transaction of signalTransactions) {
    if (options.side && primarySwapLeg(transaction, profile, state)?.action !== options.side) continue;
    const trade = tradeFromTransaction(profile, transaction, state);
    queueSourceObservation(profile, transaction, state);
    const leg = primarySwapLeg(transaction, profile, state);
    const alreadySold = leg?.action === "buy" && orderedUnseen.some((other) => {
      const otherLeg = primarySwapLeg(other, profile, state);
      return otherLeg?.action === "sell" && otherLeg.inputMint === leg.outputMint && Number(other.timestamp) >= Number(transaction.timestamp);
    });
    if (alreadySold) {
      trade.status = "Buy blocked: trader already sold this coin in the received signals";
      newTrades.push(trade);
      continue;
    }
    const activeProfile = supportedProfiles.includes(state.strategy?.activeProfile) ? state.strategy.activeProfile : "frog";
    const activeForBuys = profile === activeProfile;
    const canExecute = liveTradingAllowed(state, profile) && ((activeForBuys && !state.strategy?.paused) || leg?.action === "sell");
    if (canExecute) {
      try {
        const execution = await executeCopiedSwap(profile, transaction, state);
        trade.status = execution.status;
        trade.execution = execution;
        if (execution.outputSymbol) trade.token = execution.outputSymbol;
        if (execution.swapUsdValue) trade.amount = Number(execution.swapUsdValue);
      } catch (error) {
        trade.status = "Execution failed";
        trade.executionError = error.message;
      }
    } else if (liveTradingAllowed(state, profile) && leg?.action === "buy" && !activeForBuys) {
      trade.status = "Watched - inactive bot, no buy";
    }
    newTrades.push(trade);

    if (canExecute && leg?.action === "sell" && trade.execution?.txid == null) {
      await queueSourceSell(profile, transaction);
    }
  }

  if (options.side !== "sell" || options.advanceCheckpoint) state.profiles[profile][checkpointField] = newest;
  if (newTrades.length) {
    state.trades = [...newTrades, ...(state.trades || [])].slice(0, 100);
    applyAutoSwitchStrategy(state, newTrades);
    state.activity = [
      line(`${profileLabel(profile)} ${sourceLabel} worker found ${newTrades.length} new swap signal${newTrades.length === 1 ? "" : "s"}${liveTradingAllowed(state, profile) ? " and attempted execution" : ""}.`),
      ...(state.activity || [])
    ].slice(0, 20);
  }
  return newTrades;
}

let wakeCopyWorker = async () => {};
let wakeSellWorker = async () => {};
let observationUntil = 0;
function monitoringEnabled(state) {
  return supportedProfiles.some((p) => state.profiles?.[p]?.running) || Date.now() < observationUntil;
}
const directReadJobs = new Map();
const directReadSeen = new Set();
let directReadsActive = 0;
function queueDirectRead(wallet, signature, sub) {
  if (!signature) return;
  const key = `${wallet}:${signature}`;
  if (directReadSeen.has(key) || directReadJobs.has(key)) return;
  // Bounded queue: history polling remains the recovery path if notification traffic bursts.
  if (directReadJobs.size >= 128) return;
  directReadJobs.set(key, { key, wallet, signature, sub, observedAt: new Date().toISOString(), attempts: 0, dueAt: 0, active: false });
  pumpDirectReads();
}
function pumpDirectReads() {
  for (const job of directReadJobs.values()) {
    if (directReadsActive >= 2) break;
    if (job.active || job.dueAt > Date.now()) continue;
    job.active = true;
    directReadsActive++;
    readDirectTransaction(job).catch(() => {
      job.attempts++;
      if (job.attempts >= 3) directReadJobs.delete(job.key);
      else job.dueAt = Date.now() + 1000;
    }).finally(() => {
      job.active = false;
      directReadsActive--;
      pumpDirectReads();
    });
  }
}
function directReadFailure(error, settings = {}) {
  let message = String(error?.message || error || "Unknown RPC error");
  if (settings.heliusKey) message = message.split(settings.heliusKey).join("[redacted]");
  return message.replace(/(?:https?|wss?):\/\/[^\s"']+/g, "[RPC endpoint]").slice(0, 240);
}
async function readDirectTransaction(job) {
  const state = await readState();
  if (!monitoringEnabled(state) || liveSubscriptions.get(job.wallet) !== job.sub) {
    directReadJobs.delete(job.key);
    return;
  }
  job.attempts++;
  try {
    const tx = await job.sub.connection.getParsedTransaction(job.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 1 });
    if (!tx) throw new Error("Confirmed transaction not available yet");
    const current = await readState();
    if (!monitoringEnabled(current) || liveSubscriptions.get(job.wallet) !== job.sub) {
      directReadJobs.delete(job.key);
      return;
    }
    const decoded = decodeDirectSwap(tx, job.wallet, job.signature, job.observedAt);
    const at = new Date().toISOString();
    for (const profile of supportedProfiles.filter((p) => targetWallet(current,p) === job.wallet)) {
      const key = `${profile}:Solana live`;
      const prior = signalFeeds.get(key);
      const transactions = prior?.wallet === job.wallet ? prior.transactions || [] : [];
      signalFeeds.set(key, { profile, source: "Solana live", wallet: job.wallet, checkedAt: at, error: "",
        decodedCount: (prior?.decodedCount || 0) + (decoded ? 1 : 0),
        lastDecodedSignature: decoded?.signature || prior?.lastDecodedSignature || null,
        notificationToDecodeMs: decoded ? Math.max(0, Date.parse(at) - Date.parse(job.observedAt)) : prior?.notificationToDecodeMs ?? null,
        transactions: decoded ? [decoded, ...transactions.filter((t) => t.signature !== decoded.signature)].slice(0,128) : transactions });
    }
    directReadSeen.add(job.key);
    if (directReadSeen.size > 1024) directReadSeen.delete(directReadSeen.values().next().value);
    directReadJobs.delete(job.key);
    if (decoded) { wakeSellWorker().catch(() => {}); wakeCopyWorker().catch(() => {}); }
  } catch (error) {
    for (const profile of supportedProfiles.filter((p) => targetWallet(state,p) === job.wallet)) {
      const key = `${profile}:Solana live`;
      const prior = signalFeeds.get(key);
      signalFeeds.set(key, { profile, source: "Solana live", wallet: job.wallet, checkedAt: new Date().toISOString(),
        transactions: prior?.wallet === job.wallet ? prior.transactions || [] : [], error: `Direct lookup: ${directReadFailure(error, state.settings)}` });
    }
    if (job.attempts >= 3) directReadJobs.delete(job.key);
    else job.dueAt = Date.now() + 500;
  }
}

const liveSubscriptions = new Map();
async function syncLiveSubscriptions(state) {
  const enabled = false; // GMGN is the selected feed; no paid Helius subscriptions.
  const wanted = new Set(enabled ? supportedProfiles.map((p) => targetWallet(state,p)).filter(Boolean) : []);
  for (const [wallet, sub] of liveSubscriptions) {
    if (!wanted.has(wallet) || sub.apiKey !== state.settings.heliusKey) {
      liveSubscriptions.delete(wallet);
      await sub.connection.removeOnLogsListener(sub.id).catch(() => {});
    }
  }
  if (!enabled || !state.settings.heliusKey) return;
  for (const wallet of wanted) {
    if (liveSubscriptions.has(wallet)) continue;
    const connection = solanaConnection(state.settings, { fastRead: true });
    const sub = { connection, id: null, lastNotificationAt: null, apiKey: state.settings.heliusKey };
    sub.id = connection.onLogs(new PublicKey(wallet), (event) => {
      if (event.err) return;
      sub.lastNotificationAt = new Date().toISOString();
      queueDirectRead(wallet, event.signature, sub);
      pollSignalFeeds().catch(() => {});
    }, "confirmed");
    liveSubscriptions.set(wallet,sub);
  }
}
const signalFeeds = new Map();
const feedRequests = new Set();
const feedStartedAt = new Map();
async function pollSignalFeeds() {
  const state = await readState();
  await syncLiveSubscriptions(state);
  if (!supportedProfiles.some((p) => state.profiles?.[p]?.running)) return;
  for (const profile of supportedProfiles) {
    const wallet = targetWallet(state, profile);
    if (!wallet) continue;
    const sources = [];
    // GMGN is the only selected trader-activity feed.
    if (state.settings.gmgnApiKey || process.env.GMGN_API_KEY) sources.push(["GMGN", () => fetchGmgnTransactionsForAddress(state.settings, wallet)]);
    for (const [source, fetcher] of sources) {
      const key = `${profile}:${source}`;
      if (feedRequests.has(key) || Date.now() - (feedStartedAt.get(key) || 0) < (source === "GMGN" ? 1000 : 500)) continue;
      feedStartedAt.set(key, Date.now());
      feedRequests.add(key);
      if (!signalFeeds.has(key)) signalFeeds.set(key, { profile, source, wallet, checkedAt: null, error: "", transactions: [] });
      Promise.resolve().then(fetcher).then((transactions) => {
        const checked = source === "GMGN" ? gmgnCache.get(`official:${wallet}`)?.at || Date.now() : Date.now();
        const at = new Date(checked).toISOString();
        signalFeeds.set(key, { profile, source, wallet, checkedAt: at, error: "", transactions: transactions.map((t) => ({ ...t, detectedAt: at })) });
        wakeSellWorker().catch(() => {});
        wakeCopyWorker().catch(() => {});
      }).catch((error) => {
        signalFeeds.set(key, { profile, source, wallet, checkedAt: new Date().toISOString(), error: error.message, transactions: [] });
      }).finally(() => feedRequests.delete(key));
    }
  }
}
function feedHealth() {
  return Array.from(signalFeeds.values()).map(({ transactions, ...feed }) => ({
    ...feed, status: feed.source === "Solana live"
      ? feed.error ? "Direct lookup unavailable" : feed.checkedAt ? "Last transaction read" : "Waiting for activity"
      : feed.error ? "Disconnected" : !feed.checkedAt ? "Connecting" : Date.now() - Date.parse(feed.checkedAt) > 3000 ? "Delayed" : "Connected"
  }));
}
async function runCopyWorkerOnce() {
  const state = await readState();
  if (!supportedProfiles.some((p) => state.profiles?.[p]?.running)) return;
  const active = state.strategy.activeProfile;
  const order = [active, ...supportedProfiles.filter((p) => p !== active)].filter(Boolean);
  // Both lanes share one cycle state, but keep independent feed checkpoints.
  // Only submission is serialized; buy quotation cannot stop sell detection.
  for (const profile of order) {
    for (const field of ["lastSignature", "lastGmgnSignature", "lastDirectSignature"]) {
      state.profiles[profile][`${field}Sell`] ||= state.profiles[profile][field];
    }
  }
  const pass = async (side, feeds) => {
    for (const profile of order) {
      for (const source of ["Solana live", "Helius", "GMGN"]) {
        const feed = feeds.get(`${profile}:${source}`);
        if (!feed || (feed.error && source !== "Solana live") || feed.wallet !== targetWallet(state, profile)) continue;
        const current = await readState();
        if (!supportedProfiles.some((p) => current.profiles?.[p]?.running)) return;
        if (Number(current.strategy.controlRevision || 0) > Number(state.strategy.controlRevision || 0)) state.strategy = current.strategy;
        const field = source === "Solana live" ? "lastDirectSignature" : source === "GMGN" ? "lastGmgnSignature" : "lastSignature";
        await processSignalTransactions(state, profile, feed.transactions, newestSignature(feed.transactions),
          side === "sell" ? `${field}Sell` : field, source, { side, advanceCheckpoint: true, realtime: source === "Solana live" });
      }
    }
  };
  let sellTask = null;
  let sellRequested = false;
  const requestSells = () => {
    sellRequested = true;
    if (!sellTask) {
      sellTask = (async () => {
        do { sellRequested = false; await pass("sell", new Map(signalFeeds)); } while (sellRequested);
      })().catch((error) => {
        state.activity = [line(`Sell worker warning: ${error.message}`), ...(state.activity || [])].slice(0,20);
      }).finally(() => { sellTask = null; });
    }
    return sellTask;
  };
  wakeSellWorker = requestSells;
  try {
    await requestSells();
    await pass("buy", new Map(signalFeeds));
    await requestSells();
  } finally {
    wakeSellWorker = async () => {};
    if (sellTask) await sellTask;
  }
  const current = await readState();
  if (!supportedProfiles.some((p) => current.profiles?.[p]?.running)) return;
  try { await retrySourceSells(state); }
  catch (error) { state.activity = [line(`Automatic sell check: ${error.message}`), ...(state.activity || [])].slice(0,20); }
  await saveState(state);
}

function startCopyWorker() {
  let working = false;
  let requested = false;
  wakeCopyWorker = async () => {
    requested = true;
    if (working) return;
    working = true;
    try {
      do {
        requested = false;
        await runCopyWorkerOnce();
      } while (requested);
    } catch (error) {
      const state = await readState();
      state.activity = [line(`Copy worker warning: ${error.message}`), ...(state.activity || [])].slice(0,20);
      await saveState(state);
    } finally { working = false; }
  };
  setInterval(() => { runPositionWatch().catch(() => {}); }, 2000);
  runPositionWatch().catch(() => {});
  setInterval(() => { pollSignalFeeds().catch(() => {}); pumpDirectReads(); },500);
  setInterval(() => { wakeCopyWorker().catch(() => {}); },workerIntervalMs);
}

async function handleApi(request, response, url) {
  if (request.method === "POST" && url.pathname === "/api/monitor/observe") {
    const state = await readState();
    if (requireOwner(response, sessionFromRequest(request, state))) return true;
    if (supportedProfiles.some((p) => state.profiles?.[p]?.running)) {
      send(response, 409, { error: "Stop trading before running the read-only connection check." });
      return true;
    }
    observationUntil = Date.now() + 45000;
    await syncLiveSubscriptions(state);
    send(response, 200, { readOnly: true, tradingStarted: false, expiresAt: new Date(observationUntil).toISOString() });
    return true;
  }
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
    await withWalletOperation(async () => {
      payload.walletBalances = await walletBalances(state).catch((error) => ({ error: error.message || "Balance check failed" }));
      const cash = payload.walletBalances.frog;
      if (cash && !cash.error && Number.isFinite(cash.usdc)) await protectProfit(state, cash.address, cash.usdc);
      payload.profitReserves = await readProfitReserves();
    });
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
    const input = await readBody(request);
    if (input.frogBuyMode !== undefined) {
      if (!["limits", "exact", "loss", "trailing", "takeback"].includes(input.frogBuyMode)) { send(response, 400, {error:"Choose a trading mode."}); return true; }
      if (input.frogBuyMode !== "exact" && !(Number(input.frogSurviveMax)>0 && Number.isFinite(Number(input.frogSurviveMax)))) { send(response, 400, {error:"Enter a positive maximum purchase amount."}); return true; }
    }
    if (input.trailingStopPercent !== undefined && !(Number.isFinite(Number(input.trailingStopPercent)) && Number(input.trailingStopPercent)>0 && Number(input.trailingStopPercent)<100)) {
      send(response,400,{error:"Trailing fall percentage must be greater than 0 and less than 100."}); return true;
    }
    state.settings = { ...state.settings, ...clean(input) };
    if (input.frogBuyMode !== undefined) state.settings.modesConfirmed = "yes";
    syncQueueSurviveSettings(state.settings);
    state.strategy.controlRevision = Math.max(Date.now(), Number(state.strategy.controlRevision || 0) + 1);
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

  if (request.method === 'GET' && url.pathname === '/api/owner/wallet-coins') {
    const state = await readState();
    if (requireOwner(response, sessionFromRequest(request, state))) return true;
    const balances = await walletBalances(state);
    const balance = balances.frog;
    if (!balance || balance.error || !balance.tokens) { send(response, 503, { error: balance?.error || 'Wallet check unavailable' }); return true; }
    const held = Object.entries(balance.tokens).filter(([mint,t]) => mint !== usdcMint && BigInt(t.raw || '0') > 0n);
    const coins = [];
    // Small batches keep many unsolicited wallet tokens from flooding the price provider.
    for (let i=0; i<held.length; i+=5) {
      coins.push(...await Promise.all(held.slice(i,i+5).map(async ([mint,t]) => {
        const market = await coinMarket(mint);
        return { mint, ...t, ...market, estimatedUsd: market.priceUsd === null ? null : t.amount * market.priceUsd, canSell: !isQuoteMint(mint) };
      })));
    }
    send(response, 200, { wallet: balance.address, checkedAt: balance.updatedAt, coins });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/owner/sell-preview') {
    const state = await readState();
    if (requireOwner(response, sessionFromRequest(request, state))) return true;
    try {
      const body = await readBody(request);
      const profile = supportedProfiles.includes(body.profile) ? body.profile : 'frog';
      const mint = solanaAddress(String(body.mint || '').trim())?.toBase58();
      if (!mint || isQuoteMint(mint)) throw new Error('Choose a held token to sell.');
      const wallet = tradeWallet(state, profile);
      if (!wallet) throw new Error('Trading wallet is missing.');
      const balance = await walletBalanceFromConnection(solanaConnection(state.settings), wallet, solanaAddress(wallet));
      const held = balance.tokens[mint];
      if (!held || BigInt(held.raw || '0') <= 0n) throw new Error('No remaining balance of this coin.');
      const order = await jupiterJson('/swap/v2/order', { apiKey: jupiterApiKey(state.settings), query: { inputMint: mint, outputMint: usdcMint, amount: held.raw, taker: wallet, swapMode: 'ExactIn' } });
      if (!order.transaction || order.inputMint !== mint || order.outputMint !== usdcMint || String(order.inAmount) !== held.raw || !(Number(order.outAmount) > 0)) throw new Error('No valid sale quote available. Nothing was sold.');
      const market = await coinMarket(mint);
      for (const [key,p] of sellPreviews) if (p.expiresAt < Date.now()) sellPreviews.delete(key);
      const previewId = randomUUID(), expiresAt = Date.now() + 30000;
      sellPreviews.set(previewId, { wallet, mint, profile, raw: held.raw, order, expiresAt });
      send(response, 200, { previewId, expiresAt, wallet, mint, canExecute: liveTradingAllowed(state, profile), blockedReason: state.settings.providerRepairHold ? 'Sales are blocked by the current provider repair lock.' : 'Live sale execution is not enabled for this wallet.', amount: held.amount, name: market.name, symbol: market.symbol, expectedUsdc: Number(order.outAmount)/1e6, minimumUsdc: order.otherAmountThreshold ? Number(order.otherAmountThreshold)/1e6 : null, slippageBps: order.slippageBps ?? null, networkFeeSol: (Number(order.signatureFeeLamports || 0) + Number(order.prioritizationFeeLamports || 0) + Number(order.rentFeeLamports || 0))/1e9 });
    } catch (error) { send(response, 400, { error: error.message }); }
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/owner/sell-token") {
    const state = await readState();
    if (requireOwner(response, sessionFromRequest(request, state))) return true;
    const body = await readBody(request);
    const profile = supportedProfiles.includes(body.profile) ? body.profile : body.profile === "truenest" ? "truenest" : "frog";
    const mint = String(body.mint || "").trim();
    const stockOpenUsd = Number(body.stockOpenUsd || 0);

    try {
      const result = await executeManualTokenSell(state, { profile, mint, previewId: body.previewId });
      const soldUsd = Number(result.swapUsdValue || 0);
      const stuckPnl = stockOpenUsd > 0 ? soldUsd - stockOpenUsd : 0;
      const stockStatus = stockOpenUsd > 0
        ? `Stock coin sold - ${stuckPnl >= 0 ? "Made more" : "Lose"} ${Math.abs(stuckPnl).toFixed(2)}`
        : "Executed";
      const trade = {
        id: result.txid || randomUUID(),
        signature: result.txid || "",
        time: new Date().toLocaleString("en-US", { hour12: false }),
        profile: profileLabel(profile),
        action: stockOpenUsd > 0 ? "Stock coin sell" : "Manual sell",
        token: result.inputMint,
        tradedToken: result.inputMint,
        tradedTokenMint: result.inputMint,
        amount: soldUsd,
        sourceUsd: 0,
        sourceReceivedUsd: soldUsd,
        traderPnlUsd: 0,
        pnl: stuckPnl,
        status: stockStatus,
        execution: result
      };
      state.trades = [trade, ...(state.trades || [])].slice(0, 80);
      state.activity = [
        line(`${profileLabel(profile)} ${stockOpenUsd > 0 ? "stock coin" : "manual"} sell sent ${result.inputMint.slice(0, 6)}...${result.inputMint.slice(-4)} to USDC${stockOpenUsd > 0 ? ` (${stuckPnl >= 0 ? "made more" : "lose"} ${Math.abs(stuckPnl).toFixed(2)})` : ""}. SOL gas was left in the wallet.`),
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

  if (request.method === "POST" && url.pathname === "/api/queue/automatic") {
    const state = await readState();
    if (requireOwner(response, sessionFromRequest(request, state))) return true;
    send(response, 410, { error: "Automatic switching has been removed. Stop trading, then choose your trader." });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/queue/start") {
    const state = await readState();
    if (requireOwner(response, sessionFromRequest(request, state))) return true;
    if (state.settings.providerRepairHold) { send(response,409,{error:"Trading stays stopped while GMGN access is being repaired. It will not restart automatically."}); return true; }
    if (state.settings.modesConfirmed !== "yes") { send(response,409,{error:"Choose and save your trading mode before starting."}); return true; }
    if (!ready(state)) {
      send(response, 400, { error: "Engine Room is not complete yet." });
      return true;
    }
    try {
      await assertHeliusReadyForProfile(state, state.strategy.activeProfile);
    } catch (error) {
      state.activity = [
        line(`Trading queue start blocked: ${error.message}`),
        ...(state.activity || [])
      ].slice(0, 20);
      await saveState(state);
      send(response, 400, { error: error.message, status: statusPayload(state, { role: "owner", id: "owner" }) });
      return true;
    }
    state.strategy = { ...structuredClone(defaultState.strategy), ...(state.strategy || {}) };
    state.strategy.activeProfile = supportedProfiles.includes(state.strategy.activeProfile) ? state.strategy.activeProfile : "safe";
    state.strategy.controlRevision = Date.now();
    state.strategy.exhaustedProfiles = [];
    state.strategy.paused = false;
    state.strategy.pauseReason = "";
    state.strategy.frogLosses = 0;
    state.strategy.truenestLosses = 0;
    state.strategy.safeLosses = 0;
    state.strategy.processedClosedTrades = [];
    emergencyStopRequested = false;
    beginTradingSession(state);
    supportedProfiles.forEach((profile) => {
      state.profiles[profile].running = true;
    });
    state.profiles.frog.lastAction = new Date().toISOString();
    const switchLimit = queueFailureSwitchLimit(state);
    state.activity = [
      line(`Trading queue started: ${profileLabel(state.strategy.activeProfile)} in ${state.strategy.autoSwitch ? "Automatic" : "Manual"} mode. Sell monitoring stays active.`),
      line(liveTradingAllowed(state, "frog")
        ? "Production execution is enabled. Copy worker can execute with the connected signer."
        : "Monitoring is active. Real swap execution stays locked until EXECUTE_REAL_SWAPS=true is set in Render."),
      ...(state.activity || [])
    ].slice(0, 20);
    await saveState(state);
    send(response, 200, statusPayload(state, { role: "owner", id: "owner" }));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/queue/stop") {
    const stopState = await readState();
    if (requireOwner(response, sessionFromRequest(request, stopState))) return true;
    emergencyStopRequested = true;
    return await withWalletOperation(async () => {
    const state = await readState();
    if (requireOwner(response, sessionFromRequest(request, state))) return true;
    supportedProfiles.forEach((profile) => {
      state.profiles[profile].running = false;
      state.profiles[profile].lastAction = new Date().toISOString();
    });
    state.strategy = { ...structuredClone(defaultState.strategy), ...(state.strategy || {}) };
    state.strategy.paused = false;
    state.strategy.pauseReason = "";
    state.strategy.controlRevision = Math.max(Date.now(), Number(state.strategy.controlRevision || 0) + 1);
    state.activity = [
      line("Trading queue stopped."),
      ...(state.activity || [])
    ].slice(0, 20);
    await saveState(state);
    send(response, 200, statusPayload(state, { role: "owner", id: "owner" }));
    return true;
    }, 1000);
  }

  if (request.method === "POST" && url.pathname === "/api/queue/switch") {
    const state = await readState();
    if (requireOwner(response, sessionFromRequest(request, state))) return true;
    const body = await readBody(request);
    const profile = supportedProfiles.includes(body.profile) ? body.profile : "";
    if (!profile) {
      send(response, 400, { error: "Choose Frog, Deku, or Trunoest." });
      return true;
    }
    if (supportedProfiles.some((item) => state.profiles[item].running)) {
      send(response, 409, { error: "Press Stop Trading before changing trader." });
      return true;
    }
    state.strategy.activeProfile = profile;
    state.strategy.autoSwitch = false;
    state.strategy.controlRevision = Math.max(Date.now(), Number(state.strategy.controlRevision || 0) + 1);
    state.strategy.paused = false;
    state.strategy.pauseReason = "";
    state.activity = [
      line(`Selected ${profileLabel(profile)}. Trading remains stopped until you press Start Trading.`),
      ...(state.activity || [])
    ].slice(0, 20);
    await saveState(state);
    send(response, 200, statusPayload(state, { role: "owner", id: "owner" }));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/queue/keep-current") {
    const state = await readState();
    if (requireOwner(response, sessionFromRequest(request, state))) return true;
    state.strategy = { ...structuredClone(defaultState.strategy), ...(state.strategy || {}) };
    send(response,410,{error:"Use Change Trader, then Start Trading at the top."});
    return true;
  }

  const startMatch = url.pathname.match(/^\/api\/start\/(safe|frog|truenest)$/);
  if (request.method === "POST" && startMatch) {
    const state = await readState();
    if (requireOwner(response, sessionFromRequest(request,state))) return true;
    send(response,410,{error:"Use Change Trader, then Start Trading at the top."});
    return true;
  }

  const stopMatch = url.pathname.match(/^\/api\/stop\/(safe|frog|truenest)$/);
  if (request.method === "POST" && stopMatch) {
    const state = await readState();
    if (requireOwner(response, sessionFromRequest(request, state))) return true;
    const profile = stopMatch[1];
    state.profiles[profile].running = false;
    state.profiles[profile].lastAction = new Date().toISOString();
    if (!supportedProfiles.some((item) => Boolean(state.profiles[item]?.running))) {
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
