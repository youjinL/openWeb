import { useEffect, useRef, useState, useCallback } from 'react';
import { Button, Input, message, Popover, Spin, Tooltip } from 'antd';
import {
  CloseOutlined,
  SendOutlined,
  RobotOutlined,
  VerticalRightOutlined,
  ExpandOutlined,
  ThunderboltOutlined,
  CheckOutlined,
  StopOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkHighlightMark } from 'remark-highlight-mark';
import { visit } from 'unist-util-visit';
import rehypeHighlight from 'rehype-highlight';

function remarkMarkHName() {
  return (tree: any) => {
    visit(tree, 'highlight', (node: any) => {
      node.data = { ...(node.data ?? {}), hName: 'mark' };
    });
  };
}
import { api } from '../api';
import type { CopilotInfo, CopilotTool, PermissionRequest, SkillInfo } from '../types';

interface Props {
  rootId: number;
  mode: string;
  item: string;
  onClose: () => void;
}

interface StreamMsg {
  id: string;
  role: string;
  text: string;
  reasoning?: string;
  tools?: CopilotTool[];
}

interface PendingMsg {
  reasoning: string;
  text: string;
  tools: CopilotTool[];
}

type ResizeKind = 'corner' | 'right' | 'bottom';

export default function CopilotPanel({ rootId, mode, item, onClose }: Props) {
  const [pos, setPos] = useState({ x: Math.max(20, window.innerWidth - 480), y: 60 });
  const [size, setSize] = useState({ w: 460, h: 560 });
  const [docked, setDocked] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const resizeRef = useRef<{ sx: number; sy: number; w: number; h: number; kind: ResizeKind } | null>(null);
  const hoverTimerRef = useRef<number | null>(null);

  const [msgs, setMsgs] = useState<StreamMsg[]>([]);
  const [pending, setPending] = useState<Record<string, PendingMsg>>({});
  const [pendingPerms, setPendingPerms] = useState<PermissionRequest[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const esRef = useRef<EventSource | null>(null);
  const pendingRef = useRef<Record<string, PendingMsg>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  const streaming = sending || Object.keys(pending).length > 0;

  const clearHoverTimer = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  const armHoverHide = () => {
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => setPreviewVisible(false), 200);
  };

  const restoreFloating = useCallback(() => {
    clearHoverTimer();
    setPreviewVisible(false);
    setDocked(false);
  }, []);

  const scrollBottom = () => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  function upsertTool(list: CopilotTool[], d: any) {
    const st = d.state ?? {};
    const view: CopilotTool = {
      callID: d.callID,
      tool: d.tool ?? 'tool',
      status: st.status ?? 'pending',
      input: toolInputText(st.input),
      title: st.title ?? '',
      output: st.metadata?.output ?? st.output ?? '',
      error: st.error ?? '',
    };
    const idx = list.findIndex((t) => t.callID === view.callID);
    if (idx >= 0) list[idx] = view;
    else list.push(view);
  }

  function toolInputText(input: any): string {
    if (!input) return '';
    if (typeof input === 'string') return input;
    if (typeof input.command === 'string') return input.command;
    try {
      return JSON.stringify(input, null, 1);
    } catch {
      return String(input);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let info: CopilotInfo = await api.copilot(rootId, mode, item);
        if (!info.sessionExists) {
          await api.copilotEnsure(rootId, mode, item);
          info = await api.copilot(rootId, mode, item);
        }
        if (cancelled) return;
        setMsgs(
          info.messages.map((m) => ({
            id: m.id ?? Math.random().toString(36),
            role: m.role,
            text: m.text,
            reasoning: m.reasoning,
            tools: m.tools,
          })),
        );
        if (info.preset) setInput(info.preset);
        openStream(info.sessionID!);
      } catch (e: any) {
        message.error('Copilot initialization failed: ' + e.message);
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();
    return () => {
      cancelled = true;
      esRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootId, mode, item]);

  const openStream = (sessionID: string) => {
    if (esRef.current) esRef.current.close();
    const es = new EventSource(api.copilotStreamUrl(rootId, mode, item));
    esRef.current = es;
    es.addEventListener('part', (ev: any) => {
      const d = JSON.parse(ev.data);
      const id = d.messageID;
      const cur: PendingMsg = pendingRef.current[id] ?? { reasoning: '', text: '', tools: [] };
      if (d.type === 'reasoning') {
        cur.reasoning += d.text ?? '';
      } else if (d.type === 'tool') {
        upsertTool(cur.tools, d);
      } else {
        cur.text += d.text ?? '';
      }
      pendingRef.current = { ...pendingRef.current, [id]: cur };
      setPending(pendingRef.current);
      scrollBottom();
    });
    es.addEventListener('done', () => {
      finalizeDone();
    });
    es.addEventListener('error', () => {
      setSending(false);
    });
    es.addEventListener('permission', (ev: any) => {
      const d = JSON.parse(ev.data);
      setPendingPerms((prev) => (prev.some((p) => p.id === d?.id) ? prev : [...prev, d]));
    });
    es.addEventListener('permission:replied', (ev: any) => {
      const d = JSON.parse(ev.data);
      if (d?.requestID) setPendingPerms((prev) => prev.filter((p) => p.id !== d.requestID));
    });
    void sessionID;
  };

  const replyPermission = useCallback(async (id: string, reply: 'once' | 'always' | 'reject') => {
    try {
      await api.copilotPermissionReply(id, reply);
      setPendingPerms((prev) => prev.filter((p) => p.id !== id));
    } catch (e: any) {
      message.error('Permission reply failed: ' + (e.message ?? String(e)));
    }
  }, []);

  const loadSkills = useCallback(async () => {
    setSkillsLoading(true);
    try {
      const res = await api.copilotSkills(rootId, mode, item);
      setSkills(res?.skills ?? []);
    } catch (e: any) {
      message.error('Failed to load skills: ' + (e.message ?? String(e)));
    } finally {
      setSkillsLoading(false);
    }
  }, [rootId, mode, item]);

  const applySkill = useCallback(
    (s: SkillInfo) => {
      setSkillsOpen(false);
      const directive = `Please load and use the skill "${s.name}" (${s.description}), following its guidance to complete the task.\n\n`;
      setInput((prev) => (prev ? prev + '\n' + directive : directive));
    },
    [],
  );

  const send = useCallback(async () => {
    const content = input.trim();
    if (!content) return;
    setInput('');
    setSending(true);
    const uid = 'u' + Date.now();
    setMsgs((prev) => [...prev, { id: uid, role: 'user', text: content }]);
    try {
      await api.copilotSend(rootId, mode, item, content);
    } catch (e: any) {
      message.error(e.message ?? String(e));
      setSending(false);
      return;
    }
    setTimeout(() => setSending(false), 120000);
  }, [input, rootId, mode, item]);

  const finalizeDone = useCallback(() => {
    const entries = Object.entries(pendingRef.current).filter(
      ([, m]) => m.text || m.reasoning || m.tools.length > 0,
    );
    if (entries.length) {
      setMsgs((prev) => [
        ...prev,
        ...entries.map(([id, m]) => ({ id, role: 'assistant', text: m.text, reasoning: m.reasoning, tools: m.tools })),
      ]);
    }
    pendingRef.current = {};
    setPending({});
    setSending(false);
  }, []);

  useEffect(() => {
    if (Object.keys(pending).length === 0) return;
    scrollBottom();
  }, [pending]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (docked || previewVisible) return;
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    const move = (ev: MouseEvent) => {
      if (dragRef.current)
        setPos({ x: ev.clientX - dragRef.current.dx, y: ev.clientY - dragRef.current.dy });
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const onResizeDown = (e: React.MouseEvent, kind: ResizeKind) => {
    e.preventDefault();
    if (docked || previewVisible) return;
    resizeRef.current = { sx: e.clientX, sy: e.clientY, w: size.w, h: size.h, kind };
    const move = (ev: MouseEvent) => {
      if (resizeRef.current) {
        const { sx, sy, w, h, kind } = resizeRef.current;
        const dw = kind === 'right' || kind === 'corner' ? ev.clientX - sx : 0;
        const dh = kind === 'bottom' || kind === 'corner' ? ev.clientY - sy : 0;
        setSize({ w: Math.max(320, w + dw), h: Math.max(320, h + dh) });
      }
    };
    const up = () => {
      resizeRef.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const renderTool = (t: CopilotTool) => (
    <div key={t.callID} className={`copilot-tool is-${t.status}`}>
      <div className="copilot-tool-head">
        <span className="copilot-tool-dot" />
        <span className="copilot-tool-name">{t.tool}</span>
        <span className="copilot-tool-status">{t.status}</span>
      </div>
      {t.input && (
        <div className="copilot-tool-input">
          <pre>{t.input}</pre>
        </div>
      )}
      {t.title && t.title !== t.input && <div className="copilot-tool-title">{t.title}</div>}
      {t.error && <div className="copilot-tool-error">{t.error}</div>}
      {t.output && (
        <details className="copilot-tool-output">
          <summary>output</summary>
          <pre>{t.output}</pre>
        </details>
      )}
    </div>
  );

const renderAssistant = (m: { text: string; reasoning?: string; tools?: CopilotTool[] }) => (
    <div className="copilot-output">
      {m.tools && m.tools.length > 0 && (
        <div className="copilot-tools">{m.tools.map((t) => renderTool(t))}</div>
      )}
      {m.reasoning && (
        <details className="copilot-reasoning">
          <summary>Reasoning</summary>
          <div>{m.reasoning}</div>
        </details>
      )}
      {m.text && (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkHighlightMark, remarkMarkHName]}
          rehypePlugins={[[rehypeHighlight, { detect: true, subset: ['bash', 'js', 'json', 'python', 'xml', 'yaml', 'diff', 'text'] }]]}
        >
          {m.text}
        </ReactMarkdown>
      )}
    </div>
  );

const renderBody = (m: StreamMsg) => {
    if (m.role === 'user') {
      return <div className="copilot-output" style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>;
    }
    return renderAssistant(m);
  };

  const renderPermissionBanner = () => {
    if (pendingPerms.length === 0) return null;
    return (
      <div
        style={{
          padding: '8px 12px',
          background: '#fdf6ec',
          borderTop: '1px solid var(--line)',
          borderBottom: '1px solid var(--line)',
          fontSize: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          maxHeight: 180,
          overflow: 'auto',
        }}
      >
        {pendingPerms.map((p) => (
          <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: 'var(--ink)' }}>
                Permission · {p.permission}
              </span>
              <span style={{ color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>agent waiting</span>
            </div>
            <div style={{ color: 'var(--ink-2)', fontFamily: 'var(--mono)', wordBreak: 'break-all' }}>
              {p.patterns?.length ? p.patterns.join('  ·  ') : p.always?.join(', ') ?? ''}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Button size="small" icon={<CheckOutlined />} onClick={() => replyPermission(p.id, 'once')}>
                Allow once
              </Button>
              <Button size="small" onClick={() => replyPermission(p.id, 'always')}>
                Always
              </Button>
              <Button size="small" danger icon={<StopOutlined />} onClick={() => replyPermission(p.id, 'reject')}>
                Reject
              </Button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderSkillPicker = () => (
    <div style={{ width: 300, maxHeight: 320, overflow: 'auto', fontSize: 12 }}>
      {skillsLoading && (
        <div style={{ textAlign: 'center', padding: 12 }}>
          <Spin size="small" />
        </div>
      )}
      {!skillsLoading && skills.length === 0 && (
        <div style={{ color: 'var(--ink-3)', padding: 12, textAlign: 'center' }}>No skills available</div>
      )}
      {skills.map((s) => (
        <div
          key={s.name}
          onClick={() => applySkill(s)}
          style={{ padding: '8px 10px', cursor: 'pointer', borderBottom: '1px solid var(--line)', background: '#fff' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-bg)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
        >
          <div style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: 'var(--ink)' }}>{s.name}</div>
          <div style={{ color: 'var(--ink-2)', marginTop: 2 }}>{s.description}</div>
        </div>
      ))}
    </div>
  );

  const renderPanel = (preview: boolean) => (
    <div
      className={preview ? 'copilot-panel copilot-panel-preview' : 'copilot-panel'}
      style={{
        position: 'fixed',
        left: preview ? undefined : pos.x,
        top: preview ? '50%' : pos.y,
        right: preview ? 36 : undefined,
        transform: preview ? 'translateY(-50%)' : undefined,
        width: preview ? Math.min(size.w, window.innerWidth - 24) : size.w,
        height: preview ? Math.min(size.h, window.innerHeight - 24) : size.h,
        background: '#fff',
        border: '1px solid #e3e1db',
        borderRadius: 12,
        boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
      onMouseEnter={preview ? clearHoverTimer : undefined}
      onMouseLeave={preview ? armHoverHide : undefined}
    >
      <div
        onMouseDown={preview ? undefined : onMouseDown}
        style={{
          padding: '8px 12px',
          background: 'var(--paper)',
          borderBottom: '1px solid var(--line)',
          color: 'var(--ink)',
          cursor: preview ? 'default' : 'move',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          userSelect: 'none',
          fontFamily: 'var(--mono)',
          fontSize: 13,
          letterSpacing: '0.03em',
        }}
      >
        <span>
          <RobotOutlined style={{ marginRight: 8 }} />
          Agent Copilot
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {preview ? (
            <Tooltip title="Restore floating">
              <Button
                type="text"
                size="small"
                icon={<ExpandOutlined />}
                onClick={restoreFloating}
                aria-label="Restore floating"
                style={{ color: 'var(--ink-2)' }}
              />
            </Tooltip>
          ) : (
            <Tooltip title="Dock to sidebar">
              <Button
                type="text"
                size="small"
                icon={<VerticalRightOutlined />}
                onClick={() => setDocked(true)}
                aria-label="Dock to sidebar"
                style={{ color: 'var(--ink-2)' }}
              />
            </Tooltip>
          )}
          <Tooltip title="Close">
            <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} aria-label="Close" style={{ color: 'var(--ink-2)' }} />
          </Tooltip>
        </span>
      </div>

      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 12,
          background: '#f7f6f3',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {initializing && (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin />
          </div>
        )}
        {msgs.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '92%',
              padding: '8px 12px',
              borderRadius: 8,
              background: m.role === 'user' ? 'var(--accent-bg)' : '#fff',
              color: 'var(--ink)',
              border: m.role === 'user' ? 'none' : '1px solid #e8e6e1',
              fontSize: 13,
            }}
          >
            {renderBody(m)}
          </div>
        ))}
        {Object.entries(pending)
          .filter(([, m]) => m.text || m.reasoning || m.tools.length > 0)
          .map(([id, m]) => (
            <div
              key={id}
              style={{
                alignSelf: 'flex-start',
                maxWidth: '92%',
                padding: '8px 12px',
                borderRadius: 8,
                background: '#fff',
                color: 'var(--ink)',
                border: '1px solid #e8e6e1',
                fontSize: 13,
              }}
            >
              {renderAssistant(m)}
              {sending && <Spin size="small" style={{ marginTop: 6 }} />}
            </div>
          ))}
        <div ref={bottomRef} />
      </div>

      {renderPermissionBanner()}

      <div style={{ padding: 8, borderTop: '1px solid #e8e6e1', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <Popover
          open={skillsOpen}
          onOpenChange={(open) => {
            setSkillsOpen(open);
            if (open && skills.length === 0 && !skillsLoading) loadSkills();
          }}
          trigger="click"
          placement="topLeft"
          arrow={false}
          content={renderSkillPicker()}
        >
          <Button icon={<ThunderboltOutlined />} aria-label="Add skill" title="Add skill" />
        </Popover>
        <Input.TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message. Enter to send (Shift+Enter for a newline)"
          autoSize={{ minRows: 2, maxRows: 5 }}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button type="primary" icon={<SendOutlined />} onClick={send} loading={sending} />
      </div>

      {!preview && (
        <>
          <div
            onMouseDown={(e) => onResizeDown(e, 'right')}
            style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize' }}
          />
          <div
            onMouseDown={(e) => onResizeDown(e, 'bottom')}
            style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 8, cursor: 'ns-resize' }}
          />
          <div
            onMouseDown={(e) => onResizeDown(e, 'corner')}
            style={{ position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, cursor: 'nwse-resize' }}
          />
        </>
      )}
    </div>
  );

  return (
    <>
      {docked && (
        <button
          className="copilot-dock"
          onClick={restoreFloating}
          onMouseEnter={() => {
            clearHoverTimer();
            setPreviewVisible(true);
          }}
          onMouseLeave={armHoverHide}
          aria-label="Restore copilot floating window"
          title="Restore floating"
        >
          <span className={`copilot-dock-led${streaming ? ' is-live' : ''}`} />
          <span className="copilot-dock-label">Copilot</span>
        </button>
      )}
      {!docked && renderPanel(false)}
      {docked && previewVisible && renderPanel(true)}
    </>
  );
}