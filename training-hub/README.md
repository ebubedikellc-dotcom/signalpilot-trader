# Trade Lord standalone study desk

Separate VPS service; no trading endpoints, wallet credentials or SignalPilot authentication are copied. Source lives in the existing repository but runs independently.

Implemented: owner-only HTTPS gateway; link/file submission; persistent SQLite queue; single yt-dlp download worker; manual-upload fallback with original URL; duplicate URL suppression; bounded downloads; durable transcript checkpoint; Qwen-generated section notes; source-grounded chat; restart recovery. Pending jobs do not hold up other jobs. The site does not claim that saved notes change model weights.

## Original Trade Lord design

The conversation page reuses the repository's original `trade-lord.html` structure, green face SVG and `trade-lord.css`. `/` and `/trade-lord` open that conversation; `/control-panel/trade-lord` opens the private training controls. The standalone adapter sends questions to this hub's `/api/chat` and retains the video-defined learning behavior. Browser voice input defaults to Nigerian English and optional spoken replies to UK English; support depends on the phone/browser. The standalone controls keep link/upload learning, topic search, saved sources, website connections and protected transfers. This does not migrate an existing Render database or claim full feature parity with its separate trading/observation service.

## Learn from the teacher's videos

The supplied videos determine the subject and method. The study desk does not assign a trading strategy, profit target or fixed set of rules. Lesson extraction is instructed to preserve the teacher's explanations, examples, numbers, conditions and exceptions, and to attribute claims to that teacher. Conflicting or unclear passages should remain explicit. Chat is instructed to answer from completed lessons, cite their titles/timestamps and say when those lessons do not provide an answer. Before any nonempty lessons are ready, chat returns a clear waiting message without calling Qwen. These instructions guide generation; they are not proof of correct transcription, complete understanding or model fine-tuning. The extractor's speech/sampled-text limitations below still apply.

## Deployment (operator steps, not instructions for the owner)

The selected deployment target is the $15/month InterServer Linux VPS plan shown with 10 GB RAM and 200 GB storage. Verify the provisioned OS, CPU allocation and available memory before starting. The initial configuration uses Qwen3 8B Q4_K_M, one loaded model, one active generation and a 4096-token context. Ollama is capped at 6656 MiB / 2 CPUs, the video worker at 2 GiB / 1 CPU, the web service at 512 MiB and Caddy at 128 MiB. The combined container memory limits are 9344 MiB, leaving 896 MiB on a 10240 MiB host; check actual host memory and background services before launch. These are initial resource budgets, not measured capacity guarantees. CPU throughput, peak RAM and Qwen timeouts need benchmarking before promising video capacity. The official model tag is https://ollama.com/library/qwen3:8b-q4_K_M. Set DNS for an existing subdomain to avoid a new domain purchase. Permit inbound 80/443 and restrict SSH. Never expose port 8080 or Ollama 11434 to the Internet: they rely on the gateway/internal network. Configure disk monitoring and backups before ingesting data; do not enable a paid add-on without authorization.

Create `training-hub/.env` outside git with HUB_DOMAIN, HUB_OWNER, and HUB_PASSWORD_HASH (Caddy bcrypt hash). Quote the bcrypt hash as a single-quoted value so Compose preserves its dollar signs. QWEN_MODEL defaults to `qwen3:8b-q4_K_M`; any override must also be installed in Ollama and fit the memory budget. Use owner-controlled credentials; no default password. Protect the file mode 0600. Start with `docker compose --env-file training-hub/.env -f training-hub/compose.yaml up -d --build`, then `docker compose --env-file training-hub/.env -f training-hub/compose.yaml exec ollama ollama pull qwen3:8b-q4_K_M`. Caddy requires the real domain/DNS for TLS. This initial release uses email as username plus a password; passwordless owner sign-in is not implemented. Never store wallet secrets here.

Use maintained yt-dlp with its default EJS dependencies and Deno. Pin verified package/image versions at deployment after a build test, and schedule security updates. The image build, live model inference and downloads remain unverified. This is a deployment candidate, not a live service. Server activation/access and manual-renewal settings still require verification. The owner authorized one month without automatic recurring payment.

The smaller context uses 6000-character transcript sections and up to 8000 characters of retrieved notes per question. Every transcript section is processed and the complete saved notes remain on disk. Source JSON stays intact when an excerpt is shortened, and shortened sources are labeled `excerpted`. Character limits approximate token limits; validate long questions and dense multilingual lessons on the actual model before launch.

## Larger Qwen after a RAM upgrade

The 10 GB deployment keeps `qwen3:8b-q4_K_M`. `compose.qwen14b.yaml` prepares `qwen3:14b-q4_K_M` for a VPS upgraded to at least 24 GB RAM (with sufficient CPU allocation for the 4-CPU model / 2-CPU worker budgets). More disk storage alone does not meet this requirement. The official 14B model package is approximately 9.3 GB before runtime/context memory: https://ollama.com/library/qwen3:14b-q4_K_M. This profile is prepared configuration, not evidence of an installed or benchmarked model.

Before switching, verify actual RAM/CPU, let any current video finish, and take a verified knowledge backup. Use the existing checkout directory and Compose project name so `hub-data` and `models` remain the same volumes. Never use `down -v` for an upgrade. Start the larger Ollama budget, download the model, then switch the web/worker model selection:

```sh
docker compose --env-file training-hub/.env -f training-hub/compose.yaml -f training-hub/compose.qwen14b.yaml up -d ollama
docker compose --env-file training-hub/.env -f training-hub/compose.yaml -f training-hub/compose.qwen14b.yaml exec ollama ollama pull qwen3:14b-q4_K_M
docker compose --env-file training-hub/.env -f training-hub/compose.yaml -f training-hub/compose.qwen14b.yaml up -d --build
```

Saved transcripts and notes stay in `hub-data`; switching models does not retrain their weights. Test a known lesson and new short video, and measure RAM/response time before processing the full queue. Keep using both Compose files after the switch. Returning to the base Compose file selects the 8B default again (unless `QWEN_MODEL` is overridden in `.env`), while retaining the same saved knowledge.

The CPU extractor is reused from workers/trade_lord_video.py: faster-whisper small INT8, English OCR sampled every 30 seconds. These are not full visual understanding. Qwen summarizes timestamped text sections. Unavailable Qwen leaves the transcript saved in `needs_lessons`, with manual retry; failed downloads become `needs_upload`. Uploads retain the original record/source and are limited to 100 MB / 60 minutes; total working data allowance is 20 GB. Retain originals pending review. Do not delete model/source storage without a verified backup. Queue/memory are not imported from SignalPilot automatically.

Only individual public YouTube video links are supported in this release. No playlists, generic URL extractor, account cookies, credentials, CAPTCHA automation, proxy rotation or private-source bypass. Permission is confirmed when submitting material. Do not claim a failed fetch proves a video is unavailable to its owner. Future platform changes can require downloader updates. Failed formats/size limits may also require manual upload. The worker downloads at most one file at a time and stops each attempt after 11 minutes. Decoding uses only local-file protocols, with a two-hour processing timeout. Each Qwen section has a five-minute timeout.

## Before launch

1. Build the images and verify Caddy authentication/TLS, private service ports and persistence.
2. Run an owner-authorized sample download and upload; verify failure fallback and restart recovery.
3. Process a short sample, verify timestamped transcript, notes and grounded answers. Record complete processing time and CPU/RAM.
4. Test backup restoration. Only then submit the remaining queue.
5. Any GPU rental is a separate future adapter. This candidate does not start, provision, stop or spend money on a GPU. Do not rent one until its processing and shutdown controls are implemented and tested.

Tests: `PYTHONPATH=training-hub python3 -m unittest discover -s training-hub -p 'test_*.py'`.
Preview: `sites-preview start .../training-hub` uses disposable `/tmp/trade-lord-hub-preview`, without a worker or Qwen. No real private content belongs in preview.

## Topic requests

The Gain knowledge of form persists a topic independently of video jobs. The worker uses yt-dlp YouTube search metadata (`ytsearch3:`) with a 120-second subprocess deadline, validates video IDs, and queues up to three individual video links. Duplicate sources reuse their original record. Search failures are visible without blocking uploaded videos. Search results are candidate sources, not verified facts or proof of expertise. Search/download availability must be tested from the actual VPS; no bypass of access restrictions is implemented. Topic requests are bounded to 100 records and require owner access through the gateway. Downloads and uploads must be content the owner is authorized to process.

## Reuse the private Qwen page from another site
The owner panel provides a persistent HTTPS page-link setting with Save, Copy and Open controls. Once deployed, choose “Use this site's link”, then Save. Another website can use this URL as a normal link to the same authenticated study desk. This is navigation, not an embedded chat API, model migration or transfer of knowledge. The original server remains necessary. Do not enter passwords, keys or signed URLs. The backend stores this setting but never fetches the supplied URL.
For a future server move, the code, persistent data volume (including hub.sqlite and uploaded files), model installation and secrets must be migrated separately. Updating the page link alone does not perform that migration.

## Website API
The owner creates a separately named, revocable key for each website in the control panel. Keys are shown only at creation and stored as SHA-256 hashes. POST `/v1/chat` with `Authorization: Bearer <key>`, `Content-Type: application/json`, and `{"question":"..."}`; the response is `{"answer":"..."}`. Store keys in the calling site's backend, never public JavaScript. No browser CORS access is enabled. The endpoint allows chat using saved lessons only; it exposes no owner or trading actions. Concurrent external calls are capped at one and others receive 429. Key holders can read knowledge through chat, so only grant trusted sites access. Caddy bypasses owner Basic authentication only for this exact route; application Bearer authentication remains mandatory.

## Protected migration
“Create protected transfer” builds a versioned encrypted backup including every recorded source's saved transcript/lessons, topic history, and existing uploaded/downloaded `.video` files. A random password is shown once, with AES-256-GCM encryption and a scrypt-derived key. Download links require owner authentication and expire after one hour. Cleanup is lazy on transfer operations. Data remains on the original server. Transfers require scratch disk space in addition to the live data. The receiving install accepts encrypted backup upload (maximum 21 GB); it authenticates the encryption before parsing, rejects unexpected members, and imports only into an empty database. It does not fetch arbitrary remote URLs. Partial imports clean up their new files and transactions roll back. Unfinished jobs are paused for review. The destination retains its own website URL and owner credentials. API keys are deliberately not transferred: generate new ones and update consuming sites after testing.

The base Qwen/Ollama model is **not bundled**. Install the same `QWEN_MODEL` on the new server before importing. This build uses retrieval from saved lessons; no custom fine-tuned model/adapters exist to include. Future fine-tuned model migration needs explicit implementation. The transfer moves current knowledge and videos, not the hosting account, DNS, Docker installation or TLS settings. A prepared destination server and adequate storage remain necessary. After import compare source/video counts and test Qwen chat before closing the old server. Stop training/uploads before taking a final migration snapshot for a consistent cutover. No automatic deletion or cancellation is performed.
