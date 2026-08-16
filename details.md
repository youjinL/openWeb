# OpenWeb — Project Details

Detailed description of the documentation structure and every script (backend, frontend, and tooling) in the OpenWeb project, including their functionality and key features.

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
├── development.md          # Requirement specification
├── README.md                # Install / run / feature overview
├── details.md               # This file
├── package.json             # npm workspaces (server, web)
├── package-lock.json
├── .server.pid              # PID file (runtime, created by scripts/start.sh)
├── Example/                 # Sample data (generated)
│   ├── ac_sdcV_summary/rpt/ac_summary.json
│   ├── dc_sdcV_summary/rpt/dc_summary.json
│   ├── func_sdcV_summary/rpt/func_summary.json
│   └── log/                 # sample .log / .xlsx report files
├── scripts/
│   ├── start.sh             # start web server in background (PID file)
│   └── stop.sh              # stop web server from PID file
├── server/
│   ├── package.json
│   ├── data/openweb.db      # SQLite database (runtime)
│   └── src/
│       ├── index.js         # express app entry
│       ├── config.js        # ports, limits, default copilot prompts
│       ├── db.js            # SQLite schema
│       ├── services/
│       │   ├── loader.js    # report file → lines (text/csv/xlsx)
│       │   ├── report.js    # root scan + mode/item discovery
│       │   ├── waive.js     # waive state + .waive_val.list file IO
│       │   └── opencode.js  # opencode serve lifecycle + SSE proxy
│       └── routes/
│           ├── roots.js     # root directory CRUD
│           ├── modes.js     # scan + item detail (with waive flags)
│           ├── waive.js     # waive-dir + export endpoints
│           ├── copilot.js   # session mgmt + SSE stream endpoint
│           ├── browse.js    # directory tree browsing
│           └── file.js      # generic file viewer content
└── web/
    ├── package.json
    ├── index.html           # fonts, root mount
    ├── vite.config.ts       # dev server + /api proxy
    ├── tsconfig.json        # TS config
    └── src/
        ├── main.tsx         # app bootstrap, AntD theme/locale
        ├── App.tsx          # router (/, /detail, /file)
        ├── api.ts           # typed API client
        ├── types.ts         # shared interfaces
        ├── index.css        # "Signal Check Bench" design system
        ├── pages/
        │   ├── Home.tsx         # root selection + mode tree
        │   ├── Detail.tsx       # check item log inspection + waive
        │   └── FileViewer.tsx   # standalone file viewer
        └── components/
            ├── WaiveDirModal.tsx  # waive dir picker
            └── CopilotPanel.tsx   # draggable AI panel
```

---

## 3. Documentation Structure

| File | Role |
|---|---|
| `development.md` | The single source of truth for requirements (in Chinese): features, decisions, conventions, and behavior rules captured during requirement Q&A. |
| `README.md` | Quick-start guide: environment, install, start/stop, feature summary, ports, storage. |
| `details.md` | This file: documentation layout + per-script function and feature reference. |

---

## 4. Root / Workspace Scripts

### `package.json` (root)
- npm **workspaces** wiring `server` and `web`.
- Scripts:
  - `dev` — run server + web dev server together via `concurrently`
  - `start` — build web then run server (production, single port)
  - `build` — build web only

---

## 5. Backend Scripts

### `server/src/index.js` — Express entry
- Mounts `cors`, `express.json` (10 MB limit).
- `GET /api/health` → `{ ok: true }`.
- Mounts routers under `/api/roots`, `/api/copilot`, `/api/browse`, `/api/file`.
- Serves built `web/dist` as static files and falls back to `index.html` for any non-`/api` route (SPA routing).
- On boot calls `ensureServer()` to attach to (or spawn) an `opencode serve` instance; logs warnings if unavailable.
- Graceful shutdown on SIGINT/SIGTERM closes the HTTP server and kills the spawned opencode process.

### `server/src/config.js` — Configuration
- `webPort` = 5173, `opencodePort` = 4096, `hostname` = 127.0.0.1.
- `maxXlsxRows` = 100000 (xlsx row cap).
- `dataDir` — resolves to `server/data/`.
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
- `insertWaivedLines` / `getWaivedLines` — SQLite persisted waive flags; `removeWaiveLines` for cleanup (currently unused by UI).

### `server/src/services/opencode.js` — opencode serve integration
- **Lifecycle**: probes `/global/health`; connects to an existing server or **spawns** `opencode serve --hostname 127.0.0.1 --port <p>`, scanning ports 4096→4105 until one works; throws if none available.
- **REST wrappers**: `createSession`, `getSession`, `getMessages`, `sendMessageAsync` (`/session/{id}/prompt_async`).
- **SSE proxy**: a single background reader consumes `GET /event`, parses `data:` JSON, extracts `sessionID` (from `properties`), and fans out via an `EventEmitter`.
- `subscribeEvents(listener)` / `abortEventStream()` / `stopOpenCodeServer()`.

### `server/src/routes/roots.js` — Root CRUD
- `GET /api/roots` — list roots ordered by id.
- `POST /api/roots` — validate directory exists; insert resolved path; duplicates return the existing row.
- `DELETE /api/roots/:id` — deletes root plus its `waived_lines` and `copilot_sessions`.

### `server/src/routes/modes.js` — Scan & item detail
- `GET /api/roots/:rootId/modes` — live scan of the root, returns modes/items/status.
- `GET /api/roots/:rootId/modes/:mode/items/:item` — loads the report, merges persisted waive flags into each line (`waived: true`), returns `{ mode, item, status, reportPath, format, missing, lines, waivedInfo }`.

### `server/src/routes/waive.js` — Waive endpoints
- `GET/POST /api/roots/:rootId/waive-dir` — read/set the waive save directory.
- `POST /api/roots/:rootId/modes/:mode/items/:item/waive` — validates reason + rows, **requires** a waive dir (else `409 NO_WAIVE_DIR`), appends to the list file and persists waive state; returns `{ file, existed, exported, reason }`.
- `GET /api/roots/:rootId/modes/:mode/waive-file` — raw content of the waive list file.
- `GET /api/roots/:rootId/modes/:mode/items/:item/waived` — persisted waived rows.

### `server/src/routes/copilot.js` — Copilot session + streaming
- Session keyed by `(rootId, mode, item)`; `saveMapping` upserts.
- `GET /api/copilot/:rootId/:mode/:item` — returns session status, message history (normalized to `{ id, role, text }`), and the **preset** (first prompt built from the default template + up to 500 log lines with line numbers).
- `POST .../ensure` — returns existing session or creates one (title `"{mode} / {item}"`).
- `POST .../message` — forwards the user text via `prompt_async`.
- `GET .../stream` — SSE. State machine: only `message.part.updated` parts belonging to the **current AI message** (set on `step-start`) are forwarded as `part` events (`type: reasoning|text`); `message.updated` with `info.time.complete` → `done`; `message.part.error` → `error`. Heartbeat `: ping` every 20 s.

### `server/src/routes/browse.js` — Directory tree
- `GET /api/browse?path=...` — lists subdirectories (hides dot-dirs), reports `isDir` and parent, for the waive-dir picker.

### `server/src/routes/file.js` — Generic file viewer
- `GET /api/file/content?path=...&rootId=&mode=&item=` — loads any file via `loader.js`; when the waive context params are present, merges persisted waive flags for that item.

### Backend API summary

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness |
| GET/POST | `/api/roots` | list / add root |
| DELETE | `/api/roots/:id` | delete root + cascades |
| GET | `/api/roots/:id/modes` | scan report tree |
| GET | `/api/roots/:id/modes/:mode/items/:item` | item detail + waive flags |
| GET/POST | `/api/roots/:id/waive-dir` | waive directory |
| POST | `/api/roots/:id/modes/:mode/items/:item/waive` | export waive |
| GET | `/api/roots/:id/modes/:mode/waive-file` | waive file content |
| GET | `/api/roots/:id/modes/:mode/items/:item/waived` | persisted waive rows |
| GET | `/api/browse` | directory listing |
| GET | `/api/file/content` | generic file content |
| GET/POST | `/api/copilot/:rid/:mode/:item(+/ensure/+/message)` | copilot sessions |
| GET | `/api/copilot/:rid/:mode/:item/stream` | SSE reply stream |

---

## 6. Frontend Scripts

### `web/src/main.tsx` — Bootstrap
- React 18 `createRoot`, `BrowserRouter`, AntD `ConfigProvider` with `locale={enUS}` and a theme token set: `colorPrimary`/`colorLink` `#0b6e79`, `borderRadius` 4, `fontFamily` IBM Plex Sans, `colorBgLayout` `#f2f4f6`.

### `web/src/App.tsx` — Router
- Routes: `/` → Home, `/detail` → Detail, `/file` → FileViewer.

### `web/src/api.ts` — API client
- Central `req()` wrapper over `fetch('/api/...')`; converts `NO_WAIVE_DIR` (409) into a rethrown error flagged `noWaiveDir`; otherwise surfaces `message`/`error` from the body. Typed methods for every backend endpoint, plus `copilotStreamUrl()` for the SSE URL.

### `web/src/types.ts` — Shared interfaces
- `RootInfo`, `CheckItem`, `ModeInfo`, `ScanResult`, `ReportLine`, `ItemDetail`, `CopilotMessage`, `CopilotInfo`, `WaiveResult`, `WaiveFileInfo`, `BrowseResult`.

### `web/src/pages/Home.tsx` — Root selection + mode tree
- Root selector + "Add root" (modal, absolute path) + delete with cascade warning.
- On root select: scans modes and renders each mode as a block; each check item is a **trace line with a status LED** (Pass green / Fail red / Review amber / neutral); clicking navigates to `/detail?rootId&mode&item`.
- Empty states for no-root and no-report cases.

### `web/src/pages/Detail.tsx` — Check item log inspection
- Toolbar: regex filter (auto-joined by `&&`, all patterns must match, case-sensitive toggle, Match/Exclude radio), Select-all-visible, Clear selection, Export Waiver.
- Line rendering: checkbox per row (skipped for comment/empty lines), line number gutter, content; **waived rows** are greyed, show a `waived` tag, and have a disabled checkbox.
- Waive flow: on export with no waive dir → opens `WaiveDirModal`; otherwise reason modal → POST → success message with file path + row count (created vs appended) → reload.
- Report path (top bar) is clickable → opens `/file` viewer.
- "Agent Copilot" button opens the floating copilot panel.

### `web/src/pages/FileViewer.tsx` — Standalone file viewer
- Loads `/api/file/content` for an arbitrary path; same toolbar, filter, selection, and waive-export behaviors (waive enabled only when `rootId/mode/item` context is present). Back button navigates history.

### `web/src/components/WaiveDirModal.tsx` — Waive directory picker
- Input for an absolute path + **Browse** panel: lists subdirectories, "Parent directory" up-link, "Use current directory" button, `Empty` states for non-dir / no-subdir. On confirm calls `setWaiveDir`.

### `web/src/components/CopilotPanel.tsx` — AI assistant panel
- Draggable (header) + resizable (corner) floating window.
- On open: loads copilot info; if no session, calls `ensure`; restores prior messages; pre-fills the input with the preset; opens the SSE stream.
- Streaming: accumulates `part` events per `messageID` into a `pending` buffer, rendered live with `ReactMarkdown`, flushed to the message list on `done`.
- Send: appends user bubble, calls `copilotSend`, 120 s fallback timeout to release the sending state. Enter to send, Shift+Enter for newline.

### `web/src/index.css` — "Signal Check Bench" design system
- Theme tokens: paper-gray background `#f2f4f6`, ink bar `#151a21` with teal `#0b6e79` accent, status colors pass `#17915a` / fail `#cf3f3f` / review `#c9760a`.
- Signature element: each check item is a **trace line + status LED** (clock-tree metaphor) in `mode-block`; LED enlarges on hover.
- Fonts: IBM Plex Mono (titles/data/line numbers), IBM Plex Sans (body), loaded via Google Fonts CDN in `index.html` (system fallbacks offline).
- Components styled: `benchbar` (home header), `detailbar` (detail header + actions), `mode-block`, `trace-item`, `status-chip`, `detail-toolbar`, `log-lines`, `waived` rows, `bench-empty`, `bench-loading`; responsive breakpoint at 720 px.

### `web/index.html` — Shell
- `<html lang="zh-CN">`, title "OpenWeb · SDC/CDC Sign-off Bench", Google Fonts preconnect + IBM Plex load, `#root` mount.

### `web/vite.config.ts` — Dev server
- Port 5174; proxies `/api` → `http://127.0.0.1:5173`.

---

## 7. Process Management Scripts

### `scripts/start.sh`
- Loads nvm, `cd`s to project root, `setsid nohup node server/src/index.js` in the background, writes PID to `.server.pid`; idempotent (skips if already running); tails the log at `/tmp/openweb-server.log`.
- The backend auto-spawns `opencode serve` on first copilot use.

### `scripts/stop.sh`
- Reads `.server.pid`, `kill`s the server (SIGTERM triggers graceful shutdown), removes the PID file; tolerates stale files. **Note: PID-file based — avoid `pkill -f` (it can kill unrelated WSL processes such as VSCode server).**

---

## 8. Data Persistence

- **SQLite** (`server/data/openweb.db`): roots (path + waive_dir), waived_lines (waive state, idempotent via UNIQUE + `INSERT OR IGNORE`), copilot_sessions (item→opencode session mapping, upsert).
- **Waive list files** on disk: `{waive_dir}/{mode}.waive_val.list`, appended per export (repeated waives accumulate; already-waived rows are never un-waived from the UI).
- **opencode sessions** are managed by opencode itself.

---

## 9. Key Design Decisions & Behaviors

- **Report discovery** is fixed-rule: `{root}/{mode}_sdcV_summary/rpt/{mode}_summary.json`; scanning is live (re-read on every request).
- **Line semantics**: comment (`#`) and empty lines are non-selectable; text/csv/xlsx all normalize to lines (`\t`-joined cells).
- **Filtering**: regex, case-sensitive toggle, `&&` = AND, contains-match; Match/Exclude mode; invalid regex patterns are silently skipped.
- **Waive semantics**: persisted waives are permanent (grey + disabled checkbox); temporary selections can be cleared; duplicates are allowed (append-only).
- **Copilot**: one session per check item; manual first message (preset pre-filled but not auto-sent); streaming only forwards the assistant's reply parts.
- **Ports**: Web 5173, Vite dev 5174, opencode 4096 (auto-incrementing if busy).