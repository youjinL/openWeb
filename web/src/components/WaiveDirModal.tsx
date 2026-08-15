import { useEffect, useState } from 'react';
import { Modal, Input, List, Button, Space, Typography, message, Empty } from 'antd';
import { FolderOutlined, ArrowUpOutlined, CheckOutlined } from '@ant-design/icons';
import { api } from '../api';

interface Props {
  open: boolean;
  rootId: number;
  onCancel: () => void;
  onDone: (dir: string) => void;
}

export default function WaiveDirModal({ open, rootId, onCancel, onDone }: Props) {
  const [current, setCurrent] = useState('');
  const [dirs, setDirs] = useState<{ name: string; path: string }[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [isDir, setIsDir] = useState(true);
  const [manual, setManual] = useState('');

  const load = async (path?: string) => {
    try {
      const r = await api.browse(path);
      setCurrent(r.root);
      setDirs(r.dirs);
      setParent(r.parent);
      setIsDir(r.isDir);
      setManual(r.root);
    } catch (e: any) {
      message.error(e.message ?? String(e));
    }
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  const confirm = async () => {
    const target = manual.trim();
    if (!target) return message.warning('Please enter a directory path');
    try {
      await api.setWaiveDir(rootId, target);
      onDone(target);
    } catch (e: any) {
      message.error(e.message ?? String(e));
    }
  };

  return (
    <Modal
      title="Select waive list save directory"
      open={open}
      onCancel={onCancel}
      onOk={confirm}
      okText="OK"
      cancelText="Cancel"
      width={560}
    >
      <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
        <Input
          placeholder="Enter an absolute path or browse to select"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onPressEnter={confirm}
        />
        <Button onClick={() => load(manual.trim() || undefined)}>Browse</Button>
      </Space.Compact>
      <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 6, padding: 8 }}>
        {!isDir && <Empty description="Selected path is not a directory" />}
        {isDir && (
          <>
            <Typography.Text type="secondary" style={{ fontSize: 12, wordBreak: 'break-all' }}>
              Current: {current || '/'}
            </Typography.Text>
            {parent && (
              <List.Item
                style={{ padding: '4px 0', cursor: 'pointer' }}
                onClick={() => load(parent)}
              >
                <ArrowUpOutlined /> Parent directory
              </List.Item>
            )}
            {dirs.length === 0 && current && (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No subdirectories" style={{ margin: '12px 0' }} />
            )}
            {dirs.map((d) => (
              <List.Item
                key={d.path}
                style={{ padding: '4px 0', cursor: 'pointer' }}
                onClick={() => load(d.path)}
              >
                <Space>
                  <FolderOutlined />
                  <span>{d.name}</span>
                </Space>
              </List.Item>
            ))}
            {current && (
              <Button
                type="dashed"
                icon={<CheckOutlined />}
                style={{ width: '100%', marginTop: 8 }}
                onClick={() => setManual(current)}
              >
                Use current directory: {current}
              </Button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}