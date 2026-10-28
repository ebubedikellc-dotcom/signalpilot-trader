# Trade Lord standalone study desk

Separate VPS service; no trading endpoints, wallet credentials or SignalPilot authentication are copied. Source lives in the existing repository but runs independently.

Implemented: owner-only HTTPS gateway; link/file submission; persistent SQLite queue; single yt-dlp download worker; manual-upload fallback with original URL; duplicate URL suppression; bounded downloads; durable transcript checkpoint; Qwen-generated section notes; source-grounded chat; restart recovery. Pending jobs do not hold up other jobs. The site does not claim that saved notes change model weights.

## Deployment (operator steps, not instructions for the owner)

Use an x86 Linux VPS with Docker Compose, at least 12 GB RAM for a small-model pilot; 24 GB provides more headroom. The Compose limits target a 12 GB pilot. CPU throughput, RAM use and Qwen timeouts need benchmarking before promising video capacity. Set DNS for an existing subdomain to avoid a new domain purchase. Permit inbound 80/443 and restrict SSH. Never expose port 8080 or Ollama 11434 to the Internet: they rely on the gateway/internal network. Configure disk monitoring and provider backups before ingesting data.

Create `training-hub/.env` outside git with HUB_DOMAIN, HUB_OWNER, and HUB_PASSWORD_HASH (Caddy bcrypt hash). Use owner-controlled credentials; no default password. Protect the file mode 0600. Start with `docker compose -f training-hub/compose.yaml up -d --build`, then `docker compose -f training-hub/compose.yaml exec ollama ollama pull qwen3:4b`. Caddy requires the real domain/DNS for TLS. This initial release uses email as username plus a password; passwordless owner sign-in is not implemented. Never store wallet secrets here.

Use maintained yt-dlp with its default EJS dependencies and Deno. Pin verified package/image versions at deployment after a build test, and schedule security updates. The checkout environment has no Docker; the image build and live downloads remain unverified. This is a deployment candidate, not a live service.

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
