# CopyTrade Start & Markets update

This update is for the existing laptop installation at `~/tradelord-copytrade`. It retains account data, login, private signing configuration, balances/history, locked profit, budget and purchase limit. It does not transfer money, create a broker account, subscribe to a provider or press Start.

1. In your current CopyTrade, press **Stop Trading** if it is running.
2. Extract this ZIP into a separate folder. Double-click **Update-Start-Markets.cmd**. Enter your Ubuntu administrator password if asked.
3. Wait for **Start & Markets update installed. Copying is STOPPED.**
4. Open `http://localhost:8088/trade-lord`, choose CopyTrade, and press Ctrl+F5. Sign in with your existing CopyTrade login.
5. On **Solana**, choose the trader under **Change trader**. Review the retained budget and highest-buy limit. Under **Trading options**, save the intended mode. **Exact Copy — My Purchase Limit** follows the source buys/sells subject to the displayed limit and available funds; other modes can exit independently.
6. Run **Check free connection**. Read the visible Start status. When you are ready for real copying, click **Start Trading yourself**. Start checks the feed and available budget and explains failures. Stop disables automatic buys AND sells; it does not liquidate holdings.

The update permits live execution through the existing wallet/signer only after your Start click. Every CopyTrade service restart stops automatic copying until a fresh Start click. Internet, a running laptop, a funded wallet and sufficient SOL for network fees are needed. No particular copying delay, fill price or profit is guaranteed. Existing positions retain their own source's sell monitoring while copying runs; new buys follow ONE selected source at a time.

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

The installer checks the installed code against accepted versions, makes a local backup under `.code-updates`, stops CopyTrade, updates seven code/configuration files, and sets `COPYTRADE_LIVE_TRADING=true` in the existing laptop environment file. The compose file always requires a fresh owner Start after startup. The private password file and `deploy/private-data` are not replaced.

If a code check fails, nothing is replaced. If a build fails, prior code/configuration are restored and services remain stopped. If health checks fail, services are stopped and the error is left visible. Share that error; do not delete data or rerun the full installation/import.

Validated with isolated synthetic accounts and mocked execution checks. No funded trade was placed, no live account was activated here, and Docker startup on your laptop still requires installing this update.
