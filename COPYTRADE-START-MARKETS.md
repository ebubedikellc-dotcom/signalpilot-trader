# CopyTrade trader amounts, Start & Markets update

This update is for the existing laptop installation at `~/tradelord-copytrade`. It retains account data, login, private signing configuration, balances/history, locked profit, budget and purchase limit. It does not transfer money, create a broker account, subscribe to a provider or press Start.

1. In your current CopyTrade, press **Stop Trading** if it is running.
2. Extract this ZIP into a separate folder. Double-click **Update-Trader-Amounts.cmd**. Enter your Ubuntu administrator password if asked.
3. Wait for **CopyTrade update installed, including trader amounts. Copying is STOPPED.**
4. Open `http://localhost:8088/trade-lord`, choose CopyTrade, and press Ctrl+F5. Sign in with your existing CopyTrade login.
5. On **Solana**, choose the trader under **Change trader**. Review the retained budget and highest-buy limit. Under **Trading options**, save the intended mode. **Exact Copy — My Purchase Limit** follows the source buys/sells subject to the displayed limit and available funds; other modes can exit independently.
6. Run **Check free connection**. Read the visible Start status. When you are ready for real copying, click **Start Trading yourself**. Start checks the feed and available budget and explains failures. Stop disables automatic buys AND sells; it does not liquidate holdings.

The update permits live execution through the existing wallet/signer only after your Start click. Every CopyTrade service restart stops automatic copying until a fresh Start click. Internet, a running laptop, a funded wallet and sufficient SOL for network fees are needed. No particular copying delay, fill price or profit is guaranteed. Existing positions retain their own source's sell monitoring while copying runs; new buys follow ONE selected source at a time.

## Trader amounts — information, not a requirement to match their balance

Under **Change trader**, highlight a trader, then click **Check trader amounts**. You can inspect a different trader before clicking **Use this trader**. The panel shows the latest verified buy in a small sample, the median buy size separately for each quote currency, current native SOL and USDC balances of that source wallet, and when the lookup ran. It also shows your saved budget and per-purchase limit. These checks do not select a trader, change limits or send trades.

Both existing sizing choices remain unchanged:

- **Exact Copy — My Purchase Limit:** copy up to your chosen per-buy limit, within your available funds and total budget. For example, a source buy valued at $50 is capped at $10 if your saved highest buy is $10. A smaller $5 source buy stays $5. If even the capped amount exceeds available funds, the current exact mode skips it rather than spending more than you have.
- **Exact Copy — Trader’s Full Amount:** attempt the source buy’s full value only when your available funds and total budget allow it. It does not require the same total wallet balance as the source.

The original amount they started with cannot be established from the current balance or recent transactions, so it is marked **Not verified**. Wallet balances exclude other tokens, open positions and other wallets. SOL/USDC/USDT trade amounts are not mixed or converted into dollars. The existing source decoder reads confirmed swap balance changes; complex or unsupported transactions are omitted. This is a sample of up to eight recent transactions, not a full trading history or evidence of profitability.

Lookups are owner-only, read-only and cached for one minute. Missing values are marked unavailable, not zero. Fresh scans are deferred while copying runs; in-flight scans stop requesting more data if copying starts. Reads use the existing connection with lower priority than trade verification. No extra subscription, AI model or Ollama processing is needed for this display.

This ZIP includes the earlier Start & Markets changes; you do not need to install that ZIP first. The amounts panel does not add live gold/forex copying.

**Add trader** accepts a name and public Solana wallet. It uses your existing funded account and shared limits. Adding or selecting a source never starts trading.

**Set up account** stores an account entry. It does not create or connect a brokerage account. Gold XAU/USD and Forex EUR/USD require a compatible broker integration which is not implemented in this update. These pages cannot place gold/forex orders.

## Provider research — checked 15 November 2026

GOLD ORBIT on cTrader is included as a **research candidate**, not a validated recommendation or active subscription. The public page listed 0% performance fee, 0% annual management fee, $0 volume fee, $100 minimum, active since 10 April 2026, 10.72% maximum **balance** drawdown, and approximately 99.87% gold trading volume, with some index trades. Historical equity drawdown, broker access and account suitability remain unverified. A broker can still charge spreads, commissions and overnight financing. Recheck current terms before considering any provider.

- Public strategy: https://app.ctrader.com/copy/strategy/115140
- Fee explanation: https://help.ctrader.com/ctrader-copy/fees-calculation/
- Statistics explanation: https://help.ctrader.com/ctrader-copy/account-and-strategy-page/
- Broker/account requirements: https://help.ctrader.com/ctrader-copy/investing-in-strategies/
- EUR/USD directory: https://ctrader.com/copy/symbols/eurusd

No suitable free EUR/USD provider has been verified for your account. Listings alone do not establish a reliable strategy or expected return. This update does not label Frog or any other source as guaranteed profitable.

## Update and recovery

The installer checks the installed code against accepted versions, makes a local backup under `.code-updates`, stops CopyTrade, updates nine code/configuration files, and sets `COPYTRADE_LIVE_TRADING=true` in the existing laptop environment file. The compose file always requires a fresh owner Start after startup. The private password file and `deploy/private-data` are not replaced.

If a code check fails, nothing is replaced. If a build fails, prior code/configuration are restored and services remain stopped. If health checks fail, services are stopped and the error is left visible. Share that error; do not delete data or rerun the full installation/import.

Validated with isolated synthetic accounts and mocked execution checks. No funded trade was placed, no live account was activated here, and Docker startup on your laptop still requires installing this update.
