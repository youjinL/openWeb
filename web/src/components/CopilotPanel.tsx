import { useEffect, useRef, useState, useCallback } from 'react';
import { Button, Input, message, Spin, Tooltip } from 'antd';
import {
  CloseOutlined,
  SendOutlined,
  RobotOutlined,
  VerticalRightOutlined,
  ExpandOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import { api } from '../api';
import type { CopilotInfo } from '../types';

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
  const [pending, setPending] = useState<Record<string, string>>({});
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const esRef = useRef<EventSource | null>(null);
  const pendingRef = useRef<Record<string, string>>({});
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
        setMsgs(info.messages.map((m) => ({ id: m.id ?? Math.random().toString(36), role: m.role, text: m.text })));
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
      pendingRef.current = {
        ...pendingRef.current,
        [d.messageID]: (pendingRef.current[d.messageID] ?? '') + (d.text ?? ''),
      };
      setPending(pendingRef.current);
      scrollBottom();
    });
    es.addEventListener('done', () => {
      finalizeDone();
    });
    es.addEventListener('error', () => {
      setSending(false);
    });
    void sessionID;
  };

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
    const entries = Object.entries(pendingRef.current).filter(([, text]) => text);
    if (entries.length) {
      setMsgs((prev) => [...prev, ...entries.map(([id, text]) => ({ id, role: 'assistant', text }))]);
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

  const renderBody = (m: StreamMsg) => {
    if (m.role === 'user') {
      return <div className="copilot-output" style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>;
    }
    return (
      <div className="copilot-output">
        <ReactMarkdown>{m.text}</ReactMarkdown>
      </div>
    );
  };

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
        {Object.entries(pending).filter(([, t]) => t).map(([id, text]) => (
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
            <div className="copilot-output">
              <ReactMarkdown>{text}</ReactMarkdown>
            </div>
            {sending && <Spin size="small" style={{ marginTop: 6 }} />}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: 8, borderTop: '1px solid #e8e6e1', display: 'flex', gap: 8 }}>
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