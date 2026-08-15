import fs from 'node:fs';
import path from 'node:path';

export const MODES = ['ac', 'dc', 'func'];

function summaryPathForMode(root, mode) {
  return path.join(root, `${mode}_sdcV_summary`, 'rpt', `${mode}_summary.json`);
}

export function scanRoot(root) {
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return null;
  }
  const modes = [];
  for (const mode of MODES) {
    const file = summaryPathForMode(root, mode);
    if (!fs.existsSync(file)) continue;
    let items = [];
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      items = Object.entries(data).map(([name, v]) => ({
        name,
        status: v?.Status ?? 'Unknown',
        report: v?.Report ?? null,
      }));
    } catch (e) {
      items = [{ name: `[parse failed] ${path.basename(file)}`, status: 'Error', report: null }];
    }
    modes.push({ mode, summaryFile: file, items });
  }
  return { root, modes };
}