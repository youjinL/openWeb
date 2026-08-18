import { spawn, execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import config from '../config.js';

let serverProc = null;
let port = config.opencodePort;

const state = {
  mode: 'idle', // idle | remote | local-attached | local-discovered | local-scanned | local-spawned
  baseUrl: null,
  version: null,
  healthy: false,
  lastError: null,
  lastCheckedAt: null,
  localFallbackTried: false,
};

function authHeaders() {
  if (config.opencodePassword) {
    const user = config.opencodeUsername || 'opencode';
    const cred = Buffer.from(`${user}:${config.opencodePassword}`).toString('base64');
    return { authorization: `Basic ${cred}` };
  }
  return config.opencodeToken ? { authorization: `Bearer ${config.opencodeToken}` } : {};
}

function healthPath(base) {
  return `${base}/global/health`;
}

async function healthInfo(base, timeout = 1500) {
  try {
    const res = await fetch(healthPath(base), {
      headers: authHeaders(),
      signal: AbortSignal.timeout(timeout),
    });
    if (res.ok) {
      const body = await res.json().catch(() => null);
      if (body?.healthy === true) return { version: body?.version ?? null };
    }
  } catch {
    /* not healthy */
  }
  return null;
}

function baseForPort(p) {
  return `http://127.0.0.1:${p}`;
}

function runCmd(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout) => {
      resolve(err ? '' : String(stdout));
    });
  });
}

/* ---------------- local discovery ---------------- */

async function discoverProcessPorts() {
  const ports = [];
  let sawProcess = false;
  try {
    const out = await runCmd('pgrep', ['-f', '[o]pencode serve']);
    const pids = out
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (pids.length > 0) sawProcess = true;
    for (const pid of pids) {
      try {
        const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
        const idx = cmdline.indexOf('--port');
        if (idx >= 0 && cmdline[idx + 1]) {
          const n = Number(cmdline[idx + 1]);
          if (Number.isInteger(n) && n > 0 && n < 65536) {
            ports.push(n);
            continue;
          }
        }
      } catch {
        /* process gone */
      }
      const lsof = await runCmd('lsof', ['-Pan', '-iTCP', '-sTCP:LISTEN', '-p', pid]);
      for (const line of lsof.split('\n')) {
        const m = line.match(/TCP\s+(?:\S+:)(\d+)\s+\(LISTEN\)/);
        if (m) {
          const n = Number(m[1]);
          if (Number.isInteger(n) && n > 0 && n < 65536) ports.push(n);
        }
      }
    }
  } catch {
    /* discovery unavailable */
  }
  return { ports: [...new Set(ports)], sawProcess };
}

async function scanPorts(rangeStr) {
  const parts = rangeStr.split('-').map((s) => parseInt(s, 10));
  if (!Number.isFinite(parts[0])) return null;
  const lo = Math.max(1, Math.min(parts[0], Number.isFinite(parts[1]) ? parts[1] : parts[0]));
  const hi = Math.min(65535, Math.max(parts[0], Number.isFinite(parts[1]) ? parts[1] : parts[0]));
  const skipLo = config.opencodePort;
  const skipHi = config.opencodePort + 12;
  const ports = [];
  for (let p = lo; p <= hi; p++) {
    if (p >= skipLo && p <= skipHi) continue;
    ports.push(p);
  }
  const CONCURRENCY = 64;
  for (let i = 0; i < ports.length; i += CONCURRENCY) {
    const batch = ports.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((p) => healthInfo(baseForPort(p), 800)));
    const hit = results.findIndex((r) => r);
    if (hit >= 0) return batch[hit];
  }
  return null;
}

function spawnServer() {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      return resolve(null);
    }
    let settled = false;
    let stdoutBuf = '';
    const kill = () => {
      try {
        proc.kill();
      } catch {}
    };
    const finish = (ok, p) => {
      if (settled) return;
      settled = true;
      if (ok) {
        serverProc = proc;
        resolve(p);
      } else {
        kill();
        resolve(null);
      }
    };
    proc.stdout.on('data', (d) => {
      stdoutBuf += d.toString();
      const m = stdoutBuf.match(/opencode server listening on http:\/\/[^:]+:(\d+)/);
      if (m) {
        const p = Number(m[1]);
        healthInfo(baseForPort(p), 3000).then((info) => {
          if (info) finish(true, p);
          else finish(false);
        });
      }
    });
    proc.stderr.on('data', (d) => {
      const text = String(d).trim();
      if (text) console.warn(`[opencode] serve stderr: ${text.slice(0, 300)}`);
    });
    proc.on('error', () => finish(false));
    proc.on('exit', (code) => {
      if (code !== 0) finish(false);
    });
    setTimeout(() => finish(false), 15000);
  });
}

async function discoverLocal() {
  // 1) preferred port + small window (fast path)
  for (let offset = 0; offset < 12; offset++) {
    const p = config.opencodePort + offset;
    const info = await healthInfo(baseForPort(p), 1000);
    if (info) return { mode: 'local-attached', url: baseForPort(p), version: info.version };
  }
  // 2) process-based discovery: pgrep + /proc argv + lsof
  const { ports, sawProcess } = await discoverProcessPorts();
  for (const p of ports) {
    const info = await healthInfo(baseForPort(p), 1000);
    if (info) return { mode: 'local-discovered', url: baseForPort(p), version: info.version };
  }
  // 3) spawn our own instance on a random port (no manual port needed)
  if (!config.noSpawn) {
    const sp = await spawnServer();
    if (sp) {
      const info = await healthInfo(baseForPort(sp), 3000);
      return { mode: 'local-spawned', url: baseForPort(sp), version: info?.version ?? null };
    }
  }
  // 4) last resort: broad scan, only justified if an opencode process exists
  if (sawProcess) {
    const hit = await scanPorts(config.opencodeScanRange);
    if (hit) {
      const info = await healthInfo(baseForPort(hit), 1000);
      if (info) return { mode: 'local-scanned', url: baseForPort(hit), version: info.version };
    }
  }
  return null;
}

/* ---------------- server lifecycle ---------------- */

export async function ensureServer() {
  if (state.baseUrl && state.healthy) return state.baseUrl;

  if (config.opencodeBaseUrl) {
    if (state.baseUrl && state.mode === 'remote') {
      if (state.healthy) return state.baseUrl;
      if (state.localFallbackTried) return state.baseUrl; // fail fast; don't re-discover every call
    }
    const remote = config.opencodeBaseUrl;
    state.mode = 'remote';
    state.baseUrl = remote;
    let info = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 3 && !info; attempt++) {
      try {
        info = await healthInfo(remote, 3000);
      } catch (e) {
        lastErr = e;
      }
      if (!info && attempt < 2) await new Promise((r) => setTimeout(r, 1500));
    }
    if (!info) {
      const e = lastErr ?? new Error(`health check failed at ${remote}`);
      state.healthy = false;
      state.lastError = e.message;
      state.lastCheckedAt = new Date().toISOString();
      console.warn(`[opencode] remote server unreachable at ${remote}: ${e.message}; trying local discovery`);
      const found = await discoverLocal();
      if (found) {
        state.mode = found.mode === 'local-spawned' ? 'local-spawned' : 'local-discovered';
        state.baseUrl = found.url;
        state.healthy = true;
        state.version = found.version;
        state.lastError = null;
        state.lastCheckedAt = new Date().toISOString();
        state.localFallbackTried = false;
        console.log(`[opencode] remote unreachable, using local instance at ${found.url}`);
        return found.url;
      }
      state.localFallbackTried = true;
      state.lastError = `remote unreachable (${e.message}) and no local instance found`;
      return remote; // let subsequent calls surface clear per-call errors
    }
    state.healthy = true;
    state.version = info.version;
    state.lastError = null;
    state.lastCheckedAt = new Date().toISOString();
    state.localFallbackTried = false;
    console.log(`[opencode] connected to remote server at ${remote}`);
    return remote;
  }

  const found = await discoverLocal();
  if (found) {
    state.mode = found.mode;
    state.baseUrl = found.url;
    port = Number(new URL(found.url).port) || port;
    state.healthy = true;
    state.version = found.version;
    state.lastError = null;
    state.lastCheckedAt = new Date().toISOString();
    console.log(`[opencode] connected to opencode at ${found.url} (${found.mode})`);
    return found.url;
  }

  throw new Error(
    'Failed to start or discover opencode serve. Make sure opencode is installed and reachable (see /api/opencode/status).'
  );
}

export function getServerUrl() {
  return state.baseUrl;
}

export function getServerPort() {
  return port;
}

export function getStatus() {
  return {
    mode: state.mode,
    baseUrl: state.baseUrl,
    port: state.baseUrl ? Number(new URL(state.baseUrl).port) || null : null,
    version: state.version,
    healthy: state.healthy,
    lastError: state.lastError,
    lastCheckedAt: state.lastCheckedAt,
    pid: serverProc?.pid ?? null,
    eventStream: sseController ? 'connected' : 'idle',
  };
}

/* ---------------- REST client ---------------- */

async function ocFetch(pathname, options = {}) {
  const url = await ensureServer();
  const target = url + pathname;
  let res;
  try {
    res = await fetch(target, {
      headers: { 'content-type': 'application/json', ...authHeaders(), ...(options.headers || {}) },
      ...options,
    });
  } catch (e) {
    state.lastError = e.message;
    const err = new Error(`opencode connection failed: ${e.message}`, { cause: e });
    err.status = 502;
    throw err;
  }
  state.lastError = null;
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

export function deleteSession(id) {
  return ocFetch(`/session/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export function listSkills() {
  return ocFetch('/skill');
}

export function replyPermission(requestID, reply, message) {
  return ocFetch(`/permission/${encodeURIComponent(requestID)}/reply`, {
    method: 'POST',
    body: JSON.stringify({ reply, ...(message ? { message } : {}) }),
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
  const reader = (async () => {
    while (!sseController.signal.aborted) {
      let base = null;
      try {
        base = await ensureServer();
      } catch (e) {
        state.lastError = e.message;
      }
      if (base) {
        try {
          const res = await fetch(`${base}/event`, {
            headers: authHeaders(),
            signal: sseController.signal,
          });
          if (!res.ok || !res.body) {
            throw new Error(`bad event stream (${res.status})`);
          }
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
          state.lastError = e.message;
          if (sseController.signal.aborted) return;
        }
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