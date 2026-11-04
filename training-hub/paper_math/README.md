# Paper calculator and checker 1.2.0

Status: prepared and locally tested; NOT deployed to the VPS. This is an additive owner-panel tool. The optional [forward demo](DEMO.md) adds public-data paper simulation; there is no real trading or model-training change.

## Components

- Python Decimal performs bounded arithmetic. It is included with Python.
- Pydantic 2.14.1 validates strict input schemas and relationships.
- Explicit Python rules calculate candle bodies, long/short risk, fixed and per-unit costs, stop-fill allowances, maximum size, cash, margin and entry/exit liquidity.
- `/paper-math` adds a mobile-friendly calculator and fictional paper-setup form.
- `POST /api/paper-math/submit` uses the existing question queue and model transport. It sends input facts and a JSON output contract, **not the expected answer**. Existing chat/questions are unchanged.
- Completed answers are retained exactly as returned by the existing chat function. An independent calculation checks them, then supplies the main paper result. Supported numeric and rule mistakes produce a **CORRECTED** result; the original answer and its FAIL assessment remain unchanged in history. A matching numeric decision produces **CHECKED**. There is no correction prompt, lesson saving, model feedback loop, broker call or market data.
- The AI must return the required JSON. Prose, missing fields, duplicate JSON keys, unknown fields and invalid types become NOT VERIFIED, not guessed values.
- The checker does not yet provide calculator tool calls inside Qwen generation. It checks the returned decision independently. A later tool-calling integration would be separate work.

## Corrected final result

After a completed structured AI decision, `review()` keeps the original `check()` assessment and separately assembles an answer from the frozen setup and deterministic calculation. It recalculates action, maximum size, entry/stop/target, fees, planned risk, net target reward, margin and cash. Wrong order levels, excessive size, mistaken BUY/SELL_SHORT/NO_TRADE and wrong totals are covered only for the explicitly supported rules. The corrected answer must itself pass the numeric consistency check before publication. A passing check is not independent evidence that the market facts or strategy are sound.

The main screen displays that independently calculated answer and its origin. It generates a bounded explanation from the selected rules instead of forwarding an unverified AI rationale. Source text is labeled as the owner's supplied reference, with contents unverified. The raw answer and original PASS/FAIL/NOT_VERIFIED assessment are available in history; a corrected answer never upgrades the original model grade or changes its simulated P/L. No fills are assumed. Nothing is fed back to the model, and no second question is submitted.

Missing/invalid setup fields, unsupported rules, unstructured or incomplete decisions, unfinished generation and checker failures produce **NOT VERIFIED**, with no accepted final decision. This feature does not rewrite the ordinary chat endpoint, solve arbitrary mathematics or guarantee any market outcome. Use the separate `/paper-math` desk.

Assessments and the resulting final answer are recorded once in a separate `checked_results` table, with the checker version and timestamp. Reads do not silently recalculate previously recorded results. Existing paper-desk records lacking an assessment receive one on their first completed-result read; their raw answers and setup remain unchanged. No ordinary question-history or lesson records are changed.

## What is checked

One selected rule: completed close above/below a threshold, or long/short displacement (latest directional body larger than previous body, closing beyond the previous extreme). Only a simple **linear USD** valuation is supported. These are explicit fictional test rules, not profitable strategies. Other patterns require their own specified, tested conditions; the system must not pretend they are covered.

Risk = quantity × (absolute stop distance × value per point + per-unit fees + stop allowance) + fixed round-trip fees.
Target reward = quantity × (absolute target distance × value per point - per-unit fees) - fixed round-trip fees.
Size is floored to the allowed step and capped by risk, cash, margin, and both entry and exit liquidity. Fixed fees apply only to a positive position. The stop allowance is sizing exposure, not an extra actual fee. Ratio thresholds are checked by multiplication, before display rounding.

Cash mode is unleveraged long only, value per point = 1. Margin mode reserves margin plus entry costs from available cash. Decimal input precision is bounded to 12 integer and 18 fractional digits so small-token fees and stop allowances remain exact. Input all prices/amounts as decimal strings, e.g. `"0.30"`, never binary floats. OHLC prices must be consistent. NaN, infinity, extreme precision, unknown fields and live mode are refused.

PASS is the **original model's numeric/rule assessment** on the supplied inputs. A separate final result may be CORRECTED while that original grade remains FAIL. Source label equality is checked, but source contents, truth of input facts, rationale quality, future prices and fills are **not** verified. Never connect this result to real orders. The calculator desk itself changes no P/L or equity ledger. The separate forward demo maintains its own virtual ledgers.

## Validation performed

`PYTHONPATH=training-hub python3 -m unittest -v test_paper_math test_answer_fix test_question_repair`

`node --test training-hub/test_paper_panel.mjs`

28 calculator/checker tests plus 17 existing question/answer tests pass locally (the repository installer's generated model-lock module is supplied as a fixture). Coverage includes decimal arithmetic, bounded expressions, long/short directions, candle body vs range, costs, risk/cash/margin/liquidity, exact ratio boundaries, corrected and rejected decisions, unchanged original answers, a single model call with no feedback, persisted assessments and failure handling. Three panel tests execute the actual inline JavaScript against a DOM stub, using actual Python review output to confirm that corrected figures lead, original failures remain visible and stale results clear. This is not visual browser QA or live Qwen compatibility verification.

See `benchmark.json` for 2,000 local timings of a completed check and correction. This does not measure Qwen, network latency or the live VPS. Python 3.11 Linux wheels were previously downloaded successfully; the local execution environment is Python 3.12.

## Deployment handoff: requires the running VPS

The GitHub branch's baseline server predates runtime patches. **Do not replace the running server, training panel, question modules or full image with this branch's older versions.** Copy the current live server.py and training.html into a private staging directory and run `install_paper_math.py STAGING_DIRECTORY` on those copies. It refuses an unknown startup/queue/panel layout before changing either file. Add this `paper_math/` directory beside the staged server.py.

The operator must inspect current Compose configuration and running web image, retain an image/configuration rollback, preserve the hub-data/model volumes and archived question history, and ensure no question is pending. The existing in-memory question queue loses history on restart: export and verify all retained question records before any recreation. This patch does not add an export endpoint or make that old history durable automatically. The deployment should layer the new files and Pydantic dependency over the actual running **web** image, validate imports and tests inside that candidate, and recreate only web using the existing project, volumes and gateway. Do not rebuild or restart video/PDF/model workers, retry jobs, reset storage or change authentication.

After activation verify `/api/paper-math/health`, the old control-panel routes, existing source/question records, and the calculator. Run one explicitly precommitted independent fictional case to validate real Qwen JSON compatibility before claiming AI integration works. A failed/unfinished answer stays NOT VERIFIED. If the integration fails, restore the prior web image/configuration with the same data volumes. Do not remove any volume.

This task could read the site but could not reach its SSH installation connection (`Network is unreachable`). No live deployment, worker restart or model test was performed. A source patch and local tests are not evidence of live installation.

## Data and size

A small separate `paper-math.sqlite` in the existing data directory retains submitted setups, returned answers and versioned assessments/corrected results. It does not alter source lessons. Records are not automatically deleted; archive them under the owner's retention policy. Credentials and wallets are not stored. Pydantic + dependencies measured about 9.8 MB in the local runtime; the CPython 3.11 Linux wheel downloads total about 2.7 MB compressed. Exact installed size varies. There is no subscription or per-check fee. Existing server hosting remains separate.

## Sources

- https://github.com/pydantic/pydantic (MIT library)
- https://docs.pydantic.dev/latest/concepts/validators/
- https://docs.pydantic.dev/latest/concepts/strict_mode/
- https://docs.python.org/3/library/decimal.html
