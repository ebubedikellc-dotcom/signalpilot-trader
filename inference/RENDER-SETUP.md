# Proposed Trade Lord compute — not provisioned

Use the existing Ebubedike Render workspace and GitHub repository. Keep the
trading web service on its existing instance. These new services require the
owner's approval of the additional recurring charges before creation.

## Proposed initial capacity

Prices observed in the owner's Render dashboard on 28 October 2026:

| Component | Configuration | Monthly base cost |
| --- | --- | --- |
| Qwen private service | Oregon, Dockerfile `inference/Dockerfile`, 2 CPU / 8 GB | $135 |
| Model disk | 10 GB mounted at `/var/lib/ollama` | $2.50 |
| Video background worker | Oregon, Dockerfile `workers/Dockerfile`, 1 CPU / 2 GB | $25 |
| Additional total | Excludes existing site, tax and usage overages | $162.50 |

The proposed starting model is `qwen3:4b-q4_K_M` (about 2.6 GB of downloaded
weights), rather than the earlier illustrative 8B configuration. Capacity is a
starting estimate, not a measured throughput promise. Test real response times
and one permissioned video before declaring either service operational. CPU
responses may be slow; the current application has a 45-second model deadline
and falls back to evidence answers if exceeded. If that deadline is exceeded,
adjust the response budget/timeout with a real measured request before opening
general model access. Do not silently buy more compute.

## Qwen deployment

Create a **Private Service**, using this GitHub repository, main branch, repository
root build context and `inference/Dockerfile`. No public endpoint or public port
forwarding. Attach the disk above. Only after paid provisioning is approved,
deploy and wait for the model download. Obtain the actual Render internal host
from the created service; do not guess its hostname.

On `signalpilot-trader`, add:

- `TRADE_LORD_OLLAMA_URL=http://<actual-private-host>:11434`
- `TRADE_LORD_MODEL=qwen3:4b-q4_K_M`

The application verifies the model through `/api/tags`. Verify a real model
answer in addition to that availability check. The image uses the official
Ollama distribution; record the resolved image digest in the deployment record.
It is not connected to OpenAI APIs.

## Video processor deployment

Create a background worker from the same repo using `workers/Dockerfile`.
Generate a fresh random worker token (at least 32 characters) in the secure
deployment workflow. Set the same `TRADE_LORD_VIDEO_WORKER_TOKEN` on the worker
and web service, without putting it into GitHub, chat, screenshots or logs.
Set worker `TRADE_LORD_SITE_URL=https://signalpilot-trader.onrender.com`.
Use `TRADE_LORD_WHISPER_MODEL=small`. Test memory use on an original or
permissioned video before increasing upload traffic. No original user videos
are copied into this repository.

## Acceptance

- Existing trading settings and enable flags remain unchanged.
- Private model endpoint is not publicly reachable.
- Owner status verifies the actual selected model and a working video worker.
- A real processed video produces a saved transcript with source timestamps.
- A relevant owner question cites that saved source.
- Anonymous chat cannot retrieve owner videos, wallets, notes or settings.
- Learning here means retained, retrieved knowledge. It does not train model
  weights or automatically start trading.

References: https://render.com/pricing,
https://render.com/docs/private-services,
https://registry.ollama.com/library/qwen3/tags,
https://github.com/ollama/ollama/blob/main/docs/faq.mdx
