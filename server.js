import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");
const dataDir = process.env.DATA_DIR || path.join(__dirname, ".data");
const dataFile = path.join(dataDir, "signalpilot-state.json");
const workerIntervalMs = Number(process.env.WORKER_INTERVAL_MS || 15000);

const defaultState = {
  settings: {
    frogWallet: "4DdrfiDHpmx55i4SPssxVzS9ZaKLb8qr45NKY9Er9nNh",
    frogMax: "420",
    frogMode: "Copy exact amount",
    truenestWallet: "ardinRsN1mNYVeoJWTBsWeYeXvuR9UUDGMsCDKpb6AT",
    truenestMax: "750",
    truenestMode: "Copy exact amount",
    walletSync: "Turnkey server wallet",
    riskControl: "on",
    liveTradingSwitch: "on",
    vaultMode: "private",
    vaultFeePercent: "0",
    ownerFeeWallet: "",
    vaultNote: "Private vault first. Open to users later."
  },
  profiles: {
    frog: { running: false, profit: 0, lastAction: null, lastSignature: null },
    truenest: { running: false, profit: 0, lastAction: null, lastSignature: null }
  },
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
    return JSON.parse(await readFile(dataFile, "utf8"));
  } catch {
    return structuredClone(defaultState);
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

function send(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function clean(input) {
  const out = {};
  for (const field of fields) {
    if (typeof input[field] === "string") out[field] = input[field].trim();
  }
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

function liveTradingAllowed(state) {
  return state.settings.liveTradingSwitch === "on" && process.env.ENABLE_LIVE_TRADING === "true";
}

function profileLabel(profile) {
  return profile === "frog" ? "Frog beginner" : "Truenest Big Win";
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

function tradeFromTransaction(profile, transaction, state) {
  const status = liveTradingAllowed(state)
    ? "Observed - signer execution needed"
    : "Observed - live trading locked";
  return {
    id: transaction.signature,
    signature: transaction.signature,
    time: transaction.timestamp ? new Date(transaction.timestamp * 1000).toLocaleString("en-US", { hour12: false }) : new Date().toLocaleString("en-US", { hour12: false }),
    profile: profileLabel(profile),
    action: "Copied signal",
    token: tokenName(transaction),
    amount: tradeAmount(transaction),
    pnl: 0,
    status
  };
}

async function fetchTransactionsForAddress(apiKey, address) {
  const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "signalpilot-copy-worker",
      method: "getTransactionsForAddress",
      params: [address, { limit: 10 }]
    })
  });
  if (!response.ok) throw new Error(`Helius returned ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || "Helius transaction lookup failed");
  return Array.isArray(payload.result) ? payload.result : [];
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
    const newTrades = unseen
      .reverse()
      .filter((transaction) => !existing.has(transaction.signature) && looksLikeSwap(transaction))
      .map((transaction) => tradeFromTransaction(profile, transaction, state));

    state.profiles[profile].lastSignature = newest;
    if (newTrades.length) {
      state.trades = [...newTrades, ...(state.trades || [])].slice(0, 100);
      state.activity = [
        line(`${profileLabel(profile)} worker found ${newTrades.length} new swap signal${newTrades.length === 1 ? "" : "s"}.`),
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
    send(response, 200, { ok: true, liveTrading: process.env.ENABLE_LIVE_TRADING === "true" });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/status") {
    const state = await readState();
    send(response, 200, {
      ...state,
      backend: {
        liveTrading: process.env.ENABLE_LIVE_TRADING === "true",
        workerIntervalMs
      }
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/settings") {
    const state = await readState();
    state.settings = { ...state.settings, ...clean(await readBody(request)) };
    state.activity = [line("Engine Room saved."), ...(state.activity || [])].slice(0, 20);
    await saveState(state);
    send(response, 200, state);
    return true;
  }

  const startMatch = url.pathname.match(/^\/api\/start\/(frog|truenest)$/);
  if (request.method === "POST" && startMatch) {
    const state = await readState();
    if (!ready(state)) {
      send(response, 400, { error: "Engine Room is not complete yet." });
      return true;
    }
    const profile = startMatch[1];
    state.profiles[profile].running = true;
    state.profiles[profile].lastAction = new Date().toISOString();
    state.activity = [
      line(`${profile === "frog" ? "Frog beginner" : "Truenest Big Win"} started.`),
      line(liveTradingAllowed(state)
        ? "Live trading switch is on. Copy worker is allowed to execute after wallet signer is connected."
        : "Monitoring is active. Live swap execution stays locked until Render live trading is enabled."),
      ...(state.activity || [])
    ].slice(0, 20);
    await saveState(state);
    send(response, 200, state);
    return true;
  }

  const stopMatch = url.pathname.match(/^\/api\/stop\/(frog|truenest)$/);
  if (request.method === "POST" && stopMatch) {
    const state = await readState();
    const profile = stopMatch[1];
    state.profiles[profile].running = false;
    state.profiles[profile].lastAction = new Date().toISOString();
    state.activity = [
      line(`${profile === "frog" ? "Frog beginner" : "Truenest Big Win"} stopped.`),
      ...(state.activity || [])
    ].slice(0, 20);
    await saveState(state);
    send(response, 200, state);
    return true;
  }

  return false;
}

function serveFile(response, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
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
