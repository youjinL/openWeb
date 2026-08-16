import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Select, Button, Modal, Input, Segmented, message, Spin, Typography } from 'antd';
import { PlusOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { RootInfo, ScanResult, ModeInfo } from '../types';

type StatusKey = 'pass' | 'fail' | 'review' | 'other';

const MODE_META: Record<string, string> = { ac: 'ac', dc: 'dc', func: 'func' };

const FILTER_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'Pass', value: 'pass' },
  { label: 'Fail', value: 'fail' },
  { label: 'Review', value: 'review' },
];

function classify(status: string): StatusKey {
  const s = String(status).toLowerCase();
  if (s === 'pass' || s.includes('waive')) return 'pass';
  if (s === 'fail') return 'fail';
  if (s.includes('review')) return 'review';
  return 'other';
}

function dotClass(key: StatusKey): string {
  return key;
}

function chipClass(status: string): string {
  const key = classify(status);
  if (key === 'other') {
    const s = String(status).toLowerCase();
    return s === 'error' ? 'error' : 'neutral';
  }
  return key;
}

const clearedWaiveDirRoots = new Set<number>();

export default function Home() {
  const [roots, setRoots] = useState<RootInfo[]>([]);
  const [rootId, setRootId] = useState<number | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [nameFilter, setNameFilter] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.roots().then((r) => {
      setRoots(r);
      if (r.length > 0) setRootId(r[0].id);
    });
  }, []);

  useEffect(() => {
    if (rootId == null) return;
    if (!clearedWaiveDirRoots.has(rootId)) {
      clearedWaiveDirRoots.add(rootId);
      api.clearWaiveDir(rootId).catch(() => {});
    }
    setLoading(true);
    api
      .scan(rootId)
      .then((s) => {
        setScan(s);
        setFilters({});
        setNameFilter('');
      })
      .catch((e) => message.error(String(e)))
      .finally(() => setLoading(false));
  }, [rootId]);

  const refresh = () => {
    if (rootId == null) return;
    setLoading(true);
    api
      .scan(rootId)
      .then(setScan)
      .catch((e) => message.error(String(e)))
      .finally(() => setLoading(false));
  };

  const handleAdd = async () => {
    if (!newPath.trim()) return message.warning('Please enter a path');
    try {
      const r = await api.addRoot(newPath.trim());
      setRoots(await api.roots());
      setRootId(r.id);
      setAddOpen(false);
      setNewPath('');
    } catch (e: any) {
      message.error(e.message ?? String(e));
    }
  };

  const handleDelete = async () => {
    if (rootId == null) return;
    Modal.confirm({
      title: 'Delete root',
      content: 'This will also delete the waive states and the opencode copilot sessions for this root. Continue?',
      onOk: async () => {
        const r = await api.deleteRoot(rootId);
        if (r.deletedOpencodeSessions != null) {
          message.success(`Root deleted (${r.deletedOpencodeSessions} opencode session(s) removed)`);
        }
        const roots = await api.roots();
        setRoots(roots);
        setRootId(roots.length ? roots[0].id : null);
        setScan(null);
      },
    });
  };

  const visibleItems = (m: ModeInfo) => {
    const sf = filters[m.mode] ?? 'all';
    const nf = nameFilter.trim().toLowerCase();
    return m.items.filter((it) => {
      if (sf !== 'all' && classify(it.status) !== sf) return false;
      if (nf && !it.name.toLowerCase().includes(nf)) return false;
      return true;
    });
  };

  const overview = () => {
    const counts = { pass: 0, fail: 0, review: 0, other: 0 };
    let total = 0;
    for (const m of scan?.modes ?? []) {
      for (const it of m.items) {
        counts[classify(it.status)]++;
        total++;
      }
    }
    return { ...counts, total };
  };

  return (
    <>
      <header className="benchbar">
        <div className="benchbar-brand">
          <span className="benchbar-mark" />
          openWeb
          <span className="benchbar-sub">SDCV Dashboard</span>
        </div>
        <div className="benchbar-actions">
          <Select
            style={{ minWidth: 300 }}
            placeholder="Select root"
            value={rootId ?? undefined}
            onChange={setRootId}
            options={roots.map((r) => ({ value: r.id, label: r.path }))}
          />
          <Button icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
            Add root
          </Button>
          {rootId != null && <Button danger icon={<DeleteOutlined />} onClick={handleDelete} />}
          <Button icon={<ReloadOutlined />} onClick={refresh} />
        </div>
      </header>

      <main className="bench">
        {loading && (
          <div className="bench-loading">
            <Spin size="large" />
          </div>
        )}

        {!loading && rootId == null && (
          <div className="bench-empty">
            <div className="bench-empty-body">
              <span className="benchbar-mark" style={{ display: 'inline-block', width: 14, height: 14 }} />
              <div className="bench-empty-title">No root yet</div>
              <Typography.Text type="secondary">
                Add a directory containing <b>*_sdcV_summary/rpt/*_summary.json</b> to start checking
              </Typography.Text>
            </div>
          </div>
        )}

        {!loading && scan && scan.modes.length === 0 && (
          <div className="bench-empty">
            <div className="bench-empty-body">
              <div className="bench-empty-title">No reports found</div>
              <Typography.Text type="secondary">
                No matching {'{mode}_sdcV_summary/rpt/{mode}_summary.json'} found under the root
              </Typography.Text>
            </div>
          </div>
        )}

        {!loading && scan && scan.modes.length > 0 && (
          <>
            <section className="overview-block">
              <div className="overview-head">
                <span className="overview-title">Sign-off overview</span>
                <Input.Search
                  placeholder="Filter checks by name"
                  allowClear
                  value={nameFilter}
                  onChange={(e) => setNameFilter(e.target.value)}
                  style={{ width: 260, alignSelf: 'center' }}
                />
                <span className="overview-total">{overview().total} checks</span>
              </div>
              <div className="overview-stats">
                <div className="stat stat-pass">
                  <span className="stat-value">{overview().pass}</span>
                  <span className="stat-label">Pass</span>
                </div>
                <div className="stat stat-fail">
                  <span className="stat-value">{overview().fail}</span>
                  <span className="stat-label">Fail</span>
                </div>
                <div className="stat stat-review">
                  <span className="stat-value">{overview().review}</span>
                  <span className="stat-label">To be review</span>
                </div>
                <div className="stat stat-neutral">
                  <span className="stat-value">{overview().other}</span>
                  <span className="stat-label">Other</span>
                </div>
              </div>
            </section>

            <div className="modes-grid">
              {scan.modes.map((m) => {
                const items = visibleItems(m);
                return (
                  <section key={m.mode} className={`mode-card ${MODE_META[m.mode] ?? ''}`}>
                    <header className="mode-card-head">
                      <span className="mode-title">{m.mode.toUpperCase()}</span>
                      <span className="mode-count">{m.items.length} checks</span>
                    </header>
                    <div className="mode-filter">
                      <Segmented
                        block
                        size="small"
                        value={filters[m.mode] ?? 'all'}
                        onChange={(v) => setFilters((prev) => ({ ...prev, [m.mode]: String(v) }))}
                        options={FILTER_OPTIONS}
                      />
                    </div>
                    <div className="mode-items">
                      {items.length === 0 && (
                        <div className="bench-empty" style={{ padding: 24 }}>
                          <Typography.Text type="secondary">No matching items</Typography.Text>
                        </div>
                      )}
                      {items.map((item) => (
                        <div
                          key={item.name}
                          className="item-row"
                          onClick={() =>
                            navigate(`/detail?rootId=${rootId}&mode=${m.mode}&item=${encodeURIComponent(item.name)}`)
                          }
                        >
                          <span className={`item-dot ${dotClass(classify(item.status))}`} />
                          <span className="item-name" title={item.name}>
                            {item.name}
                          </span>
                          <span className={`item-status ${chipClass(item.status)}`}>{item.status}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </main>

      <Modal
        title="Add root"
        open={addOpen}
        onOk={handleAdd}
        onCancel={() => setAddOpen(false)}
        okText="Add"
        cancelText="Cancel"
      >
        <Input
          placeholder="Enter an absolute path, e.g. /home/user/mywork/openWeb/Example"
          value={newPath}
          onChange={(e) => setNewPath(e.target.value)}
          onPressEnter={handleAdd}
        />
      </Modal>
    </>
  );
}