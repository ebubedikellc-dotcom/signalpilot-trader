# Trade Lord

Conversation face: `/trade-lord`. Private training controls: `/control-panel/trade-lord`, linked from the existing owner control panel. Uses the existing SignalPilot owner session. No login changes are included in this feature.

## What runs

- An isolated, read-only observer for up to five public Solana wallets. Seeds from the three configured trader wallets, never from signing wallets.
- Verified source swaps fan out from the existing direct feed. A paced recovery loop checks one wallet every 12 seconds and drains up to four transaction lookups. Every read uses the existing provider queue at low priority. It does not start the copy workers or change their settings.
- On first observation it seeds at most 50 recent transactions. Later recovery paginates newer activity from a persisted checkpoint; this is not a complete historical wallet index.
- Durable daily JSONL observation archives plus an atomic memory file in `DATA_DIR/trade-lord`. Recent analysis uses up to 5,000 saved observations. The 100 MB archive limit halts new writes with a visible error instead of deleting evidence. IDs identify retried archive entries after a process crash. Deduplicate archives by `id` when processing them externally.
- Owner knowledge notes, visible Save buttons, evidence chat, and an illustrative chronological holdout replay. Matched exits use FIFO observed inventory; unknown prior holdings, mixed quotes, unavailable prices and fees are not invented. Replay uses a fixed baseline and later 30% of matched exits, not a trained model.
- The observer's existing provider may consume its normal plan credits. No new subscription, paid model or GMGN scraping is enabled. Background operation depends on server uptime and data availability.

## Conversational language model

Without a model, the interface explicitly says **Saved-knowledge answers · full conversation model not connected**. Answers are generated from deterministic statistics and relevant saved lessons. This is not general-purpose AI conversation, and no model weights are trained.

A separately hosted Ollama model can be connected using server environment variables:

```
TRADE_LORD_OLLAMA_URL=http://127.0.0.1:11434
TRADE_LORD_MODEL=qwen3:8b
```

These are optional examples, not an installed model. A suitable licensed open-weight model and a server with enough memory must exist first. No account scraping, ChatGPT session reuse, paid inference fallback or automatic model download occurs. The owner chooses hosting; a model may require additional compute cost.

The adapter checks `/api/tags` and uses `/api/chat` with `stream: false`. It sends only selected public observations, owner knowledge and recent chat. Wallet signing keys and application credentials are never supplied. The model receives no tools and cannot execute trades or modify settings. Separately, the server handles exact owner commands to remember a lesson, pause observation or resume observation; an action response is emitted only after its durable save succeeds. Notes are untrusted reference material, not instructions. Its answer is a conclusion and evidence, not collected private reasoning. Check the selected model's license before deployment.

Foundations and owner lessons are a retrieval memory. Model outputs are kept only as conversation history; they are not added to the observation dataset or used for model fine-tuning. Trade Lord does not hide from or bypass any provider restrictions.

Official references:
- https://github.com/QwenLM/Qwen3 (open-weight license information)
- https://github.com/ollama/ollama/blob/main/docs/api.md (local chat API)

## Operations and tests

`TRADE_LORD_DISABLED=true` prevents the new recovery timer from starting. Use the private training settings Pause observation button to pause observation including the feed fan-out; it persists without changing live trading.

API routes are `/api/trade-lord`, `/teachers`, `/knowledge`, `/settings`, `/chat`, `/replay` and `/export`. Each requires the existing owner session. Mutations require JSON and reject cross-origin browser requests. Exports contain only the recent sample and owner lessons, not application secrets or model weights.

Run `node --test tests/trade-lord.test.mjs tests/direct-signals.test.mjs tests/rpc-read-pool.test.mjs tests/safety.test.mjs`.

The existing owner-email authentication is inherited, not redesigned here. Do not describe it as stronger authentication than it is. Training data has no additional unauthenticated API route. Training has no withdrawal, signing or trading API.

## Nigerian, UK and US English

The private training settings save browser dictation locale (`en-NG` / `en-GB` / `en-US`), reply locale, available device voice, reading speed and read-aloud preference. `en-NG` is a request to the browser, not a guarantee that its speech provider supports Nigerian English. Unavailable voices are disclosed with a fallback. After the owner taps Talk to me, the microphone shows an interim transcript and sends the final recognized text to chat when speech ends. It does not restart itself, and stops when the page is hidden or the session expires. Chat has no transaction tools. Type instead if recognition is unavailable or inaccurate. Browser speech services may process audio remotely. This app does not store microphone audio.

Owner expressions are saved as Speech knowledge notes and can be retrieved in chat. Three original speech foundations cover respectful comprehension, this owner's contextual expressions and evaluation. They are text context, not acoustic model weights.

The reference catalogue contains thirteen YouTube links (including three US English pronunciation lessons), one documented Igbo English speaker from IDEA, and two licensed corpus candidates: OpenSLR 70 (Google, Inc., CC BY-SA 4.0) and VCTK 0.92 (Yamagishi, Veaux and MacDonald, University of Edinburgh, CC BY 4.0). Metadata and licences were checked on 27 October 2026; playback and full content have not been audited. Informal accent challenges are marked as such. Pidgin is separately labelled. Neither the videos nor the archive recording are assumed licensed for model training. Reference URLs are not downloaded or ingested. Separately uploaded, permissioned videos use the processing pipeline below; this does not train a speech recognition model. Reference links do not enter model context as if their contents were read.

Future speech adaptation requires a separately provisioned speech model, rights-verified recordings and transcripts, attribution/licence records, speaker-separated train/evaluation splits and measured transcription/intent accuracy. Corpus downloads exceed the application's small trading-data disk and are intentionally not started. Do not silently enable paid compute, clone a speaker's voice, or represent a language setting as training.

Source catalogue: `lib/trade-lord-speech.mjs`. Official browser references: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/lang and https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices.

## Interface changes

The conversation face has one microphone, a message field, saved conversation and a speak-replies preference. Classrooms and looping video players are removed from the visible interface. Training, voice settings, notes, watched traders and exports are available only in the owner settings. Existing login, wallet configuration and trading controls are unchanged.

Previously saved video catalogue metadata and playback preferences remain compatible with old memory files. The 12 official CME/OIC/ASX course links and eight original written trading notes remain reference metadata and written knowledge; linking a course does not ingest it. No learning from Gwen, chart understanding, profitable strategy or model-weight training is implied.

## Permissioned video knowledge

Owner flow: choose up to six videos -> Save videos & start processing -> saved queue -> processor -> ready to reference. Supported containers are MP4/MOV/M4V and WebM, up to 100 MB and 60 minutes each. The server reserves capacity before streaming bytes to disk, checks file signatures, rejects incomplete uploads, and never buffers the whole file in memory. Total retained videos are limited to 30 and 500 MB. A persistent `DATA_DIR` disk is required. Upload must finish before closing the page.

`lib/trade-lord-training.mjs` keeps source videos and an atomically saved index below `DATA_DIR/trade-lord/videos`. Only completed, nonempty transcripts are indexed. Each passage includes source video, start/end time, extraction type and coverage limits. Relevant passages enter evidence answers or the separately connected conversation model's reference context. They are untrusted source material, never executable instructions or proof of factual accuracy. Removing a video removes its passages from future retrieval (past conversation messages remain). Owner export includes saved passages, but no worker credential or leases.

No processor is bundled into the trading web process. An external worker polls a narrow authenticated queue, processes one job at a time, renews a lease while working, and submits results. Expired leases are recoverable and old results cannot overwrite a newly claimed job. Failed/empty jobs remain visibly failed; uploads with no connected worker remain visibly waiting. On restart, interrupted uploads require the original file again. Retry does not duplicate existing knowledge.

Endpoints under `/api/trade-lord/training`:
- Owner: GET status; POST metadata; POST `/:id/file` raw streamed bytes; GET `/:id/transcript`; POST `/:id/retry`; DELETE `/:id`.
- Worker: POST `/worker/claim`; GET `/worker/:id/file` with job lease; POST `/worker/:id/progress`; POST `/worker/:id/complete`.

Owner operations inherit the existing owner session and reject cross-origin browser mutations. Worker routes additionally require a dedicated bearer secret of at least 32 characters; an owner session alone does not authorize a worker call. Downloads require an active lease. This key has no wallet signing or trade-execution permissions. The worker cannot browse arbitrary server files or fetch arbitrary user-supplied URLs.

## Connecting the video processor

Prepared implementation: `workers/trade_lord_video.py`; container recipe: `workers/Dockerfile`. It uses faster-whisper 1.2.1 (CPU int8, two threads), FFmpeg and Tesseract. Use a separate compute host with enough RAM for the selected model; the default small model needs materially more memory than the existing starter trading service. Compute is not automatically purchased, provisioned or enabled.

Set the **same newly generated secret** privately on the web server and worker:

```
TRADE_LORD_VIDEO_WORKER_TOKEN=<random-secret-at-least-32-characters>
```

Set on the worker only:

```
TRADE_LORD_SITE_URL=https://signalpilot-trader.onrender.com
TRADE_LORD_WHISPER_MODEL=small
```

Build from the repository root using `docker build -f workers/Dockerfile -t trade-lord-video .`, then supply those variables as runtime secrets. Do not commit secrets or put them in command-line arguments. The first audio job downloads the selected open-source speech model unless it is already cached. Persist the worker's Hugging Face cache if the host supports it. No paid transcription API is configured. CPU time, storage and hosting may still cost money.

The worker reads speech, filters likely silence, and samples English OCR every 30 seconds. It does **not** interpret chart geometry, gestures, animation or every frame. A silent chart cannot be treated as fully understood. Transcription/OCR can misread accents, ticker symbols and numbers; retain timestamps and check critical details. The UI reports these limits with every completed video. Training here means durable reference knowledge, not changing model weights or proving a trading strategy.

Worker HTTP calls refuse redirects. Media decoders are restricted to local file/pipe protocols; processing runs in a child without the worker API token, with a one-hour deadline. Container execution uses an unprivileged user. This worker polls only the authorized site and does not scrape or download YouTube.

Validation: `node --test tests/trade-lord-training.test.mjs tests/trade-lord-study.test.mjs tests/trade-lord.test.mjs` covers persistence, source citation, rejected files, retries, lease expiry, authentication, cross-origin rejection and durable chat commands. An original silent two-second MP4 was decoded with FFmpeg and its text read with Tesseract. Full audio-model inference still requires installing the speech dependency and weights on a compute host. Microphone accuracy and voice availability must be checked on the owner's phone.

Official processing references:
- https://github.com/SYSTRAN/faster-whisper
- https://github.com/SYSTRAN/faster-whisper/releases/tag/v1.2.1
- https://ffmpeg.org/ffmpeg.html
- https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html
