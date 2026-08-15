import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

const router = express.Router();

router.get('/', (req, res) => {
  const start = req.query.path ? String(req.query.path) : null;
  const root = start ?? '/';
  let dirs = [];
  let parent = null;
  if (fs.existsSync(root)) {
    try {
      const stat = fs.statSync(root);
      if (stat.isDirectory()) {
        dirs = fs
          .readdirSync(root, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
          .map((d) => ({ name: d.name, path: path.join(root, d.name) }))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (root !== '/') parent = path.dirname(root);
      } else {
        return res.json({ root, isDir: false, parent, dirs: [] });
      }
    } catch {
      return res.json({ root, isDir: false, parent, dirs: [] });
    }
  }
  res.json({ root, isDir: true, parent, dirs });
});

export default router;