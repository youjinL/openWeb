import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import config from './config.js';
import { ensureServer, stopOpenCodeServer } from './services/opencode.js';
import rootsRouter from './routes/roots.js';
import modesRouter from './routes/modes.js';
import waiveRouter from './routes/waive.js';
import copilotRouter from './routes/copilot.js';
import browseRouter from './routes/browse.js';
import fileRouter from './routes/file.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/roots', rootsRouter);
app.use('/api/roots', modesRouter);
app.use('/api/roots', waiveRouter);
app.use('/api/copilot', copilotRouter);
app.use('/api/browse', browseRouter);
app.use('/api/file', fileRouter);

const webDist = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

async function main() {
  try {
    await ensureServer();
  } catch (e) {
    console.warn(`[warn] ${e.message}`);
  }

  const port = config.webPort;
  const server = app.listen(port, config.hostname, () => {
    console.log(`[openweb] Web server running at http://${config.hostname}:${port}`);
  });

  const shutdown = () => {
    server.close();
    stopOpenCodeServer();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});