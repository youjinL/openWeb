import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
const dbPath = path.join(config.dataDir, 'openweb.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS roots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  waive_dir TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS waived_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  item TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  content TEXT NOT NULL,
  waive_reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(root_id, mode, item, line_no)
);

CREATE TABLE IF NOT EXISTS copilot_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  item TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(root_id, mode, item)
);
`);