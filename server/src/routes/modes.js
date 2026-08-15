import express from 'express';
import { db } from '../db.js';
import { scanRoot, MODES } from '../services/report.js';
import { loadReport } from '../services/loader.js';
import { getWaivedLines } from '../services/waive.js';

const router = express.Router();

function requireRoot(req, res) {
  const id = Number(req.params.rootId);
  const row = db.prepare('SELECT * FROM roots WHERE id = ?').get(id);
  if (!row) {
    res.status(404).json({ error: 'root not found' });
    return null;
  }
  return row;
}

router.get('/:rootId/modes', (req, res) => {
  const root = requireRoot(req, res);
  if (!root) return;
  const scanned = scanRoot(root.path);
  if (!scanned) return res.status(400).json({ error: 'root not accessible' });
  res.json(scanned);
});

router.get('/:rootId/modes/:mode/items/:item', async (req, res) => {
  const root = requireRoot(req, res);
  if (!root) return;
  const { mode, item } = req.params;
  if (!MODES.includes(mode)) return res.status(400).json({ error: 'unknown mode' });
  const scanned = scanRoot(root.path);
  const modeData = scanned?.modes.find((m) => m.mode === mode);
  const itemData = modeData?.items.find((i) => i.name === item);
  if (!itemData) return res.status(404).json({ error: 'check item not found' });
  const loaded = await loadReport(itemData.report);
  const waived = getWaivedLines(root.id, mode, item);
  const waivedSet = new Set(waived.map((w) => w.line_no));
  const lines = loaded.lines.map((l) => ({
    ...l,
    waived: waivedSet.has(l.line_no),
  }));
  res.json({
    mode,
    item,
    status: itemData.status,
    reportPath: itemData.report,
    format: loaded.format,
    missing: loaded.missing,
    lines,
    waivedInfo: waived,
  });
});

export default router;