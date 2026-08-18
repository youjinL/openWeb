import express from 'express';
import { db } from '../db.js';
import config from '../config.js';
import { scanRoot, MODES } from '../services/report.js';
import { loadReport } from '../services/loader.js';
import { asyncHandler } from '../asyncHandler.js';
import * as oc from '../services/opencode.js';

const router = express.Router();

function getMapping(rootId, mode, item) {
  return db.prepare('SELECT * FROM copilot_sessions WHERE root_id = ? AND mode = ? AND item = ?').get(rootId, mode, item);
}

function saveMapping(rootId, mode, item, sessionId) {
  db.prepare(
    `INSERT INTO copilot_sessions (root_id, mode, item, session_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(root_id, mode, item) DO UPDATE SET session_id = excluded.session_id, updated_at = datetime('now')`
  ).run(rootId, mode, item, sessionId);
}

async function buildPreset(rootId, mode, item) {
  const root = db.prepare('SELECT * FROM roots WHERE id = ?').get(rootId);
  if (!root) return null;
  const scanned = scanRoot(root.path);
  const itemData = scanned?.modes.find((m) => m.mode === mode)?.items.find((i) => i.name === item);
  if (!itemData) return null;
  const loaded = await loadReport(itemData.report);
  const logBody = loaded.lines
    .map((l) => `${String(l.lineNo).padStart(6)}| ${l.text}`)
    .slice(0, 500)
    .join('\n');
  const template =
    config.defaultPrompts[0]?.template ??
    'Please analyze the following check report:\nMode: {mode}\nItem: {item}\nStatus: {status}\nReport: {reportPath}\n{log}';
  const preset = template
    .replaceAll('{mode}', mode)
    .replaceAll('{item}', item)
    .replaceAll('{status}', itemData.status)
    .replaceAll('{reportPath}', itemData.report ?? '')
    .replaceAll('{log}', logBody || '(file is empty or missing)');
  return { preset, status: itemData.status, reportPath: itemData.report };
}

router.get('/:rootId/:mode/:item', asyncHandler(async (req, res) => {
  const { rootId, mode, item } = req.params;
  if (!MODES.includes(mode)) return res.status(400).json({ error: 'unknown mode' });
  const mapping = getMapping(Number(rootId), mode, item);
  let session = null;
  let messages = [];
  if (mapping) {
    try {
      session = await oc.getSession(mapping.session_id);
      messages = await oc.getMessages(mapping.session_id);
    } catch {
      session = null;
      messages = [];
    }
  }
  const presetInfo = await buildPreset(Number(rootId), mode, item);
  res.json({
    sessionID: session?.id ?? mapping?.session_id ?? null,
    sessionExists: !!session,
    messages: messages.map(normalizeMessage),
    preset: presetInfo?.preset ?? '',
    status: presetInfo?.status ?? '',
    reportPath: presetInfo?.reportPath ?? null,
  });
}));

router.post('/:rootId/:mode/:item/ensure', asyncHandler(async (req, res) => {
  const { rootId, mode, item } = req.params;
  const rid = Number(rootId);
  const mapping = getMapping(rid, mode, item);
  if (mapping) {
    try {
      const s = await oc.getSession(mapping.session_id);
      return res.json({ sessionID: s.id, sessionExists: true });
} catch {
        /* session lost, recreate */
      }
  }
  const created = await oc.createSession(`${mode} / ${item}`);
  saveMapping(rid, mode, item, created.id);
  res.json({ sessionID: created.id, sessionExists: false });
}));

router.post('/:rootId/:mode/:item/message', asyncHandler(async (req, res) => {
  const { rootId, mode, item } = req.params;
  const { content } = req.body ?? {};
  if (!content || !String(content).trim()) return res.status(400).json({ error: 'message is required' });
  const mapping = getMapping(Number(rootId), mode, item);
  if (!mapping) return res.status(404).json({ error: 'session not found, initialize it first' });
  await oc.sendMessageAsync(mapping.session_id, {
    parts: [{ type: 'text', text: String(content) }],
  });
  res.json({ sessionID: mapping.session_id });
}));

router.get('/:rootId/:mode/:item/skills', asyncHandler(async (req, res) => {
  const { rootId, mode, item } = req.params;
  if (!MODES.includes(mode)) return res.status(400).json({ error: 'unknown mode' });
  try {
    const skills = await oc.listSkills();
    res.json({ skills });
  } catch (e) {
    res.status(502).json({ error: `failed to list skills: ${e.message}` });
  }
}));

router.post('/permission/:requestID/reply', asyncHandler(async (req, res) => {
  const { requestID } = req.params;
  const { reply, message } = req.body ?? {};
  if (!['once', 'always', 'reject'].includes(reply)) {
    return res.status(400).json({ error: "reply must be one of 'once' | 'always' | 'reject'" });
  }
  try {
    await oc.replyPermission(requestID, reply, message);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: `failed to reply permission: ${e.message}` });
  }
}));

router.get('/:rootId/:mode/:item/stream', asyncHandler((req, res) => {
  const { rootId, mode, item } = req.params;
  const mapping = getMapping(Number(rootId), mode, item);
  if (!mapping) return res.status(404).json({ error: 'session not found' });
  const sessionID = mapping.session_id;

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  send('connected', { sessionID });

  let currentAIMessageID = null;
  const unsub = oc.subscribeEvents(({ eventName, data, sessionID: sid }) => {
    if (sid !== sessionID) return;
    const part = data?.part;
    if (eventName === 'message.part.updated') {
      if (part?.type === 'step-start') {
        currentAIMessageID = part.messageID;
        return;
      }
      if (currentAIMessageID && part?.messageID === currentAIMessageID) {
        if (part.type === 'tool') {
          send('part', {
            messageID: part.messageID,
            partID: part.id,
            type: 'tool',
            tool: part.tool,
            callID: part.callID,
            state: part.state,
          });
        } else if (part?.text) {
          send('part', {
            messageID: part.messageID,
            partID: part.id,
            text: part.text,
            type: part.type === 'reasoning' ? 'reasoning' : 'text',
          });
        }
      }
    } else if (eventName === 'message.updated' && data?.info?.time?.completed) {
      send('done', { messageID: data?.info?.id });
      currentAIMessageID = null;
    } else if (eventName === 'message.part.error') {
      send('error', { message: 'agent reply failed' });
    } else if (eventName === 'permission.asked') {
      send('permission', data);
    } else if (eventName === 'permission.replied') {
      send('permission:replied', data);
    }
  });

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsub();
    res.end();
  });
}));

function normalizeMessage(m) {
  const parts = m?.parts ?? [];
  const text = parts
    .filter((p) => p?.type === 'text')
    .map((p) => p.text ?? '')
    .join('\n');
  const reasoning = parts
    .filter((p) => p?.type === 'reasoning')
    .map((p) => p.text ?? '')
    .join('\n');
  const tools = parts
    .filter((p) => p?.type === 'tool')
    .map((p) => ({
      callID: p?.callID ?? '',
      tool: p?.tool ?? 'tool',
      status: p?.state?.status ?? 'pending',
      input: toolInputText(p?.state?.input),
      title: p?.state?.title ?? '',
      output: p?.state?.metadata?.output ?? p?.state?.output ?? '',
      error: p?.state?.error ?? '',
    }));
  const role = m?.info?.role ?? 'user';
  return { id: m?.info?.id, role, text, reasoning, tools };
}

function toolInputText(input) {
  if (!input) return '';
  if (typeof input === 'string') return input;
  if (typeof input.command === 'string') return input.command;
  try {
    return JSON.stringify(input, null, 1);
  } catch {
    return String(input);
  }
}

export default router;