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
  SystemProgram,
  Transaction,
  clusterApiUrl
} from "@solana/web3.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");
const dataDir = process.env.DATA_DIR || path.join(__dirname, ".data");
const dataFile = path.join(dataDir, "signalpilot-state.json");
const workerIntervalMs = Number(process.env.WORKER_INTERVAL_MS || 15000);
const ownerEmail = (process.env.OWNER_EMAIL || "ebubedikellc@gmail.com").toLowerCase();
const sessionMaxAge = 60 * 60 * 24 * 30;

const defaultState = {
  settings: {
    frogWallet: "4DdrfiDHpmx55i4SPssxVzS9ZaKLb8qr45NKY9Er9nNh",
    frogMax: "420",
    frogMode: "Copy exact amount",
    frogCopySizing: "Copy by percentage",
    frogTraderBankroll: "350",
    truenestWallet: "ardinRsN1mNYVeoJWTBsWeYeXvuR9UUDGMsCDKpb6AT",
    truenestMax: "750",
    truenestMode: "Copy exact amount",
    truenestCopySizing: "Copy by percentage",
    truenestTraderBankroll: "350",
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
    ownerProfitSharePercent: "0",
    ownerFeeWallet: "",
    vaultNote: "Private vault first. Open to users later."
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
  "truenestWallet",
  "truenestMax",
  "truenestMode",
  "truenestCopySizing",
  "truenestTraderBankroll",
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
  state.settings = { ...defaultState.settings, ...(state.settings || {}) };
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
  });
  state.deposits = Array.isArray(state.deposits) ? state.deposits : [];
  state.withdrawals = Array.isArray(state.withdrawals) ? state.withdrawals : [];
  state.sessions = state.sessions && typeof state.sessions === "object" ? state.sessions : {};
  state.activity = Array.isArray(state.activity) ? state.activity : [];
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
  const frog = state.settings.frogTradeWallet || "";
  const truenest = state.settings.truenestTradeWallet || "";
  if (plan === "truenest") return [{ label: "Risk Win", address: truenest }];
  if (plan === "both") return [
    { label: "Smart Win", address: frog },
    { label: "Risk Win", address: truenest }
  ];
  return [{ label: "Smart Win", address: frog }];
}

function customerPublic(customer, state) {
  const deposited = Number(customer.deposited || 0);
  const profit = Number(customer.profit || 0);
  const ownerProfitSharePercent = clampPercent(state.settings.ownerProfitSharePercent);
  const ownerProfitShare = Math.max(0, profit) * (ownerProfitSharePercent / 100);
  const customerNetProfit = profit - ownerProfitShare;
  const withdrawn = Number(customer.withdrawn || 0);
  const withdrawable = deposited + customerNetProfit - withdrawn;
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone || "",
    accessToken: customer.accessToken,
    accessPath: `/player/${customer.accessToken}`,
    plan: customer.plan || "frog",
    status: customer.status || "active",
    deposited,
    profit,
    ownerProfitSharePercent,
    ownerProfitShare,
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
  const ownerProfitShare = customers.reduce((sum, customer) => {
    return sum + (Math.max(0, Number(customer.profit || 0)) * (ownerProfitSharePercent / 100));
  }, 0);
  const pendingWithdrawals = (state.withdrawals || []).filter((item) => item.status === "pending").length;
  return {
    customers: customers.length,
    deposited,
    profit,
    ownerProfitSharePercent,
    ownerProfitShare,
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
      workerIntervalMs
    },
    auth: session ? { role: session.role, id: session.id } : null
  };
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
    s.truenestTradeWallet &&
    s.frogSignerToken &&
    s.truenestSignerToken
  );
}

function profileSetting(state, profile, key, fallback = "") {
  const prefix = profile === "frog" ? "frog" : "truenest";
  const profileKey = `${prefix}${key[0].toUpperCase()}${key.slice(1)}`;
  return state.settings[profileKey] || state.settings[key] || fallback;
}

function profileWalletSync(state, profile) {
  return profileSetting(state, profile, "walletSync", "Turnkey server wallet");
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

function liveTradingAllowed(state, profile = "") {
  if (!ready(state) || process.env.ENABLE_LIVE_TRADING !== "true" || process.env.EXECUTE_REAL_SWAPS !== "true") {
    return false;
  }
  if (!profile) return ["frog", "truenest"].some((item) => liveTradingAllowed(state, item));
  return profileLiveTradingSwitch(state, profile) === "on" && profileWalletSync(state, profile) === "Turnkey server wallet";
}

function profileLabel(profile) {
  return profile === "frog" ? "Smart Win" : "Risk Win";
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

function primarySwapLeg(transaction) {
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

function tradeWallet(state, profile) {
  return profile === "frog" ? state.settings.frogTradeWallet : state.settings.truenestTradeWallet;
}

function signerId(state, profile) {
  return profile === "frog" ? state.settings.frogSignerToken : state.settings.truenestSignerToken;
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
  if (profile !== "frog" && profile !== "truenest") throw new Error("Choose Smart Win or Risk Win wallet.");
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
  const signed = await turnkeyClient(state.settings).signTransaction({
    signWith: signer,
    unsignedTransaction,
    type: "TRANSACTION_TYPE_SOLANA"
  });
  if (!signed?.signedTransaction) throw new Error("Turnkey did not return a signed withdrawal transaction.");

  const signature = await connection.sendRawTransaction(Buffer.from(signed.signedTransaction, "base64"), {
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

function profileMaxUsd(state, profile) {
  const value = Number(profile === "frog" ? state.settings.frogMax : state.settings.truenestMax);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function profileDepositUsd(state, profile) {
  const value = Number(profile === "frog" ? state.settings.frogDeposit : state.settings.truenestDeposit);
  return Number.isFinite(value) && value > 0 ? value : 0;
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

async function executeCopiedSwap(profile, transaction, state) {
  const leg = primarySwapLeg(transaction);
  if (!leg?.inputMint || !leg?.outputMint || !leg?.amount) {
    return { status: "Skipped - unsupported swap format" };
  }

  const wallet = tradeWallet(state, profile);
  const signer = signerId(state, profile) || wallet;
  const apiKey = jupiterApiKey(state.settings);
  if (!wallet || !signer) return { status: "Skipped - trading wallet or signer missing" };
  const copyAmount = scaledCopyAmount(leg.amount, state, profile);

  const order = await jupiterJson("/swap/v2/order", {
    apiKey,
    query: {
      inputMint: leg.inputMint,
      outputMint: leg.outputMint,
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
  if (maxUsd && Number(order.inUsdValue || 0) > maxUsd) {
    if (profileProtectionEnabled(state, profile)) {
      return { status: `Skipped - signal value $${Number(order.inUsdValue).toFixed(2)} is over ${profileLabel(profile)} max $${maxUsd}` };
    }
  }

  const signed = await turnkeyClient(state.settings).signTransaction({
    signWith: signer,
    unsignedTransaction: order.transaction,
    type: "TRANSACTION_TYPE_SOLANA"
  });
  if (!signed?.signedTransaction) throw new Error("Turnkey did not return a signed Solana transaction");

  const executed = await jupiterJson("/swap/v2/execute", {
    apiKey,
    method: "POST",
    body: {
      signedTransaction: signed.signedTransaction,
      requestId: order.requestId,
      lastValidBlockHeight: order.lastValidBlockHeight
    }
  });

  return {
    status: "Executed",
    inputMint: leg.inputMint,
    outputMint: leg.outputMint,
    inputSymbol: leg.inputSymbol,
    outputSymbol: leg.outputSymbol,
    copySizing: profileCopySizing(state, profile),
    copySizingNote: copyAmount.note,
    copiedSourceAmount: String(leg.amount),
    copiedTradeAmount: copyAmount.amount,
    requestId: order.requestId,
    swapUsdValue: order.swapUsdValue,
    outAmount: order.outAmount,
    txid: executed.signature || executed.txid || executed.transactionId || executed.swapTransaction || ""
  };
}

function tradeFromTransaction(profile, transaction, state) {
  const status = liveTradingAllowed(state, profile)
    ? "Observed - execution pending"
    : "Observed - live trading locked";
  const leg = primarySwapLeg(transaction);
  return {
    id: transaction.signature,
    signature: transaction.signature,
    time: transaction.timestamp ? new Date(transaction.timestamp * 1000).toLocaleString("en-US", { hour12: false }) : new Date().toLocaleString("en-US", { hour12: false }),
    profile: profileLabel(profile),
    action: "Copied signal",
    token: leg?.outputSymbol || tokenName(transaction),
    amount: tradeAmount(transaction),
    pnl: 0,
    status
  };
}

async function fetchTransactionsForAddress(apiKey, address) {
  const url = new URL(`https://api.helius.xyz/v0/addresses/${encodeURIComponent(address)}/transactions`);
  url.searchParams.set("api-key", apiKey);
  url.searchParams.set("limit", "10");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Helius returned ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || payload.error || "Helius transaction lookup failed");
  return Array.isArray(payload) ? payload : [];
}

async function runCopyWorkerOnce() {
  const state = await readState();
  const runningProfiles = ["frog", "truenest"].filter((profile) => state.profiles?.[profile]?.running);
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
      .filter((transaction) => !existing.has(transaction.signature) && looksLikeSwap(transaction))
    const newTrades = [];

    for (const transaction of signalTransactions) {
      const trade = tradeFromTransaction(profile, transaction, state);
      if (liveTradingAllowed(state, profile)) {
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
      }
      newTrades.push(trade);
    }

    state.profiles[profile].lastSignature = newest;
    if (newTrades.length) {
      state.trades = [...newTrades, ...(state.trades || [])].slice(0, 100);
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
    const customer = existingCustomer || {
      id: randomUUID(),
      email,
      plan: "frog",
      status: "active",
      deposited: 0,
      profit: 0,
      withdrawn: 0,
      createdAt: new Date().toISOString()
    };
    customer.name = String(body.name || customer.name || email.split("@")[0]).trim().slice(0, 80);
    customer.passwordHash = makePasswordHash(password);
    if (!existingCustomer) state.customers.push(customer);
    const token = createSession(state, "customer", customer.id);
    state.activity = [line(`Customer account created for ${email}.`), ...(state.activity || [])].slice(0, 20);
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
    send(response, 200, statusPayload(state, sessionFromRequest(request, state)));
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

    try {
      const result = await executeSolWithdrawal(state, { profile, destination, amountSol });
      state.withdrawals.push({
        id: randomUUID(),
        owner: true,
        profile,
        amount: result.amountSol,
        asset: "SOL",
        sourceWallet: result.sourceWallet,
        wallet: result.destination,
        txid: result.signature,
        status: "sent",
        createdAt: new Date().toISOString()
      });
      state.activity = [
        line(`${profileLabel(profile)} withdrawal sent: ${result.amountSol} SOL to ${result.destination.slice(0, 6)}...${result.destination.slice(-4)}.`),
        ...(state.activity || [])
      ].slice(0, 20);
      await saveState(state);
      send(response, 200, { withdrawal: result, status: statusPayload(state, { role: "owner", id: "owner" }) });
    } catch (error) {
      state.withdrawals.push({
        id: randomUUID(),
        owner: true,
        profile,
        amount: amountSol,
        asset: "SOL",
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

  const startMatch = url.pathname.match(/^\/api\/start\/(frog|truenest)$/);
  if (request.method === "POST" && startMatch) {
    const state = await readState();
    if (requireOwner(response, sessionFromRequest(request, state))) return true;
    if (!ready(state)) {
      send(response, 400, { error: "Engine Room is not complete yet." });
      return true;
    }
    const profile = startMatch[1];
    state.profiles[profile].running = true;
    state.profiles[profile].lastAction = new Date().toISOString();
    state.activity = [
      line(`${profileLabel(profile)} started.`),
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
