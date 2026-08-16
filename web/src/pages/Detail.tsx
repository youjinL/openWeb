import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Button,
  Typography,
  Input,
  Checkbox,
  Switch,
  message,
  Modal,
  Tooltip,
  Spin,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckSquareOutlined,
  ClearOutlined,
  ExportOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { api } from '../api';
import type { ItemDetail, CheckItem, ScanResult } from '../types';
import WaiveDirModal from '../components/WaiveDirModal';
import CopilotPanel from '../components/CopilotPanel';

const PATH_RE = /\/[A-Za-z0-9_.~+-]+(?:\/[A-Za-z0-9_.~+-]+)+/g;

function classify(status: string): string {
  const s = String(status).toLowerCase();
  if (s === 'pass') return 'pass';
  if (s === 'fail') return 'fail';
  if (s.includes('review')) return 'review';
  return s === 'error' ? 'error' : 'neutral';
}

function renderLineText(text: string, onPath: (p: string) => void) {
  const matches = Array.from(text.matchAll(PATH_RE));
  if (matches.length === 0) return text;
  const nodes: ReactNode[] = [];
  let last = 0;
  matches.forEach((m, i) => {
    const idx = m.index ?? 0;
    if (idx > last) nodes.push(text.slice(last, idx));
    const path = m[0];
    nodes.push(
      <span
        key={i}
        className="path-link"
        onClick={(e) => {
          e.stopPropagation();
          onPath(path);
        }}
      >
        {path}
      </span>
    );
    last = idx + path.length;
  });
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export default function Detail() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const rootId = Number(params.get('rootId'));
  const mode = params.get('mode') ?? '';
  const item = params.get('item') ?? '';

  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [sideItems, setSideItems] = useState<CheckItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [filter, setFilter] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [invert, setInvert] = useState(false);
  const [hideWaived, setHideWaived] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [waiveDirModal, setWaiveDirModal] = useState(false);
  const [reasonModal, setReasonModal] = useState(false);
  const [reason, setReason] = useState('');
  const [exporting, setExporting] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.itemDetail(rootId, mode, item);
      setDetail(d);
    } catch (e: any) {
      message.error(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [rootId, mode, item]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .scan(rootId)
      .then((s: ScanResult) => {
        const m = s.modes.find((x) => x.mode === mode);
        setSideItems(m?.items ?? []);
      })
      .catch(() => {});
  }, [rootId, mode]);

  const patterns = useMemo(() => {
    const raw = filter.split('&&').map((s) => s.trim()).filter(Boolean);
    const compiled: RegExp[] = [];
    for (const r of raw) {
      try {
        compiled.push(new RegExp(r, caseSensitive ? '' : 'i'));
      } catch {
        /* ignore invalid regex */
      }
    }
    return compiled;
  }, [filter, caseSensitive]);

  const visibleLines = useMemo(() => {
    if (!detail) return [];
    const hit = (text: string) => patterns.every((p) => p.test(text));
    return detail.lines.filter((l) => {
      if (hideWaived && l.waived) return false;
      if (patterns.length === 0) return true;
      return invert ? !hit(l.text) : hit(l.text);
    });
  }, [detail, patterns, invert, hideWaived]);

  const selectableInView = useMemo(
    () => visibleLines.filter((l) => !l.isComment && !l.isEmpty && !l.waived),
    [visibleLines]
  );

  const toggleLine = (lineNo: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(lineNo)) next.delete(lineNo);
      else next.add(lineNo);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelected(new Set(selectableInView.map((l) => l.lineNo)));
  };

  const clearSelection = () => setSelected(new Set());

  const switchItem = (name: string) => {
    if (name === item) return;
    setCopilotOpen(false);
    setFilter('');
    setSelected(new Set());
    setCaseSensitive(false);
    setInvert(false);
    setHideWaived(false);
    navigate(`/detail?rootId=${rootId}&mode=${mode}&item=${encodeURIComponent(name)}`);
  };

  const onExport = async () => {
    if (selected.size === 0) return message.warning('Select rows to waive first');
    try {
      const info = await api.getWaiveDir(rootId);
      if (!info.waive_dir) {
        setWaiveDirModal(true);
        return;
      }
      setReasonModal(true);
    } catch (e: any) {
      message.error(e.message ?? String(e));
    }
  };

  const onWaiveDirDone = async (dir: string) => {
    setWaiveDirModal(false);
    message.success(`Waive save directory set to: ${dir}`);
    setReasonModal(true);
  };

  const doExport = async () => {
    if (!reason.trim()) return message.warning('Please enter a waive reason');
    const lines = Array.from(selected)
      .map((lineNo) => {
        const l = detail?.lines.find((x) => x.lineNo === lineNo);
        return l ? { lineNo: l.lineNo, text: l.text } : null;
      })
      .filter(Boolean) as { lineNo: number; text: string }[];
    setExporting(true);
    try {
      const r = await api.exportWaive(rootId, mode, item, reason.trim(), lines);
      message.success(
        r.existed
          ? `Appended to existing waive file: ${r.file} (${r.exported} rows)`
          : `Created waive file: ${r.file} (${r.exported} rows)`
      );
      setReasonModal(false);
      setReason('');
      setSelected(new Set());
      await load();
    } catch (e: any) {
      if (e.message === 'NO_WAIVE_DIR') {
        setReasonModal(false);
        setWaiveDirModal(true);
      } else {
        message.error(e.message ?? String(e));
      }
    } finally {
      setExporting(false);
    }
  };

  const statusColor: Record<string, string> = {
    Pass: 's-pass',
    Fail: 's-fail',
    'To be review': 's-review',
    Unknown: 's-neutral',
    Error: 's-error',
    'pass by waive': 's-pass',
  };

  if (loading || !detail) {
    return (
      <div className="bench-loading">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <>
      <header className="detailbar">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
          Back
        </Button>
        <span className="detailbar-item">
          [{mode.toUpperCase()}] {item}
        </span>
        <span className={`status-chip ${statusColor[detail.status] ?? 's-neutral'}`}>{detail.status}</span>
        <Tooltip title={detail.reportPath}>
          <span className="detailbar-path">{detail.reportPath}</span>
        </Tooltip>
        <div style={{ flex: 1 }} />
        <Button icon={<RobotOutlined />} type="primary" onClick={() => setCopilotOpen(true)}>
          Agent Copilot
        </Button>
      </header>

      <main className="bench">
        <div className="detail-layout">
          <aside className="detail-side">
            <div className="side-head">
              <span className="side-mode">{mode.toUpperCase()}</span>
              <span className="side-count">{sideItems.length} checks</span>
            </div>
            {sideItems.map((it) => {
              const key = classify(it.status);
              const dotKey = key === 'error' ? 'fail' : key;
              return (
                <div
                  key={it.name}
                  className={`side-item ${it.name === item ? 'active' : ''}`}
                  onClick={() => switchItem(it.name)}
                >
                  <span className={`item-dot ${dotKey}`} />
                  <span className="side-item-name" title={it.name}>
                    {it.name}
                  </span>
                  <span className={`item-status ${key}`}>{it.status}</span>
                </div>
              );
            })}
          </aside>

          <div className="detail-main">
            <div className="detail-toolbar">
          <div className="detail-filters">
            <Input.Search
              placeholder="Regex filter, join multiple patterns with &&"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              allowClear
              style={{ width: 380 }}
            />
            <label className="filter-label">
              Case sensitive <Switch size="small" checked={caseSensitive} onChange={setCaseSensitive} />
            </label>
            <label className="filter-label">
              Exclude matches <Switch size="small" checked={invert} onChange={setInvert} />
            </label>
            <label className="filter-label">
              Hide waived <Switch size="small" checked={hideWaived} onChange={setHideWaived} />
            </label>
          </div>
          <div className="detail-actions">
            <Button
              icon={selected.size === 0 ? <CheckSquareOutlined /> : <ClearOutlined />}
              onClick={() => (selected.size === 0 ? selectAllVisible() : clearSelection())}
            >
              {selected.size === 0
                ? `Select all visible rows (${selectableInView.length})`
                : `Clear selection (${selected.size})`}
            </Button>
            <Button type="primary" icon={<ExportOutlined />} onClick={onExport} loading={exporting}>
              Export Waiver
            </Button>
          </div>
        </div>

        {detail.missing ? (
          <div className="bench-empty">
            <div className="bench-empty-body">
              <div className="bench-empty-title">Report file not found</div>
              <Typography.Text type="secondary">Unable to read the report file for this check item; line contents unavailable</Typography.Text>
            </div>
          </div>
        ) : (
          <div className="log-lines">
            {visibleLines.length === 0 && (
              <div className="bench-empty" style={{ padding: 32 }}>
                <div className="bench-empty-body">
                  <div className="bench-empty-title">No matching rows</div>
                  <Typography.Text type="secondary">Adjust the filter or clear the selection</Typography.Text>
                </div>
              </div>
            )}
            {visibleLines.map((l) => {
              const isSelected = selected.has(l.lineNo);
              const noCheckbox = l.isComment || l.isEmpty;
              return (
                <div
                  key={l.lineNo}
                  className={`log-line ${l.waived ? 'waived' : ''} ${isSelected ? 'selected' : ''} ${
                    noCheckbox ? (l.isEmpty ? 'empty' : 'comment') : ''
                  }`}
                >
                  {noCheckbox ? (
                    <span style={{ width: 22, flexShrink: 0 }} />
                  ) : (
                    <Checkbox
                      checked={l.waived || isSelected}
                      disabled={l.waived}
                      onChange={() => toggleLine(l.lineNo)}
                    />
                  )}
                  <span className="line-no">{l.lineNo}</span>
                  <span className="line-text">
                    {renderLineText(l.text, (p) =>
                      navigate(`/file?path=${encodeURIComponent(p)}&rootId=${rootId}&mode=${mode}&item=${encodeURIComponent(item)}`)
                    )}
                  </span>
                  {l.waived && <span className="waived-tag">waived</span>}
                </div>
              );
            })}
          </div>
        )}
          </div>
        </div>
      </main>

      <WaiveDirModal
        open={waiveDirModal}
        rootId={rootId}
        onCancel={() => setWaiveDirModal(false)}
        onDone={onWaiveDirDone}
      />
      <Modal
        title="Export Waiver"
        open={reasonModal}
        onOk={doExport}
        onCancel={() => setReasonModal(false)}
        okText="Export"
        cancelText="Cancel"
        confirmLoading={exporting}
      >
        <Typography.Paragraph type="secondary">
          {selected.size} row(s) selected. Please enter the reason for this waive:
        </Typography.Paragraph>
        <Input.TextArea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Waive Reason"
          autoSize={{ minRows: 3 }}
        />
      </Modal>

      {copilotOpen && (
        <CopilotPanel rootId={rootId} mode={mode} item={item} onClose={() => setCopilotOpen(false)} />
      )}
    </>
  );
}