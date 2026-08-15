import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import config from '../config.js';

let baseUrl = null;
let serverProc = null;
let port = config.opencodePort;

function healthUrl(p) {
  return `http://127.0.0.1:${p}/global/health`;
}

async function isOpenCodeRunning(p) {
  try {
    const res = await fetch(healthUrl(p), { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const body = await res.json();
      return body?.healthy === true;
    }
    return false;
  } catch {
    return false;
  }
}

async function waitHealthy(p, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (await isOpenCodeRunning(p)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function ensureServer() {
  if (baseUrl) return baseUrl;
  if (await isOpenCodeRunning(port)) {
    baseUrl = `http://127.0.0.1:${port}`;
    console.log(`[opencode] connected to existing server at ${baseUrl}`);
    return baseUrl;
  }
  for (let offset = 0; offset < 10; offset++) {
    const p = port + offset;
    if (await isOpenCodeRunning(p)) {
      port = p;
      baseUrl = `http://127.0.0.1:${p}`;
      console.log(`[opencode] connected to existing server at ${baseUrl}`);
      return baseUrl;
    }
    const ok = await spawnServer(p);
    if (ok) {
      port = p;
      baseUrl = `http://127.0.0.1:${p}`;
      console.log(`[opencode] spawned server at ${baseUrl}`);
      return baseUrl;
    }
  }
  throw new Error('Failed to start opencode serve. Please make sure opencode is installed');
}

function spawnServer(p) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', String(p)], {
        stdio: 'ignore',
        detached: false,
      });
    } catch {
      return resolve(false);
    }
    let settled = false;
    proc.on('error', () => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    });
    proc.on('exit', (code) => {
      if (!settled && code !== 0) {
        settled = true;
        resolve(false);
      }
    });
    waitHealthy(p).then((ok) => {
      if (!settled) {
        settled = true;
        if (ok) {
          serverProc = proc;
          resolve(true);
        } else {
          proc.kill();
          resolve(false);
        }
      }
    });
  });
}

export function getServerUrl() {
  return baseUrl;
}

export function getServerPort() {
  return port;
}

async function ocFetch(pathname, options = {}) {
  const url = await ensureServer();
  const res = await fetch(url + pathname, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`opencode api error ${res.status}: ${text.slice(0, 500)}`);
    err.status = res.status;
    throw err;
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

export function createSession(title) {
  return ocFetch('/session', {
    method: 'POST',
    body: JSON.stringify(title ? { title } : {}),
  });
}

export function getSession(id) {
  return ocFetch(`/session/${encodeURIComponent(id)}`);
}

export function getMessages(id) {
  return ocFetch(`/session/${encodeURIComponent(id)}/message`);
}

export function sendMessageAsync(id, body) {
  return ocFetch(`/session/${encodeURIComponent(id)}/prompt_async`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/* ---------------- SSE event proxy ---------------- */

const eventsBus = new EventEmitter();
const SUB_KEY = 'oc-event';
let sseController = null;
let reconnectTimer = null;

function startEventStream() {
  if (sseController) return;
  sseController = new AbortController();
  const base = baseUrl || `http://127.0.0.1:${port}`;
  const reader = (async () => {
    while (!sseController.signal.aborted) {
      try {
        const res = await fetch(`${base}/event`, { signal: sseController.signal });
        if (!res.ok || !res.body) throw new Error('bad event stream');
        const stream = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await stream.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            handleSseChunk(chunk);
          }
        }
      } catch (e) {
        if (sseController.signal.aborted) return;
      }
      await new Promise((r) => (reconnectTimer = setTimeout(r, 3000)));
    }
  })();
  void reader;
}

function handleSseChunk(chunk) {
  let dataText = null;
  for (const line of chunk.split('\n')) {
    if (line.startsWith('data:')) dataText = line.slice(5).trim();
  }
  if (dataText == null) return;
  let data;
  try {
    data = JSON.parse(dataText);
  } catch {
    return;
  }
  const props = data?.properties ?? data ?? {};
  const sessionID = props?.sessionID ?? props?.sessionId ?? null;
  eventsBus.emit(SUB_KEY, { eventName: data?.type ?? 'message', data: props, sessionID });
}

export function subscribeEvents(listener) {
  startEventStream();
  eventsBus.on(SUB_KEY, listener);
  return () => eventsBus.off(SUB_KEY, listener);
}

export function abortEventStream() {
  if (sseController) {
    sseController.abort();
    sseController = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

export function getOpenCodePid() {
  return serverProc?.pid ?? null;
}

export function stopOpenCodeServer() {
  if (serverProc) {
    try {
      serverProc.kill();
    } catch {}
    serverProc = null;
  }
  abortEventStream();
}

export function ensureDataDir() {
  fs.mkdirSync(config.dataDir, { recursive: true });
}
void ensureDataDir;