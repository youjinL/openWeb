import express from 'express';
import path from 'node:path';
import { db } from '../db.js';
import {
  getWaiveDir,
  setWaiveDir,
  appendWaive,
  readWaiveFile,
  insertWaivedLines,
  getWaivedLines,
} from '../services/waive.js';

const router = express.Router();

router.get('/:rootId/waive-dir', (req, res) => {
  const root = db.prepare('SELECT * FROM roots WHERE id = ?').get(Number(req.params.rootId));
  if (!root) return res.status(404).json({ error: 'root not found' });
  res.json({ waive_dir: root.waive_dir });
});

router.delete('/:rootId/waive-dir', (req, res) => {
  const rootId = Number(req.params.rootId);
  setWaiveDir(rootId, null);
  res.json({ waive_dir: null });
});

router.post('/:rootId/waive-dir', (req, res) => {
  const rootId = Number(req.params.rootId);
  const dir = String(req.body?.dir ?? '').trim();
  if (!dir) return res.status(400).json({ error: 'directory is required' });
  const resolved = path.resolve(dir);
  db.prepare('UPDATE roots SET waive_dir = ? WHERE id = ?').run(resolved, rootId);
  res.json({ waive_dir: resolved });
});

router.post('/:rootId/modes/:mode/items/:item/waive', (req, res) => {
  const rootId = Number(req.params.rootId);
  const { mode, item } = req.params;
  const { reason, lines } = req.body ?? {};
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'waive reason is required' });
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'no rows to export' });
  }
  const validLines = lines
    .filter((l) => l && typeof l.lineNo === 'number' && typeof l.text === 'string' && l.text.trim() !== '')
    .map((l) => l.text.replace(/\r?\n/g, ''));
  if (validLines.length === 0) return res.status(400).json({ error: 'no rows to export' });

  const existingDir = getWaiveDir(rootId);
  if (!existingDir) {
    return res.status(409).json({ error: 'NO_WAIVE_DIR', message: 'set a waive save directory first' });
  }
  const result = appendWaive(rootId, mode, item, String(reason).trim(), validLines);
  insertWaivedLines(rootId, mode, item, String(reason).trim(), lines);
  res.json({ ...result, exported: validLines.length, reason: String(reason).trim() });
});

router.get('/:rootId/modes/:mode/waive-file', (req, res) => {
  const rootId = Number(req.params.rootId);
  const { mode } = req.params;
  res.json(readWaiveFile(rootId, mode));
});

router.get('/:rootId/modes/:mode/items/:item/waived', (req, res) => {
  const rootId = Number(req.params.rootId);
  const { mode, item } = req.params;
  res.json(getWaivedLines(rootId, mode, item));
});

export default router;