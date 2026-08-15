import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';

const router = express.Router();

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT id, path, waive_dir, created_at FROM roots ORDER BY id').all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const rootPath = (req.body?.path ?? '').trim();
  if (!rootPath) return res.status(400).json({ error: 'path is required' });
  const resolved = path.resolve(rootPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return res.status(400).json({ error: 'directory does not exist or is not accessible' });
  }
  try {
    const info = db.prepare('INSERT INTO roots (path) VALUES (?)').run(resolved);
    res.json({ id: info.lastInsertRowid, path: resolved, waive_dir: null });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      const existing = db.prepare('SELECT * FROM roots WHERE path = ?').get(resolved);
      return res.json(existing);
    }
    throw e;
  }
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const delRoot = db.prepare('DELETE FROM roots WHERE id = ?').run(id);
  db.prepare('DELETE FROM waived_lines WHERE root_id = ?').run(id);
  db.prepare('DELETE FROM copilot_sessions WHERE root_id = ?').run(id);
  res.json({ deleted: delRoot.changes > 0 });
});

export default router;