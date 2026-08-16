# OpenWeb — Project Details (Delivery Document)

This document describes **what the project actually does today** — every feature, file, behavior, and UI design decision — so that future development or update requests can be planned against the real implementation.

---

## 1. Overview

OpenWeb is an end-to-end web tool for IC verification (SDC/CDC) report review. It follows the flow **parse → line-by-line inspection → AI-assisted analysis → waive export** across three modes: **ac / dc / func**.

- **Backend**: Node.js + Express (ESM), SQLite via `better-sqlite3`
- **Frontend**: React 18 + TypeScript + Vite + Ant Design 5
- **AI Copilot**: drives `opencode serve` (HTTP + SSE) for streaming agent replies
- **Environment**: WSL Ubuntu, Node.js 22+, `opencode-ai` CLI (WSL-native)

---

## 2. Repository Layout

```
openWeb/
├── development.md          # Requirement specification (English)
├── README.md               # Usage & deployment (English)
├── details.md              # This file (delivery / implementation details)
├── package.json            # npm workspaces (server, web)
├── package-lock.json
├── .server.pid             # PID file (runtime, created by scripts/start.sh)
├── Example/                # Sample data (generated)
│   ├── ac_sdcV_summary/rpt/ac_summary.json
│   ├── dc_sdcV_summary/rpt/dc_summary.json
│   ├── func_sdcV_summary/rpt/func_summary.json
│   └── log/                # sample .log / .xlsx report files
├── scripts/
│   ├── start.sh            # start web server in background (PID file)
│   └── stop.sh             # stop web server from PID file
├── server/
│   ├── package.json
│   ├── data/openweb.db     # SQLite database (runtime)
│   └── src/
│       ├── index.js        # express app entry
│       ├── config.js       # ports, limits, default copilot prompts
│       ├── db.js           # SQLite schema
│       ├── services/
│       │   ├── loader.js   # report file → lines (text/csv/xlsx)
│       │   ├── report.js   # root scan + mode/item discovery
│       │   ├── waive.js    # waive state + .waive_val.list file IO
│       │   └── opencode.js # opencode serve lifecycle + SSE proxy
│       └── routes/
│           ├── roots.js    # root directory CRUD (+ session cleanup)
│           ├── modes.js    # scan + item detail (+ pass-by-waive status)
│           ├── waive.js    # waive-dir (GET/POST/DELETE) + export endpoints
│           ├── copilot.js  # session mgmt + SSE stream endpoint
│           ├── browse.js   # directory tree browsing
│           └── file.js     # generic file viewer content
└── web/
    ├── package.json
    ├── index.html          # fonts, root mount, title "OpenWeb · SDCV Dashboard"
    ├── vite.config.ts      # dev server + /api proxy
    ├── tsconfig.json       # TS config
    └── src/
        ├── main.tsx        # app bootstrap, AntD theme/locale
        ├── App.tsx         # router (/, /detail, /file)
        ├── api.ts          # typed API client
        ├── types.ts        # shared interfaces
        ├── index.css       # "graph paper sign-off bench" design system
        ├── pages/
        │   ├── Home.tsx         # dashboard: roots + mode tree + filters
        │   ├── Detail.tsx       # check item inspection + waive
        │   └── FileViewer.tsx   # standalone file viewer
        └── components/
            ├── WaiveDirModal.tsx  # waive dir picker
            └── CopilotPanel.tsx   # dockable/resizable AI panel
```

---

## 3. Documentation Structure

| File | Role |
|---|---|
| `development.md` | Single source of truth for requirements (English): features, decisions, conventions, and behavior rules. |
| `README.md` | Quick-start guide: environment, install, start/stop, feature summary, ports, storage. |
| `details.md` | This file: real implementation reference (features, UI design, behaviors). |

---

## 4. Root / Workspace Scripts

### `package.json` (root)
- npm **workspaces** wiring `server` and `web`.
- Scripts:
  - `dev` — run server + web dev server together via `concurrently`
  - `start` — build web then run server (production, single port)
  - `build` — build web only

---

## 5. Backend

### `server/src/index.js` — Express entry
- Mounts `cors`, `express.json` (10 MB limit).
- `GET /api/health` → `{ ok: true }`.
- Mounts routers under `/api/roots`, `/api/copilot`, `/api/browse`, `/api/file`.
- Serves built `web/dist` as static files and falls back to `index.html` for any non-`/api` route (SPA routing).
- On boot calls `ensureServer()` to attach to (or spawn) an `opencode serve` instance; logs warnings if unavailable.
- Graceful shutdown on SIGINT/SIGTERM closes the HTTP server and kills the spawned opencode process.

### `server/src/config.js` — Configuration
- All values read from environment variables with safe defaults:
  - `webPort` ← `OPENWEB_PORT` (default 5173)
  - `hostname` ← `OPENWEB_HOST` (default `0.0.0.0`; the web server binds to all interfaces)
  - `opencodePort` ← `OPENCODE_PORT` (default 4096)
  - `opencodeBaseUrl` ← `OPENCODE_BASE_URL` (default `''`, trailing slashes stripped)
  - `opencodeToken` ← `OPENCODE_TOKEN` (default `''`)
  - `dataDir` ← `OPENWEB_DATA_DIR` (default `server/data/`)
- `maxXlsxRows` = 100000 (xlsx row cap).
- `defaultPrompts[0]` — the built-in "Generic Analysis" template for the copilot first message; placeholders `{mode}`, `{item}`, `{status}`, `{reportPath}`, `{log}`.

### `server/src/db.js` — SQLite schema
- Creates `server/data/openweb.db`, WAL mode.
- Tables:
  - `roots(id, path UNIQUE, waive_dir, created_at)`
  - `waived_lines(id, root_id, mode, item, line_no, content, waive_reason, created_at, UNIQUE(root_id, mode, item, line_no))`
  - `copilot_sessions(id, root_id, mode, item, session_id, created_at, updated_at, UNIQUE(root_id, mode, item))`

### `server/src/services/loader.js` — Report → lines
- `textToLines(text)` — splits on newlines; each line: `{ lineNo, text, isComment, isEmpty }` (comment = starts with `#`, empty = blank after trimEnd).
- `loadCsv(file)` — CSV parsed via `csv-parse/sync`; **cells joined with `\t`**; falls back to raw text on parse failure.
- `loadXlsx(file)` — first worksheet via `exceljs`; **cells joined with `\t`**, capped at `maxXlsxRows`.
- `loadReport(path)` — dispatches by extension (`.xlsx/.xls`, `.csv`, else text). Missing/unreadable → `{ format: 'missing', missing: true }`. Line numbers: 1-based; xlsx uses Excel row numbers.

### `server/src/services/report.js` — Root scan / mode discovery
- `MODES = ['ac', 'dc', 'func']`.
- Summary path rule: `{root}/{mode}_sdcV_summary/rpt/{mode}_summary.json`.
- `scanRoot(root)` — for each mode with an existing summary JSON, parses it as `{ itemName: { Status, Report } }`; malformed JSON becomes a `[parse failed]` pseudo-item with status `Error`.

### `server/src/services/waive.js` — Waive state + file IO
- `getWaiveDir` / `setWaiveDir` — per-root persisted waive directory.
- `waiveFilePath(rootId, mode)` → `{waive_dir}/{mode}.waive_val.list` (null if unset).
- `appendWaive(...)` — appends block:
  ```
  # Waive Item: <item>
  # Waive Reason: <reason>
  <line content per row>
  ```
  Returns `{ file, existed }`.
- `insertWaivedLines` / `getWaivedLines` — SQLite persisted waive flags (idempotent via UNIQUE + `INSERT OR IGNORE`); `removeWaiveLines` exists for programmatic cleanup (not exposed via UI).

### `server/src/services/opencode.js` — opencode serve integration
- **Remote mode**: when `config.opencodeBaseUrl` is set, `ensureServer()` connects directly to that URL (a `/global/health` check logs success or a warning, never blocking boot) and **skips** local probing/spawning.
- **Local lifecycle**: probes `/global/health`; connects to an existing server or **spawns** `opencode serve --hostname 127.0.0.1 --port <p>`, scanning ports 4096→4105 until one works; throws if none available.
- **Auth**: `authHeaders()` sends `Authorization: Bearer <OPENCODE_TOKEN>` whenever a token is configured; applied to REST calls (`ocFetch`) and to the `/event` SSE stream.
- **REST wrappers**: `createSession`, `getSession`, `getMessages`, `sendMessageAsync` (`/session/{id}/prompt_async`), `deleteSession` (`DELETE /session/{id}`).
- **SSE proxy**: a single background reader consumes `GET /event` (with the auth header), parses `data:` JSON, extracts `sessionID` (from `properties`), and fans out via an `EventEmitter`.
- `subscribeEvents(listener)` / `abortEventStream()` / `getOpenCodePid()` / `stopOpenCodeServer()`.

### `server/src/routes/roots.js` — Root CRUD
- `GET /api/roots` — list roots ordered by id.
- `POST /api/roots` — validate directory exists; insert resolved path; duplicates return the existing row.
- `DELETE /api/roots/:id` — deletes root plus its `waived_lines` and `copilot_sessions`; **best-effort deletes** each associated opencode session via `deleteSession`; returns `{ deleted, deletedOpencodeSessions }`.

### `server/src/routes/modes.js` — Scan & item detail
- `GET /api/roots/:rootId/modes` — live scan of the root; runs `applyWaiveStatus` so items whose **every checkable line** (non-comment, non-empty) is waived report status `"pass by waive"`.
- `GET /api/roots/:rootId/modes/:mode/items/:item` — loads the report, merges persisted waive flags into each line by **`lineNo`** (`waived: true`), applies `applyWaiveStatus`; returns `{ mode, item, status, reportPath, format, missing, lines, waivedInfo }`.
- `applyWaiveStatus(root, scanned)` only loads a report when the item has at least one waived row (keeps scans cheap in the common case).

### `server/src/routes/waive.js` — Waive endpoints
- `GET /api/roots/:rootId/waive-dir` — read the remembered waive save directory.
- `POST /api/roots/:rootId/waive-dir` — set the waive save directory (resolves to an absolute path).
- `DELETE /api/roots/:rootId/waive-dir` — clear the remembered waive save directory (used by the dashboard re-selection flow).
- `POST /api/roots/:rootId/modes/:mode/items/:item/waive` — validates reason + rows, **requires** a waive dir (else `409 NO_WAIVE_DIR`), appends to the list file and persists waive state; returns `{ file, existed, exported, reason }`.
- `GET /api/roots/:rootId/modes/:mode/waive-file` — raw content of the waive list file.
- `GET /api/roots/:rootId/modes/:mode/items/:item/waived` — persisted waived rows.

### `server/src/routes/copilot.js` — Copilot session + streaming
- Session keyed by `(rootId, mode, item)`; `saveMapping` upserts.
- `GET /api/copilot/:rootId/:mode/:item` — returns session status, message history (normalized to `{ id, role, text }`), and the **preset** (first prompt built from the default template + up to 500 log lines with line numbers).
- `POST .../ensure` — returns existing session or creates one (title `"{mode} / {item}"`).
- `POST .../message` — forwards the user text via `prompt_async`.
- `GET .../stream` — SSE. State machine: only `message.part.updated` parts belonging to the **current AI message** (set on `step-start`) are forwarded as `part` events (`type: reasoning|text`); `message.updated` with `info.time.completed` → `done`; `message.part.error` → `error`. Heartbeat `: ping` every 20 s.

### `server/src/routes/browse.js` — Directory tree
- `GET /api/browse?path=...` — lists subdirectories (hides dot-dirs), reports `isDir` and parent, for the waive-dir picker.

### `server/src/routes/file.js` — Generic file viewer
- `GET /api/file/content?path=...&rootId=&mode=&item=` — loads any file via `loader.js`; when the waive context params are present, merges persisted waive flags for that item (keyed by `lineNo`).

### Backend API summary

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness |
| GET/POST | `/api/roots` | list / add root |
| DELETE | `/api/roots/:id` | delete root + waive/session cascades + opencode session cleanup |
| GET | `/api/roots/:id/modes` | scan report tree (waive-aware status) |
| GET | `/api/roots/:id/modes/:mode/items/:item` | item detail + waive flags + status |
| GET/POST/DELETE | `/api/roots/:id/waive-dir` | read / set / clear waive directory |
| POST | `/api/roots/:id/modes/:mode/items/:item/waive` | export waive |
| GET | `/api/roots/:id/modes/:mode/waive-file` | waive file content |
| GET | `/api/roots/:id/modes/:mode/items/:item/waived` | persisted waive rows |
| GET | `/api/browse` | directory listing |
| GET | `/api/file/content` | generic file content |
| GET/POST | `/api/copilot/:rid/:mode/:item(+/ensure/+/message)` | copilot sessions |
| GET | `/api/copilot/:rid/:mode/:item/stream` | SSE reply stream |

---

## 6. Frontend

### `web/src/main.tsx` — Bootstrap
- React 18 `createRoot`, `BrowserRouter`, AntD `ConfigProvider` with `locale={enUS}` and a theme token set: `colorPrimary`/`colorLink` `#4c6b8c` (muted steel blue), `borderRadius` 8, `fontFamily` Spline Sans, `colorBgLayout` `#f5f4f1`, `colorText` `#2f343b`.

### `web/src/App.tsx` — Router
- Routes: `/` → Home, `/detail` → Detail, `/file` → FileViewer.

### `web/src/api.ts` — API client
- Central `req()` wrapper over `fetch('/api/...')`; converts `NO_WAIVE_DIR` (409) into a rethrown error flagged `noWaiveDir`; otherwise surfaces `message`/`error` from the body. Typed methods for every backend endpoint (including `clearWaiveDir`), plus `copilotStreamUrl()` for the SSE URL.

### `web/src/types.ts` — Shared interfaces
- `RootInfo`, `CheckItem`, `ModeInfo`, `ScanResult`, `ReportLine`, `ItemDetail`, `CopilotMessage`, `CopilotInfo`, `WaiveResult`, `WaiveFileInfo`, `BrowseResult`.

### `web/src/pages/Home.tsx` — Dashboard (root selection + mode tree)
- Header: brand mark + **"openWeb · SDCV Dashboard"** subtitle, root `Select`, "Add root" (modal, absolute path), danger delete button (confirm warns about waive states + copilot sessions), refresh button.
- **Global name filter**: `Input.Search` ("Filter checks by name") filters items across all modes by substring.
- Overview block: **Sign-off overview** stats (Pass / Fail / To be review / Other + total).
- Per-mode card: Segmented filter (All / Pass / Fail / Review) + check-item rows. Each row is a **trace line**: status LED dot + item name + status chip (uppercase, color-coded). `pass by waive` renders as a green "PASS BY WAIVE" chip and is classified under Pass.
- **Waive-dir re-selection guard**: a module-level `Set` records roots already cleared this page load; on mount/root-change the dashboard clears the remembered waive directory only for roots not yet in the set (F5 refresh resets the set → re-selection; SPA navigation back does not).
- Empty states for no-root and no-report cases.

### `web/src/pages/Detail.tsx` — Check item inspection
- Header: Back button, `[MODE] item`, status chip (map includes `pass by waive` → green), clickable report path (tooltip shows full path), **Agent Copilot** primary button.
- **Two-row toolbar**:
  - Row 1 (filters): regex search (auto-joined by `&&`, all patterns must match), **Case sensitive** switch, **Exclude matches** switch, **Hide waived** switch.
  - Row 2 (actions): single **toggle button** — "Select all visible rows (N)" when nothing selected, else "Clear selection (M)" — plus **Export Waiver**.
- Side item list: all items of the current mode with status dots/chips; clicking switches the detail item (resets filter/selection/toggles and closes the copilot panel).
- Line rendering: checkbox per row (skipped for comment/empty lines), line-number gutter, content; **waived rows** are greyed with strikethrough on the text, a `waived` tag, and a disabled checkbox; selectable rows are highlighted when checked.
- Filtering respects `hideWaived` and excludes non-selectable lines; `Hide waived` also drops waived rows from the view.
- Waive flow: on export with no waive dir → opens `WaiveDirModal`; otherwise reason modal → POST → success message (created vs appended, file path, row count) → reload (chip refreshes, status may flip to `pass by waive`).
- Report path link opens the `/file` viewer.

### `web/src/pages/FileViewer.tsx` — Standalone file viewer
- Loads `/api/file/content` for an arbitrary path; same two-row toolbar, filter, selection, hide-waived, and waive-export behaviors (waive enabled only when `rootId/mode/item` context is present). Back button navigates history.

### `web/src/components/WaiveDirModal.tsx` — Waive directory picker
- Input for an absolute path + **Browse** panel: lists subdirectories, "Parent directory" up-link, "Use current directory" button, `Empty` states for non-dir / no-subdir. On confirm calls `setWaiveDir`.

### `web/src/components/CopilotPanel.tsx` — AI assistant panel
- Floating window: **draggable** by the header, **resizable** via corner/edge handles; can be **docked** to the right edge as a narrow tab; hovering the docked tab shows a **live preview**; clicking restores the full panel. A pulsing LED indicates a live session.
- On open: loads copilot info; if no session, calls `ensure`; restores prior messages; pre-fills the input with the preset; opens the SSE stream.
- Streaming: accumulates `part` events per `messageID` into a `pending` buffer, rendered live with `ReactMarkdown`, flushed to the message list on `done`. The pending ref is maintained synchronously in the part handler to avoid dropping the final `done` message.
- Send: appends user bubble, calls `copilotSend`, 120 s fallback timeout to release the sending state. Enter to send, Shift+Enter for newline.

### `web/src/index.css` — "Graph paper sign-off bench" design system
- Theme tokens: paper background `--paper:#f5f4f1`, card `--card:#ffffff`, ink `--ink:#2f343b` / `--ink-2:#5f6670` / `--ink-3:#8a909a`, line `--line:#e3e1db` / `--line-strong:#d3d1ca`, accent `--accent:#4c6b8c` (muted steel blue), status colors `--pass:#6e8b7e` / `--fail:#b26863` / `--review:#a98450`, soft mode backgrounds `--ac-bg:#edf1f2` / `--dc-bg:#eceff5` / `--func-bg:#f3f0ea`, radii 16/12/9 px.
- Fonts: **Spline Sans Mono** (titles, data, line numbers), **Spline Sans** (body), loaded via Google Fonts CDN in `index.html` (system fallbacks offline).
- Signature elements: `benchbar` (dashboard header), `detailbar` (detail header + actions), `overview-block` (stats), `modes-grid` + `mode-card` per mode, `item-row` with `item-dot` (status LED) and `item-status` chip, `detail-side` (sticky side list), `detail-toolbar` (column: filters row + actions row separated by a divider), `log-lines` / `log-line` (waived rows grey + strikethrough), `waived-tag`, `copilot-dock` / `copilot-panel-preview` (with `prefers-reduced-motion` support), and `bench-empty` / `bench-loading`. Responsive breakpoints at 960 px and 720 px.

### `web/index.html` — Shell
- `<html lang="zh-CN">`, title "OpenWeb · SDCV Dashboard", Google Fonts preconnect + Spline Sans / Spline Sans Mono load, `#root` mount.

### `web/vite.config.ts` — Dev server
- Port 5174; proxies `/api` → `http://127.0.0.1:5173`.

---

## 7. Process Management Scripts

### `scripts/start.sh`
- Loads nvm, `cd`s to project root, `setsid nohup node server/src/index.js` in the background, writes PID to `.server.pid`; idempotent (skips if already running); tails the log at `/tmp/openweb-server.log`.
- The backend auto-spawns `opencode serve` on boot (or on first copilot use).

### `scripts/stop.sh`
- Reads `.server.pid`, `kill`s the server (SIGTERM triggers graceful shutdown), removes the PID file; tolerates stale files. **Note: PID-file based — avoid `pkill -f` (it can kill unrelated WSL processes such as the VSCode server).**

---

## 8. Data Persistence

- **SQLite** (`server/data/openweb.db`): roots (path + waive_dir), waived_lines (waive state, idempotent via UNIQUE + `INSERT OR IGNORE`), copilot_sessions (item→opencode session mapping, upsert).
- **Waive list files** on disk: `{waive_dir}/{mode}.waive_val.list`, appended per export (repeated waives accumulate; already-waived rows are never un-waived from the UI).
- **opencode sessions** are managed by opencode itself; deleting a root best-effort deletes its sessions via the opencode API.

---

## 9. Key Design Decisions & Behaviors

- **Report discovery** is fixed-rule: `{root}/{mode}_sdcV_summary/rpt/{mode}_summary.json`; scanning is live (re-read on every request).
- **Line semantics**: comment (`#`) and empty lines are non-selectable; text/csv/xlsx all normalize to lines (`\t`-joined cells).
- **Filtering**: regex, `&&` = AND, contains-match, case-sensitive toggle, exclude-matches toggle, hide-waived toggle; invalid regex patterns are silently skipped.
- **Toolbar layout**: filters and actions live on two fixed rows so the action button (select-all/clear toggle) never reflows.
- **Waive semantics**: persisted waives are permanent (grey + strikethrough + disabled checkbox); temporary selections can be cleared; duplicates are allowed (append-only).
- **Pass-by-waive status**: an item whose every checkable line is waived reports `"pass by waive"` (green, grouped under Pass).
- **Waive-dir re-selection**: the remembered directory is cleared only on a full page reload of the dashboard or on switching root (module-level Set guard); SPA navigation does not re-trigger it.
- **Copilot**: one session per check item; manual first message (preset pre-filled but not auto-sent); streaming only forwards the assistant's reply parts; the done event relies on `info.time.completed`.
- **Ports**: Web 5173, Vite dev 5174, opencode 4096 (auto-incrementing if busy).
