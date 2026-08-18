import express from 'express';
import { loadReport } from '../services/loader.js';
import { getWaivedLines } from '../services/waive.js';
import { asyncHandler } from '../asyncHandler.js';

const router = express.Router();

router.get('/content', asyncHandler(async (req, res) => {
  const filePath = String(req.query.path ?? '');
  if (!filePath) return res.status(400).json({ error: 'missing path' });
  const loaded = await loadReport(filePath);
  const { rootId, mode, item } = req.query;
  let waivedSet = new Set();
  if (rootId && mode && item) {
    const waived = getWaivedLines(Number(rootId), String(mode), String(item));
    waivedSet = new Set(waived.map((w) => w.line_no));
  }
  const lines = loaded.lines.map((l) => ({ ...l, waived: waivedSet.has(l.lineNo) }));
  res.json({
    path: filePath,
    format: loaded.format,
    missing: loaded.missing,
    lines,
  });
}));

export default router;