# OpenWeb — SDCV Dashboard

An end-to-end web tool for IC verification (SDC/CDC) report review across three modes (**ac / dc / func**), following the workflow **parse → line-by-line inspection → AI-assisted analysis → waive export**.

- Requirement specification: [`development.md`](./development.md)
- Delivery / implementation details: [`details.md`](./details.md)

## Environment Requirements

- WSL Ubuntu (the project is designed to run inside WSL)
- Node.js 22+ (recommended via nvm)
- opencode CLI — required for the Agent Copilot feature (`npm install -g opencode-ai`, installed inside WSL)

## Installation

```bash
npm install
```

If `opencode` is not installed inside WSL:

```bash
npm install -g opencode-ai
opencode auth login   # configure an LLM provider, otherwise the copilot cannot chat
```

## Running

### Development mode (hot-reload frontend + backend)

```bash
npm run dev
```

- Web backend (API + static files): `http://localhost:5173`
- Vite frontend dev server (proxies `/api` to 5173): `http://localhost:5174`

> Note: after changing frontend source code, run `npm run build` so that the static bundle served on `:5173` is up to date (`:5174` serves the source directly). Backend changes require restarting the dev server.

### Production mode (build the frontend, serve everything from one port)

```bash
npm start
```

- Open `http://localhost:5173`

### Run in the background / stop (WSL)

```bash
bash scripts/start.sh   # start the web backend in the background (opencode serve is started automatically)
bash scripts/stop.sh    # stop the web backend
```

## Feature Overview

- **Home dashboard**: select / add / delete root directories; auto-scans `{mode}_sdcV_summary/rpt/{mode}_summary.json` and lists every check item per mode (ac / dc / func) with a status LED and status chip.
- **Detail page**: line-by-line report inspection (text / csv / xlsx), supporting:
  - Regex filtering with `&&` multi-pattern AND, case-sensitive, exclude-matches, and hide-waived switches
  - Per-row selection for waiving; comment (`#`) and empty lines are not selectable
  - **Export Waiver**: enter a reason → appends to `{mode}.waive_val.list` (existing files are appended to)
  - Exported rows turn grey with strikethrough and a `waived` tag, persisted in SQLite; refreshing keeps them
  - When all checkable rows of an item are waived, the item's status becomes **"pass by waive"** instead of fail
- **Agent Copilot**: a dockable / resizable floating panel that reuses a fixed opencode session per check item; a preset prompt plus the report content is pre-filled (not auto-sent); replies stream via SSE with markdown rendering.

## Agent (Copilot) Configuration

OpenWeb's backend talks to an **`opencode serve`** server over HTTP (REST + SSE). The backend supports **two connection modes**, chosen by environment variables — no frontend or code changes are required to switch.

### Connection modes

| Mode | When | Behavior |
|---|---|---|
| **Local (default)** | `OPENCODE_BASE_URL` is **not** set | Backend probes `127.0.0.1:{OPENCODE_PORT}` (default 4096), attaches to an already-running `opencode serve`, or **spawns one automatically** (`opencode serve --hostname 127.0.0.1 --port <p>`). |
| **Remote (intranet/company)** | `OPENCODE_BASE_URL` is set | Backend connects **directly** to that server and **skips** local probing/spawning. A startup health check runs against `/global/health` (warn-only, never blocks boot). REST calls and the SSE event stream are both forwarded to the remote URL. |

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `OPENCODE_BASE_URL` | *(unset)* | Remote opencode server base URL, e.g. `http://opencode.corp.internal:4096`. Setting it switches to remote mode. |
| `OPENCODE_TOKEN` | *(empty)* | Bearer token; sent as `Authorization: Bearer <token>` on every opencode REST + SSE request (for company servers with auth). |
| `OPENCODE_PORT` | `4096` | Local opencode port — used only when `OPENCODE_BASE_URL` is unset. |
| `OPENWEB_PORT` | `5173` | Web server port. |
| `OPENWEB_HOST` | `0.0.0.0` | Web server bind address; `0.0.0.0` makes it reachable from the LAN. |
| `OPENWEB_DATA_DIR` | `server/data` | Directory for the SQLite database. |

### Connect to a company / intranet opencode server

1. Get from the opencode operator: the base URL, the port, and (if enabled) an auth token.
2. Start the backend with the variables set:
   ```bash
   OPENCODE_BASE_URL=http://opencode.corp.internal:4096 \
   OPENCODE_TOKEN=<token-if-any> \
   OPENWEB_HOST=0.0.0.0 \
   npm start
   ```
3. Confirm the startup log shows `[opencode] connected to remote server at ...`.
4. Smoke test: open a check item's detail page and start **Agent Copilot**; replies stream via SSE from the remote server.

> If the company server expects a different auth header or scheme than `Authorization: Bearer <token>`, adjust `authHeaders()` in `server/src/services/opencode.js` (one function).

### Change the model / provider (the actual AI)

The model and provider are configured **inside opencode itself**, not in OpenWeb:

- **Local mode**: run the `opencode` CLI to pick a model, or edit `~/.config/opencode/opencode.json` (provider, model, API key). No OpenWeb code change.
- **Remote mode**: ask the company server operator to set the model there; OpenWeb simply talks to their server.

### Customize the copilot's preset prompt

The first-message template lives in `server/src/config.js` → `defaultPrompts[0].template` (placeholders `{mode}`, `{item}`, `{status}`, `{reportPath}`, `{log}`). Edit it and restart the backend to change what the agent is asked to do on first open.

## Deployment on a Company Linux Server

The project runs on any Linux host (no WSL required). To make it available on the intranet:

1. **Install Node.js 22+** (system package or nvm) on the host.
2. **Build and install**:
   ```bash
   npm install
   npm run build        # builds web/dist (production bundle)
   ```
3. **Run** with environment variables (remote agent / LAN access):
   ```bash
   OPENCODE_BASE_URL=http://opencode.corp.internal:4096 \
   OPENCODE_TOKEN=<token-if-any> \
   OPENWEB_HOST=0.0.0.0 \
   OPENWEB_PORT=5173 \
   node server/src/index.js
   ```
   Colleagues then open `http://<host-ip>:5173`. No opencode CLI is needed on this machine when `OPENCODE_BASE_URL` is set.
4. **Auto-start with systemd** (recommended for a shared server): create `/etc/systemd/system/openweb.service`:
   ```ini
   [Unit]
   Description=OpenWeb SDCV Dashboard
   After=network.target

   [Service]
   WorkingDirectory=/path/to/openWeb
   Environment=OPENCODE_BASE_URL=http://opencode.corp.internal:4096
   Environment=OPENCODE_TOKEN=<token-if-any>
   Environment=OPENWEB_HOST=0.0.0.0
   Environment=OPENWEB_PORT=5173
   ExecStart=/usr/bin/node server/src/index.js
   Restart=on-failure
   User=<run-as-user>

   [Install]
   WantedBy=multi-user.target
   ```
   Then `sudo systemctl enable --now openweb`.

> **Security**: the app has no built-in authentication. On a trusted intranet, direct LAN access is acceptable; if exposed more broadly, put an nginx reverse proxy in front with basic auth / corporate SSO and HTTPS.

## Ports

| Service | Port |
|---|---|
| Web backend (API + static) | 5173 |
| Vite dev server | 5174 |
| opencode serve | 4096 (auto-increments if busy) |

## Data Storage

- SQLite: `server/data/openweb.db` — root directories, persisted waive state, item↔opencode-session mapping
- Waive list files: `{waive_dir}/{mode}.waive_val.list` (append-only, one file per mode)
- opencode sessions: managed by opencode itself
