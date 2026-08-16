function envInt(name, fallback) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function envStr(name, fallback = '') {
  const v = process.env[name];
  return v == null || v === '' ? fallback : v;
}

export default {
  webPort: envInt('OPENWEB_PORT', 5173),
  hostname: envStr('OPENWEB_HOST', '0.0.0.0'),
  opencodePort: envInt('OPENCODE_PORT', 4096),
  opencodeBaseUrl: envStr('OPENCODE_BASE_URL', '').replace(/\/+$/, ''),
  opencodeToken: envStr('OPENCODE_TOKEN', ''),
  maxXlsxRows: 100000,
  dataDir: envStr('OPENWEB_DATA_DIR', new URL('../data/', import.meta.url).pathname),
  defaultPrompts: [
    {
      name: 'Generic Analysis',
      template: `Please analyze the report/log content for the following IC validation check:

- Mode: {mode}
- Check Item: {item}
- Status: {status}
- Report file: {reportPath}

Report/log content (each line prefixed with a line number):
{log}

Please:
1. Summarize the current status and core issues of this check
2. List all suspected violation lines (with line numbers)
3. Analyze the possible causes of each violation category
4. Provide recommended next steps`
    }
  ]
};