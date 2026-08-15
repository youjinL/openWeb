import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import config from '../config.js';

function textToLines(text) {
  const raw = text.split(/\r?\n/);
  return raw.map((t, i) => {
    const lineNo = i + 1;
    const trimmed = t.trimEnd();
    const isEmpty = trimmed.trim() === '';
    const isComment = trimmed.trimStart().startsWith('#');
    return { lineNo, text: trimmed, isComment, isEmpty };
  });
}

async function loadCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  let records;
  try {
    records = parse(content, { relax_column_count: true, skip_empty_lines: false });
  } catch {
    return textToLines(content);
  }
  return records.map((row, i) => {
    const lineNo = i + 1;
    const text = row.map((c) => String(c ?? '')).join('\t');
    const isEmpty = text.trim() === '';
    const isComment = text.trimStart().startsWith('#');
    return { lineNo, text, isComment, isEmpty };
  });
}

async function loadXlsx(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const lines = [];
  let rowIndex = 0;
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (++rowIndex > config.maxXlsxRows) return;
    const text = row.values.slice(1).map((c) => String(c ?? '')).join('\t');
    const isEmpty = text.trim() === '';
    const isComment = text.trimStart().startsWith('#');
    lines.push({ lineNo: rowNumber, text, isComment, isEmpty });
  });
  return lines;
}

const TEXT_EXT = new Set(['.log', '.txt', '.rpt', '.csv', '.json', '.out', '' ]);

export async function loadReport(reportPath) {
  if (!reportPath || !fs.existsSync(reportPath)) {
    return { format: 'missing', lines: [], missing: true, path: reportPath };
  }
  const ext = path.extname(reportPath).toLowerCase();
  if (ext === '.xlsx' || ext === '.xls') {
    const lines = await loadXlsx(reportPath);
    return { format: 'xlsx', lines, missing: false, path: reportPath };
  }
  if (ext === '.csv') {
    const lines = await loadCsv(reportPath);
    return { format: 'csv', lines, missing: false, path: reportPath };
  }
  let content = '';
  try {
    content = fs.readFileSync(reportPath, 'utf8');
  } catch {
    return { format: 'missing', lines: [], missing: true, path: reportPath };
  }
  return { format: 'text', lines: textToLines(content), missing: false, path: reportPath };
}