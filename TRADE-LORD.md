# Trade Lord

Owner training room: `/trade-lord`. Uses the existing SignalPilot owner session. No login changes are included in this feature.

## What runs

- An isolated, read-only observer for up to five public Solana wallets. Seeds from the three configured trader wallets, never from signing wallets.
- Verified source swaps fan out from the existing direct feed. A paced recovery loop checks one wallet every 12 seconds and drains up to four transaction lookups. Every read uses the existing provider queue at low priority. It does not start the copy workers or change their settings.
- On first observation it seeds at most 50 recent transactions. Later recovery paginates newer activity from a persisted checkpoint; this is not a complete historical wallet index.
- Durable daily JSONL observation archives plus an atomic memory file in `DATA_DIR/trade-lord`. Recent analysis uses up to 5,000 saved observations. The 100 MB archive limit halts new writes with a visible error instead of deleting evidence. IDs identify retried archive entries after a process crash. Deduplicate archives by `id` when processing them externally.
- Owner knowledge notes, visible Save buttons, evidence chat, and an illustrative chronological holdout replay. Matched exits use FIFO observed inventory; unknown prior holdings, mixed quotes, unavailable prices and fees are not invented. Replay uses a fixed baseline and later 30% of matched exits, not a trained model.
- The observer's existing provider may consume its normal plan credits. No new subscription, paid model or GMGN scraping is enabled. Background operation depends on server uptime and data availability.

## Conversational language model

Without a model, the interface explicitly says **Evidence assistant**. Answers are generated from deterministic statistics and relevant saved lessons. This is not general-purpose AI conversation, and no model weights are trained.

A separately hosted Ollama model can be connected using server environment variables:

```
TRADE_LORD_OLLAMA_URL=http://127.0.0.1:11434
TRADE_LORD_MODEL=qwen3:8b
```

These are optional examples, not an installed model. A suitable licensed open-weight model and a server with enough memory must exist first. No account scraping, ChatGPT session reuse, paid inference fallback or automatic model download occurs. The owner chooses hosting; a model may require additional compute cost.

The adapter checks `/api/tags` and uses `/api/chat` with `stream: false`. It sends only selected public observations, owner knowledge and recent chat. Wallet signing keys and application credentials are never supplied. The model receives no tools and cannot execute trades or modify settings. Notes are untrusted reference material, not instructions. Its answer is a conclusion and evidence, not collected private reasoning. Check the selected model's license before deployment.

Foundations and owner lessons are a retrieval memory. Model outputs are kept only as conversation history; they are not added to the observation dataset or used for model fine-tuning. Trade Lord does not hide from or bypass any provider restrictions.

Official references:
- https://github.com/QwenLM/Qwen3 (open-weight license information)
- https://github.com/ollama/ollama/blob/main/docs/api.md (local chat API)

## Operations and tests

`TRADE_LORD_DISABLED=true` prevents the new recovery timer from starting. Use the training-room Pause button to pause observation including the feed fan-out; it persists without changing live trading.

API routes are `/api/trade-lord`, `/teachers`, `/knowledge`, `/settings`, `/chat`, `/replay` and `/export`. Each requires the existing owner session. Mutations require JSON and reject cross-origin browser requests. Exports contain only the recent sample and owner lessons, not application secrets or model weights.

Run `node --test tests/trade-lord.test.mjs tests/direct-signals.test.mjs tests/rpc-read-pool.test.mjs tests/safety.test.mjs`.

The existing owner-email authentication is inherited, not redesigned here. Do not describe it as stronger authentication than it is. Training data has no additional unauthenticated API route. Training has no withdrawal, signing or trading API.

## Nigerian, UK and US English

The Speech page saves browser dictation locale (`en-NG` / `en-GB` / `en-US`), reply locale, available device voice, reading speed and read-aloud preference. `en-NG` is a request to the browser, not a guarantee that its speech provider supports Nigerian English. Unavailable voices are disclosed with a fallback. The microphone fills an editable draft; it never sends a message or trading command automatically. Browser speech services may process audio remotely. This app does not store microphone audio.

Owner expressions are saved as Speech knowledge notes and can be retrieved in chat. Three original speech foundations cover respectful comprehension, this owner's contextual expressions and evaluation. They are text context, not acoustic model weights.

The reference catalogue contains thirteen YouTube links (including three US English pronunciation lessons), one documented Igbo English speaker from IDEA, and two licensed corpus candidates: OpenSLR 70 (Google, Inc., CC BY-SA 4.0) and VCTK 0.92 (Yamagishi, Veaux and MacDonald, University of Edinburgh, CC BY 4.0). Metadata and licences were checked on 27 October 2026; playback and full content have not been audited. Informal accent challenges are marked as such. Pidgin is separately labelled. Neither the videos nor the archive recording are assumed licensed for model training. No audio, captions, music or movies are downloaded, no content extraction runs, and no speech training job exists. Status explicitly remains not running. Reference links do not enter model context as if their contents were read.

Future speech adaptation requires a separately provisioned speech model, rights-verified recordings and transcripts, attribution/licence records, speaker-separated train/evaluation splits and measured transcription/intent accuracy. Corpus downloads exceed the application's small trading-data disk and are intentionally not started. Do not silently enable paid compute, clone a speaker's voice, or represent a language setting as training.

Source catalogue: `lib/trade-lord-speech.mjs`. Official browser references: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/lang and https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices.
