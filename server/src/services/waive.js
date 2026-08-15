import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';

export function getWaiveDir(rootId) {
  const row = db.prepare('SELECT waive_dir FROM roots WHERE id = ?').get(rootId);
  return row?.waive_dir ?? null;
}

export function setWaiveDir(rootId, dir) {
  db.prepare('UPDATE roots SET waive_dir = ? WHERE id = ?').run(dir, rootId);
}

export function waiveFilePath(rootId, mode) {
  const dir = getWaiveDir(rootId);
  if (!dir) return null;
  return path.join(dir, `${mode}.waive_val.list`);
}

export function readWaiveFile(rootId, mode) {
  const file = waiveFilePath(rootId, mode);
  if (!file || !fs.existsSync(file)) return { file: null, content: '' };
  return { file, content: fs.readFileSync(file, 'utf8') };
}

export function appendWaive(rootId, mode, item, reason, lines) {
  const dir = getWaiveDir(rootId);
  if (!dir) throw new Error('No waive save directory set');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${mode}.waive_val.list`);
  const existed = fs.existsSync(file);
  const block = ['', `# Waive Item: ${item}`, `# Waive Reason: ${reason}`, ...lines].join('\n') + '\n';
  fs.appendFileSync(file, block, 'utf8');
  return { file, existed };
}

export function removeWaiveLines(rootId, mode, item, lineNos) {
  const stmt = db.prepare(
    'DELETE FROM waived_lines WHERE root_id = ? AND mode = ? AND item = ? AND line_no = ?'
  );
  const tx = db.transaction((nos) => {
    for (const n of nos) stmt.run(rootId, mode, item, n);
  });
  tx(lineNos);
}

export function getWaivedLines(rootId, mode, item) {
  return db
    .prepare('SELECT line_no, content, waive_reason FROM waived_lines WHERE root_id = ? AND mode = ? AND item = ?')
    .all(rootId, mode, item);
}

export function insertWaivedLines(rootId, mode, item, reason, rows) {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO waived_lines (root_id, mode, item, line_no, content, waive_reason) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const tx = db.transaction((items) => {
    for (const r of items) stmt.run(rootId, mode, item, r.lineNo, r.text, reason);
  });
  tx(rows);
}