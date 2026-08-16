# OpenWeb — Development Requirements

> This document is the **single source of truth** for the project's requirements. All implementation and future changes must be consistent with it.

## 1. Project Overview

An interactive web application for IC verification (SDC/CDC) report review that unifies the three-mode (**ac / dc / func**) flow of **parse → line-by-line inspection → AI-assisted analysis → waive export** into one tool.

- Parses `{mode}_sdcV_summary/rpt/{mode}_summary.json` reports and presents every check item with its status per mode.
- Each item has a detail page rendering the report line by line, with regex filtering, per-row waive selection, and waive-list generation.
- A built-in **Agent Copilot** floating panel uses `opencode serve`'s HTTP API to provide one conversational session per check item for AI-assisted analysis.
- Target environment: local / single-user use on WSL Ubuntu, accessed from a browser via `localhost`.

## 2. Technology Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript | SPA |
| UI | Ant Design 5 + custom CSS design system | tables, modals, switches, dialogs |
| Backend | Node.js + Express (ESM) | report scan, waive read/write, copilot proxy |
| Database | SQLite (`better-sqlite3`) | waive state, root directories, item↔session mapping |
| File parsing | built-in fs text read; `csv-parse` for CSV; `exceljs` for xlsx | |
| AI integration | opencode HTTP Server API (`opencode serve`) | session lifecycle managed by opencode |
| Streaming | SSE (backend proxies the opencode event stream to the frontend) | |

## 3. Architecture

```
Browser (React SPA)
   │  REST + SSE
   ▼
Web backend (Express, :5173)  ── SQLite
   │  HTTP Server API
   ▼
opencode serve (:4096)   ← auto-spawned by the backend on boot
```

- Backend: directory/report scanning, report reading & format conversion, waive file IO, item↔session mapping persistence, opencode proxy.
- opencode: conversational session lifecycle and message storage (reuses its native session capability).
- Web: transport and display only.

## 4. Directory Structure

```
openWeb/
├── development.md          # requirements (this file)
├── README.md               # usage & deployment
├── details.md              # delivery / implementation details
├── package.json            # root scripts (dev / start / build)
├── scripts/                # start.sh / stop.sh (background server)
├── Example/                # sample data
├── server/                 # Express backend
│   ├── index.js            # entry: serve + spawn opencode serve
│   ├── config.js           # ports, limits, default copilot prompt
│   ├── db.js               # better-sqlite3 schema
│   ├── routes/             # roots / modes / waive / copilot / browse / file
│   └── services/
│       ├── report.js       # scan & parse summary.json
│       ├── loader.js       # read text/csv/xlsx → lines
│       ├── waive.js        # waive file IO + persisted state
│       └── opencode.js     # opencode API client + SSE proxy
└── web/                    # React frontend (Vite)
```

## 5. Data Model

### 5.1 Report scanning
- Root directory `R`; lookup rule: `{R}/{mode}_sdcV_summary/rpt/{mode}_summary.json`, `mode ∈ {ac, dc, func}`.
- Existing modes are displayed (1–3 modes are all valid); a missing file means the mode is absent.
- `summary.json` structure:
  ```json
  { "check item name": { "Status": "Pass/Fail/To be review/...", "Report": "/abs/path/to/report" } }
  ```
- `Status` values are not hard-coded; unknown values render as-is with a neutral style. Known buckets: pass / fail / review / other.

### 5.2 Report line loading (detail page)
- The `Report` field points to a local file; dispatch by extension:
  - `.log/.txt/.rpt/no extension` → read as text lines
  - `.csv` → parsed with `csv-parse`, cells joined with **TAB** into one line
  - `.xlsx` → first sheet parsed with `exceljs`, cells joined with **TAB**, capped at a configurable row limit (default 100 000)
- Missing file → placeholder message; lines are not selectable.
- Line shape: `{ lineNo, text, isComment (starts with #), isEmpty }`.

## 6. Core Feature Design

### 6.1 Home dashboard (mode overview)
- Top bar: **root directory selector** (dropdown of historical roots; add / delete; re-scan on switch; waive state isolated per root).
- Global **name filter** search box filters check items by name across all modes.
- Overview section: counts of pass / fail / to-be-review / other, and total check count.
- Per-mode card (ac / dc / func, shown only if present): a Segmented status filter (All / Pass / Fail / Review), then every check item as a trace row with a **status LED** and a **status chip** (Pass=green, Fail=red, To be review=amber, pass by waive=green, other=neutral).
- Clicking an item navigates to the detail page.

### 6.2 Detail page (line-by-line inspection)
- Top header: Back button, `[MODE] item`, status chip (including `pass by waive`), clickable report path, Agent Copilot button.
- **Toolbar (two fixed rows)**:
  - Row 1 (filters): regex search box (`&&` joins multiple patterns with AND, contains-match), **Case sensitive** switch, **Exclude matches** switch, **Hide waived** switch.
  - Row 2 (actions): a single **toggle button** — "Select all visible rows (N)" when nothing is selected, otherwise "Clear selection (M)" — plus **Export Waiver**. The two-row layout keeps the buttons from reflowing when the label length changes.
- **Side item list**: all items of the current mode with their status; clicking switches the detail item.
- Line rendering:
  - Checkbox per row; **comment (`#`) and empty lines have no checkbox**.
  - **Waived (exported) rows**: grey background, strikethrough on the text, a `waived` tag, and a disabled checkbox; persisted in SQLite and retained after refresh.
  - **Temporarily selected (not yet exported) rows**: highlighted; clearing the selection restores the original color (not persisted).
  - `Hide waived` removes waived rows from the visible list.
- Paths like `/xxx/xxx` inside line text are clickable → open the file in the File Viewer page (same filter/select/waive behaviors, shared waive state).
- csv/xlsx reports are displayed as text lines with identical selection/filter/waive behavior.

### 6.3 Waive export flow
1. The user selects rows (temporarily highlighted).
2. Click **Export Waiver** → dialog asks for a **waive reason** (required).
3. Confirmation appends to the waive list file in the format:
   ```
   # Waive Item: <item name>
   # Waive Reason: <reason>
   <violation line 1>
   <violation line 2>
   ```
4. On success, the exported rows become **permanently grey** (disabled checkbox, persisted to SQLite, retained after refresh) and a toast shows the file path + row count (created vs appended).
5. **Waive save directory**: chosen through the directory-picker dialog on export when no directory is remembered. **Re-selection timing**: the remembered directory is cleared only when (a) the home dashboard is opened via a full page reload (F5), or (b) the root is switched to a different root. SPA navigation back to the dashboard and re-entering the detail page do **not** re-trigger directory selection.

### 6.4 Waive file rules
- File name: `{waive_dir}/{mode}.waive_val.list` (one file per mode).
- Existing file → **append** and inform the user ("appended to existing waive file").
- Missing file → create and write.
- **Duplicates allowed**: the same row may be appended repeatedly (no de-duplication).
- Multiple exports of the same item → additional `# Waive Item:` blocks.

### 6.5 Status override: "pass by waive"
- If **every checkable line** (non-comment, non-empty) of a check item is persisted as waived, the item's status becomes **`pass by waive`** instead of the summary status (e.g. fail).
- Applied on both the scan (`GET /modes`) and the item detail endpoint, so the home chip, the detail bar chip, and the side list all reflect it. The detail page refreshes its chip after each export.
- `pass by waive` is grouped under **Pass** in the overview statistics and status filters; the chip label renders as "PASS BY WAIVE" in green.

### 6.6 Agent Copilot (AI floating panel)
- Detail page **Agent Copilot** button opens a floating panel with:
  - **Output area** (agent reply, SSE streaming, markdown-rendered).
  - **Chat input** + send button; the panel can be docked to the right edge, resized from the corner/edge, collapsed to a hover-preview tab, and restored.
- **One session per item**: key = `(rootId, mode, itemName)`, mapping stored in SQLite.
  - First open: creates an opencode session (`POST /session`) and records the mapping.
  - Reopen: loads the history (`GET /session/:id/message`) and restores the session.
- On first open, a **preset prompt + the item's report/log content** is pre-filled into the input (editable); it is sent only when the user clicks Send.
- Preset prompt: built-in generic analysis template (mode/item/status/log placeholders), overridable via `server/config.js` defaults.
- Sending: `POST /session/:id/message` (backend proxy) while subscribing to the opencode `/event` SSE stream; only the assistant's reply parts are forwarded to the frontend.

### 6.7 Root deletion
- Deleting a root removes its `waived_lines`, `copilot_sessions` rows, and the root itself.
- It also best-effort deletes the associated opencode sessions via the opencode API (`DELETE /session/:id`); the response reports how many opencode sessions were deleted (`deletedOpencodeSessions`).

### 6.8 Agent connection & opencode serve lifecycle

**Connection modes** (selected by environment variables, no code changes):
- **Remote mode** — when `OPENCODE_BASE_URL` is set (e.g. a company intranet opencode server): the backend connects directly to that URL and **skips** local probing/spawning. A startup health check against `${base}/global/health` logs success or a warning but never blocks boot.
- **Local mode (default)** — when `OPENCODE_BASE_URL` is unset: probe `127.0.0.1:{OPENCODE_PORT}` for an existing `opencode serve`; attach if healthy, otherwise **spawn** `opencode serve --hostname 127.0.0.1 --port <p>`, trying ports `4096..4105`; throw if none available.

**Configuration environment variables:**

| Variable | Default | Notes |
|---|---|---|
| `OPENCODE_BASE_URL` | *(unset)* | Remote opencode server base URL; setting it switches to remote mode. |
| `OPENCODE_TOKEN` | *(empty)* | Sent as `Authorization: Bearer <token>` on every opencode REST + SSE request (company servers with auth). |
| `OPENCODE_PORT` | `4096` | Local opencode port; only used when `OPENCODE_BASE_URL` is unset. |
| `OPENWEB_PORT` | `5173` | Web server port. |
| `OPENWEB_HOST` | `0.0.0.0` | Web server bind address; `0.0.0.0` exposes it on the LAN. |
| `OPENWEB_DATA_DIR` | `server/data` | Directory for the SQLite database. |

**Auth**: the bearer token is applied uniformly by `authHeaders()` in `server/src/services/opencode.js` — both for REST calls and the `/event` SSE stream. If the target server uses a different header/scheme, that single function is the only place to adjust.

**Model / provider**: configured inside opencode itself (CLI or `~/.config/opencode/opencode.json`), not in OpenWeb; in remote mode the server operator controls it.

**Lifecycle**: on backend exit, the spawned local child process is released (graceful SIGINT/SIGTERM handler).

## 7. API Design (backend)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/roots` | list root directories |
| POST | `/api/roots` | add a root directory |
| DELETE | `/api/roots/:id` | delete root + waive/session cascades + best-effort opencode session cleanup |
| GET | `/api/roots/:id/modes` | scan and return modes + items (waive-aware status) |
| GET | `/api/roots/:id/modes/:mode/items/:item` | item detail: lines + persisted waive flags + status |
| GET | `/api/roots/:id/modes/:mode/items/:item/waived` | persisted waived rows of the item |
| POST | `/api/roots/:id/modes/:mode/items/:item/waive` | export waive (body `{ reason, lines[] }`); detects existing file and appends |
| GET | `/api/roots/:id/modes/:mode/waive-file` | read current waive list file content |
| GET | `/api/roots/:id/waive-dir` | read remembered waive save directory |
| POST | `/api/roots/:id/waive-dir` | set the waive save directory |
| DELETE | `/api/roots/:id/waive-dir` | clear the remembered waive save directory |
| GET | `/api/browse?path=` | browse directory tree |
| GET | `/api/file/content?path=&rootId=&mode=&item=` | load any file, optionally merged with waive flags |
| GET | `/api/copilot/:rootId/:mode/:item` | session info + history + preset |
| POST | `/api/copilot/:rootId/:mode/:item/ensure` | create session if missing |
| POST | `/api/copilot/:rootId/:mode/:item/message` | send a message |
| GET | `/api/copilot/:rootId/:mode/:item/stream` | SSE stream (forwarded assistant reply parts) |

## 8. Database Schema (SQLite)

```sql
CREATE TABLE roots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  waive_dir TEXT,            -- remembered waive save directory
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE waived_lines (   -- permanent waive state
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  item TEXT NOT NULL,
  line_no INTEGER NOT NULL,   -- keyed by line number
  content TEXT NOT NULL,      -- row content (for display restore)
  waive_reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(root_id, mode, item, line_no)
);
CREATE TABLE copilot_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  item TEXT NOT NULL,
  session_id TEXT NOT NULL,   -- opencode session id
  created_at TEXT, updated_at TEXT,
  UNIQUE(root_id, mode, item)
);
```

## 9. Edge Cases & Notes

1. Report file missing → detail page shows a placeholder; lines are not selectable.
2. An item's `Report` is empty → placeholder shown.
3. Large files → frontend renders only the visible window; filtering happens in memory.
4. Large xlsx → only the first sheet is read, row count capped (configurable, default 100 000).
5. Waive directory change → a later export still appends to the existing file and informs the user.
6. Root deletion → its SQLite records (waive state, session mapping) and associated opencode sessions are removed to avoid dangling data.
7. opencode session lost/cleaned → a failed `GET /session/:id` triggers session recreation.
8. Concurrent multi-user editing of the same item is out of scope (single-machine tool).

## 10. Development Phases

1. **Phase 1 (foundation)**: scaffold, database, root management, report scanning, mode overview page.
2. **Phase 2 (detail page)**: report loading (text/csv/xlsx), line rendering, regex filtering, selection + waive export, permanent grey persistence, waive file append, directory picker.
3. **Phase 3 (Agent Copilot)**: opencode serve bootstrap, session mapping & restore, floating panel, SSE streaming, preset prompt.
4. **Phase 4 (polish & status semantics)**: clickable file paths, pass-by-waive status, hide-waived / exclude switches, merged action button, two-row toolbar, waive-dir re-selection timing, copilot dock/resize/preview, UI polish, sample-data verification.
