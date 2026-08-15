import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Button,
  Typography,
  Input,
  Checkbox,
  Switch,
  Radio,
  message,
  Modal,
  Spin,
} from 'antd';
import { ArrowLeftOutlined, CheckSquareOutlined, ClearOutlined, ExportOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { ReportLine } from '../types';
import WaiveDirModal from '../components/WaiveDirModal';

export default function FileViewer() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const filePath = params.get('path') ?? '';
  const rootId = params.get('rootId') ? Number(params.get('rootId')) : null;
  const mode = params.get('mode') ?? null;
  const item = params.get('item') ?? null;
  const canWaive = rootId != null && mode && item;

  const [lines, setLines] = useState<ReportLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  const [filter, setFilter] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [invert, setInvert] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [waiveDirModal, setWaiveDirModal] = useState(false);
  const [reasonModal, setReasonModal] = useState(false);
  const [reason, setReason] = useState('');
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ path: filePath });
      if (canWaive) q.set('rootId', String(rootId));
      if (canWaive && mode) q.set('mode', mode);
      if (canWaive && item) q.set('item', item);
      const r = await fetch(`/api/file/content?${q.toString()}`);
      const d = await r.json();
      setLines(d.lines ?? []);
      setMissing(d.missing ?? false);
    } catch (e: any) {
      message.error(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [filePath, canWaive, rootId, mode, item]);

  useEffect(() => {
    load();
  }, [load]);

  const patterns = useMemo(() => {
    const compiled: RegExp[] = [];
    for (const r of filter.split('&&').map((s) => s.trim()).filter(Boolean)) {
      try {
        compiled.push(new RegExp(r, caseSensitive ? '' : 'i'));
      } catch {}
    }
    return compiled;
  }, [filter, caseSensitive]);

  const visibleLines = useMemo(() => {
    if (patterns.length === 0) return lines;
    const hit = (t: string) => patterns.every((p) => p.test(t));
    return lines.filter((l) => (invert ? !hit(l.text) : hit(l.text)));
  }, [lines, patterns, invert]);

  const selectableInView = useMemo(
    () => visibleLines.filter((l) => !l.isComment && !l.isEmpty && !l.waived),
    [visibleLines]
  );

  const onExport = async () => {
    if (!canWaive) return message.warning('This file is not linked to a specific check item; cannot export waive');
    if (selected.size === 0) return message.warning('Select rows to waive first');
    const info = await api.getWaiveDir(rootId!);
    if (!info.waive_dir) setWaiveDirModal(true);
    else setReasonModal(true);
  };

  const onWaiveDirDone = (dir: string) => {
    setWaiveDirModal(false);
    message.success(`Waive save directory set to: ${dir}`);
    setReasonModal(true);
  };

  const doExport = async () => {
    if (!reason.trim()) return message.warning('Please enter a waive reason');
    const exportLines = Array.from(selected)
      .map((lineNo) => {
        const l = lines.find((x) => x.lineNo === lineNo);
        return l ? { lineNo, text: l.text } : null;
      })
      .filter(Boolean) as { lineNo: number; text: string }[];
    setExporting(true);
    try {
      const r = await api.exportWaive(rootId!, mode!, item!, reason.trim(), exportLines);
      message.success(
        r.existed ? `Appended to existing waive file: ${r.file} (${r.exported} rows)` : `Created waive file: ${r.file} (${r.exported} rows)`
      );
      setReasonModal(false);
      setReason('');
      setSelected(new Set());
      await load();
    } catch (e: any) {
      if (e.message === 'NO_WAIVE_DIR') {
        setReasonModal(false);
        setWaiveDirModal(true);
      } else message.error(e.message ?? String(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <header className="detailbar">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
          Back
        </Button>
        <span className="detailbar-item" style={{ fontSize: 13, maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {filePath}
        </span>
        {canWaive && <span className="status-chip s-neutral">[{mode?.toUpperCase()}] {item}</span>}
      </header>

      <main className="bench">
        <div className="detail-toolbar">
          <div className="detail-filters">
            <Input.Search placeholder="Regex filter, join multiple patterns with &&" value={filter} onChange={(e) => setFilter(e.target.value)} allowClear style={{ width: 380 }} />
            <label className="filter-label">
              Case sensitive <Switch size="small" checked={caseSensitive} onChange={setCaseSensitive} />
            </label>
            <Radio.Group value={invert ? 'exclude' : 'include'} onChange={(e) => setInvert(e.target.value === 'exclude')} size="small">
              <Radio.Button value="include">Match</Radio.Button>
              <Radio.Button value="exclude">Exclude</Radio.Button>
            </Radio.Group>
          </div>
          {canWaive && (
            <div className="detail-actions">
              <Button icon={<CheckSquareOutlined />} onClick={() => setSelected(new Set(selectableInView.map((l) => l.lineNo)))}>
                Select all visible rows ({selectableInView.length})
              </Button>
              <Button icon={<ClearOutlined />} onClick={() => setSelected(new Set())}>Clear selection ({selected.size})</Button>
              <Button type="primary" icon={<ExportOutlined />} onClick={onExport} loading={exporting}>Export Waiver</Button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="bench-loading"><Spin size="large" /></div>
        ) : missing ? (
          <div className="bench-empty">
            <div className="bench-empty-body">
              <div className="bench-empty-title">File not found or unreadable</div>
              <Typography.Text type="secondary">Unable to read the file content</Typography.Text>
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
                <div key={l.lineNo} className={`log-line ${l.waived ? 'waived' : ''} ${isSelected ? 'selected' : ''} ${noCheckbox ? (l.isEmpty ? 'empty' : 'comment') : ''}`}>
                  {noCheckbox ? <span style={{ width: 22, flexShrink: 0 }} /> : (
                    <Checkbox checked={l.waived || isSelected} disabled={l.waived} onChange={() => setSelected((prev) => { const next = new Set(prev); if (next.has(l.lineNo)) next.delete(l.lineNo); else next.add(l.lineNo); return next; })} />
                  )}
                  <span className="line-no">{l.lineNo}</span>
                  <span className="line-text">{l.text}</span>
                  {l.waived && <span className="waived-tag">waived</span>}
                </div>
              );
            })}
          </div>
        )}
      </main>
      <WaiveDirModal open={waiveDirModal} rootId={rootId!} onCancel={() => setWaiveDirModal(false)} onDone={onWaiveDirDone} />
      <Modal title="Export Waiver" open={reasonModal} onOk={doExport} onCancel={() => setReasonModal(false)} okText="Export" cancelText="Cancel" confirmLoading={exporting}>
        <Typography.Paragraph type="secondary">{selected.size} row(s) selected. Please enter the reason for this waive:</Typography.Paragraph>
        <Input.TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Waive Reason" autoSize={{ minRows: 3 }} />
      </Modal>
    </>
  );
}