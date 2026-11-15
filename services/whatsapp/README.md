# TradeLog WhatsApp QR connector

This optional local service provides real linked-device QR codes for TradeLog's `/whatsapp` page. It uses the community-maintained [Baileys](https://github.com/WhiskeySockets/Baileys) package, pinned to `7.0.0-rc14`; it is not an official WhatsApp integration. WhatsApp changes can break compatibility and account restrictions are possible. Do not treat a successful unit test as proof of live phone compatibility.

## Current behavior

- The owner clicks **Show connection QR code**, then opens WhatsApp on their own phone: **Settings → Linked devices → Link a device**.
- The real QR appears only once the connector is installed, reachable and contacting WhatsApp. There is no fake QR fallback. QR images are held in memory and expire in the UI.
- New one-to-one text messages appear in the private inbox. Groups, media and old history are excluded. Only the most recent 50 incoming messages are kept, in memory.
- The owner can request a draft using the configured local Ollama model, edit it, then press **Send this reply**. No automatic replies, contact harvesting, bulk messaging, trading, or payments are performed.
- Replies can only target a recent incoming message. A durable request journal prevents re-sending the same request ID. An uncertain delivery stops without retrying; check WhatsApp before any further attempt. "Submitted" does not mean delivered or read.
- Local credentials and the outgoing request journal are encrypted using AES-256-GCM and atomic, serialized writes. The bridge token derives the encryption key. Keep that token private and backed up separately; changing it prevents opening the saved session.
- Disconnect clears the local login and inbox and attempts to unlink the device. If the connection has already failed, also unlink this device on the phone. One process must own the session volume.

## Setup on the target laptop

This code is prepared for the Node TradeLog workspace on this branch. It has **not** been installed in the separate Python Trade Lord currently running on the laptop. Do not replace that application or its data directory with this repository. Its current source and Docker configuration are needed for a controlled integration.

1. Confirm the workspace owner login is configured (`OWNER_PASSWORD`, at least 13 characters). Use a separate staging data directory initially, with trading execution disabled.
2. Use a new random `WHATSAPP_BRIDGE_TOKEN` with at least 32 characters. Provide the same value privately to the workspace and connector. Do not commit it or paste it in chat.
3. Install Node 22 or use `deploy/compose.whatsapp.yaml`. The Compose service expects a pre-existing private network named `tradelord-local`; verify the actual laptop network before using it. The connector publishes **no host port**. A workspace container on that network uses `WHATSAPP_BRIDGE_URL=http://whatsapp:3040`. The initial 512 MB / 0.5 CPU limits still need measurement on the target laptop.
4. For a non-Docker install, run `npm ci --omit=dev` in this directory. Set `WHATSAPP_DATA_DIR` to a dedicated private directory, provide the token, and run `npm start`. It binds to `127.0.0.1:3040` by default; a workspace on the same host can use that address. Do not expose this service publicly.
5. Open the owner-only `/whatsapp` page on the local workspace, click **Show connection QR code**, and scan from the phone. Both the connector and WhatsApp need internet. Running on the laptop does not make online messages available offline.
6. Verify with an account you control: pair, receive a direct text, generate a draft, manually send once, disconnect and confirm the device is unlinked on the phone. No real message was sent or account paired during development.

On process restart the owner clicks Connect to resume the saved session. Reconnection attempts after a temporary network loss are bounded. The 10,000-entry outgoing request journal fails closed when full; archive and rotate it under maintenance rather than deleting uncertain entries automatically.

## Validation

`node --test tests/*.test.mjs services/whatsapp/test.mjs` from the repository root runs the application and connector tests (install this service's dependencies first). Checks cover QR lifetime, private routes, direct-message filtering, encrypted session restoration, duplicate-send prevention, ambiguous delivery, storage failure and disconnected sessions. Runtime package imports were checked. Docker builds, actual phone pairing/delivery, sustained uptime and target-laptop performance remain to be verified.
