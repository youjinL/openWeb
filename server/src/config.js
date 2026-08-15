export default {
  webPort: 5173,
  opencodePort: 4096,
  hostname: '127.0.0.1',
  maxXlsxRows: 100000,
  dataDir: new URL('../data/', import.meta.url).pathname,
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