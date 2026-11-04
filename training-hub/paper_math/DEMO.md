# Forward paper demo — prepared, not deployed

The owner requested a demo inside Trade Lord which follows the changing market without money. `/paper-demo` is a server-run, seven-day forward paper experiment. It uses newly observed public market data, not invented future outcomes. No real order endpoint, credentials, exchange account, wallet, paid API, Discord message or model-training operation is included.

## Coverage and limits

The implemented adapter covers **DOGE/USD on Kraken** only. Its public REST order book, asset metadata, exchange status and five-minute candles require no account connection. Public endpoint reads succeeded in this development environment. A successful public read does not establish continued availability from the VPS. Gold/XAUUSD, stocks, options and other meme coins remain explicitly unavailable. They require their own verified feeds and execution models. A token representing gold is not silently substituted for XAUUSD. Option prices are never derived from underlying prices.

The demo knows only received observations. It does not know future prices, every venue, hidden liquidity, market impact or queue priority. Fifteen-second observation sampling can miss intrapoll moves; it is not a tick-complete historical replay or a guarantee of real fills. Results demonstrate behavior under the declared simulator, not actual trading profitability.

## Frozen experiment rules

The protocol is frozen and hashed before each model request. It is not an automatic strategy optimizer:

- Long, unleveraged, whole DOGE tokens. Latest **completed** five-minute close must exceed the previous completed candle's high. The provider's final unfinished OHLC candle is excluded.
- Frozen entry limit = observed ask × 1.001. Stop = entry × 0.985. Target = entry × 1.05. Frozen entry rounds up and stop/target down to the venue price tick; simulated buys round up and sells down. Net planned reward/risk must be at least 1.5.
- Risk at most $25 and 0.5% of the smaller virtual account equity; at most $1,000 cash. Quantity is capped by risk, cash and 10% of displayed best bid/ask quantities. Venue size/notional minimums are checked.
- Simulated commission is fixed at 0.4% of the frozen entry price per token **on each side**. This is an explicit model assumption, not a verified account fee tier. Entry and stop exits include 0.1% adverse price adjustment. The spread is included in bid/ask prices. The stop adjustment is included in sizing; it is not charged again as a separate fee.
- A setup expires after 20 minutes. After the model finishes, one immediate all-or-none entry attempt uses a **new** public book observation. Never fill retrospectively at the old quote. Reject an over-limit price, a crossed stop/target, insufficient liquidity/cash, invalid size or missing data. No resizing or partial fill is invented.
- Stops trigger on an observed bid at/below stop and fill at observed bid minus 0.1%, including gaps. A triggered stop waits if displayed exit liquidity is inadequate. Targets require adjusted bid at/above the target and fill at the target conservatively. A target waiting for liquidity cannot disable a later stop.
- Time exit after 30 minutes or at the seven-day deadline uses the next eligible observed bid. An observation interruption over 45 seconds while a position is open makes it UNRESOLVED and pauses the run; the program does not guess the order of unobserved stop/target hits.

“Non-stop” means a background worker can observe while the web page is closed. It does **not** mean a forced trade on every iteration. Feed failures, occupied model queue, unfinished notes, no signal, missing liquidity, expired setup and unknown status all prevent new entries. There is at least one minute between completed cases and no repeated question on the same completed candle. The seven-day deadline never extends on resume.

## Decision, checks, results and learning

The model sees only the current setup and required JSON fields. Its raw completed answer is recorded before execution simulation. A deterministic calculator separately produces a checked answer from the same frozen inputs. Separate virtual accounts retain the original and checked decisions; the latter never replaces the model's original grade or P/L. An original decision may fail the calculation check yet earn a simulated profit, or pass and lose.

The source note must already be ready, and its actual saved text and revision time are retained with the precommit. Source and free-text rationale are not automatically certified by numeric checks. Unsupported or malformed output is NOT VERIFIED, not guessed from prose.

Reports and rule-derived explanations are displayed for **owner review only**. They are not sent to Trade Lord, saved as lessons or used to alter model weights. This preserves the existing pause on generated teaching feedback; it does not claim that the requested AI-learning loop has been authorized, implemented or proven effective. No feature guarantees winning or error-free answers.

## Durability and concurrency

`paper-demo.sqlite` is separate from existing sources, lessons, chat history, `paper-math.sqlite` and the historical eleven-case ledger. New accounts start with virtual $5,000. Inputs, rule/rubric hash, source snapshot, original answer, assessment, each observation and result are append-only events. Pause status is the only mutable control state. Old events are not overwritten or silently rescored.

A process lock protects the reservation/submission step. The existing shared question queue prevents a simultaneous model request. Recovery always runs first. The callback persists a returned answer even if its caller disappears. A reserved request with unknown submission status or a lost in-memory job pauses, without automatic resubmission. Unresolved positions block subsequent cases and new runs. Closed and discrete-observation drawdowns are reported separately; missing exit evidence is not recorded as zero loss. Displayed main equity is closed-position equity, with open positions shown separately.

History is paginated in groups of twenty; `GET /api/paper-demo/status?offset=20` reads earlier records. No deletion endpoint exists. A new session is only possible after the prior deadline and resolution of all records.

## Validation and deployment status

Run:

```sh
PYTHONPATH=training-hub python3 -m unittest -q test_paper_demo test_paper_math test_answer_fix test_question_repair
node --test training-hub/test_paper_panel.mjs training-hub/test_demo_panel.mjs
```

Local validation: 79 Python tests and seven JavaScript tests passed. The desktop preview was visually inspected with clearly labeled fixture data; it is not the live site. Automated coverage includes gaps, latency, fresh entry prices, no fills, fee arithmetic, whole-position liquidity, latched stops, interrupted observations, minimum sizes, malformed output, pending recovery, no feedback leakage, fixed seven-day limits and separate grade/P&L records. Fixtures are labeled as fixtures; test outcomes are not added to the owner ledger. A live Trade Lord JSON response and a running seven-day session have **not** been verified.

The VPS installation connection is unreachable from this environment. Nothing has been deployed, started, merged or activated on the real site. The server worker has no active session until the owner starts one. Follow the staging and history-preservation instructions in `README.md`; never replace the running site with the older repository baseline. Copy the new module and patch only staged copies of the actual running web files. Verify the candidate on the current web image and preserve rollback and existing data before activation. Do not restart source/model workers or retry failed source jobs.

## Provider references

- https://docs.kraken.com/api-reference/market-data/get-order-book — aggregated level-two prices and quantities.
- https://docs.kraken.com/api-reference/market-data/get-ohlc-data — the final candle is unfinished; exclude it.
- https://docs.kraken.com/api-reference/market-data/get-tradable-asset-pairs — instrument identity, status and quantity/notional minimums.

Read-only requests are restricted to a fixed HTTPS host and four public endpoints. Redirects, oversized responses, stale/future timestamps, crossed books, wrong instruments and unexpected schemas fail closed. No arbitrary URL, credential field or trading mode can be supplied through the demo control endpoints.
