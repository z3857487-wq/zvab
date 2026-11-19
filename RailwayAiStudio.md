# Zero-Config Railway Deployment Guide (`RailwayAiStudio.md`)

**Project:** Zaid Ashiq X Ultra V. Coder — WhatsApp Automation Suite  
**Owner:** Zaid Ashiq X Ultra V. Coder (`+254141693915`)

---

## 1. Zero-Variable Railway Deploy & Run

You do **not** need to configure any environment variables or login keys to run on Railway:

1. Deploy this repository directly to **Railway** (uses `Dockerfile` + `railway.json` automatically).
2. Railway runs `node server.js`, binds to `0.0.0.0:$PORT`, and verifies `/api/health` (`200 OK`).
3. Open your Railway URL in any browser — the full dashboard opens immediately with **no login screen** and **no OAuth setup**.

### Optional Enhancements
- **Persistent Volume (Optional):** Attach a Railway Volume mounted at `/app/data` to preserve SQLite DB, WhatsApp sessions, and View-Once Vault files across redeploys. Even without a volume, the server automatically resolves writable local/tmp storage.
- **Zero-Config Defaults Built-In:**
  - `BOT_NAME`: `Zaid Ashiq X Ultra V. Coder`
  - `PREFIX`: `.`
  - `COMMAND_MODE`: `public`
  - `BUTTONMODE`: `true`
  - `AUTOTYPE` / `AUTORECORD` / `ALWAYSONLINE`: `false` (Zero-Presence Stealth)

---

## 2. Deployment Files Included
| File Path | Purpose |
| :--- | :--- |
| `server.js` | Express server, direct dashboard access, anti-sleep heartbeat, Vault API, and `/api/health`. |
| `Dockerfile` | Production `node:22-bookworm-slim` container with `ffmpeg` and `node:sqlite`. |
| `railway.json` | Configures Railway healthcheck (`/api/health`), `ALWAYS` restart policy, and `node server.js`. |
| `nixpacks.toml` | Nixpacks manifest specifying Node.js 22 and `ffmpeg`. |
| `Procfile` | Process declaration (`web: node server.js`). |
| `lib/storagePaths.js` | Auto-resolves writable persistent storage (`/app/data`, local `./data`, or `/tmp`). |
