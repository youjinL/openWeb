const BASE = '/api';

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error === 'NO_WAIVE_DIR') {
        const e: any = new Error('NO_WAIVE_DIR');
        e.noWaiveDir = true;
        throw e;
      }
      msg = body?.message ?? body?.error ?? msg;
    } catch (e: any) {
      if (e?.noWaiveDir) throw e;
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  roots: () => req<any[]>('/roots'),
  addRoot: (path: string) => req<any>('/roots', { method: 'POST', body: JSON.stringify({ path }) }),
  deleteRoot: (id: number) => req<any>(`/roots/${id}`, { method: 'DELETE' }),

  scan: (rootId: number) => req<any>(`/roots/${rootId}/modes`),
  itemDetail: (rootId: number, mode: string, item: string) =>
    req<any>(`/roots/${rootId}/modes/${mode}/items/${encodeURIComponent(item)}`),

  getWaiveDir: (rootId: number) => req<any>(`/roots/${rootId}/waive-dir`),
  setWaiveDir: (rootId: number, dir: string) =>
    req<any>(`/roots/${rootId}/waive-dir`, { method: 'POST', body: JSON.stringify({ dir }) }),
  exportWaive: (rootId: number, mode: string, item: string, reason: string, lines: { lineNo: number; text: string }[]) =>
    req<any>(`/roots/${rootId}/modes/${mode}/items/${encodeURIComponent(item)}/waive`, {
      method: 'POST',
      body: JSON.stringify({ reason, lines }),
    }),
  waiveFile: (rootId: number, mode: string) => req<any>(`/roots/${rootId}/modes/${mode}/waive-file`),

  browse: (path?: string) => req<any>(`/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`),

  copilot: (rootId: number, mode: string, item: string) =>
    req<any>(`/copilot/${rootId}/${mode}/${encodeURIComponent(item)}`),
  copilotEnsure: (rootId: number, mode: string, item: string) =>
    req<any>(`/copilot/${rootId}/${mode}/${encodeURIComponent(item)}/ensure`, { method: 'POST' }),
  copilotSend: (rootId: number, mode: string, item: string, content: string) =>
    req<any>(`/copilot/${rootId}/${mode}/${encodeURIComponent(item)}/message`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  copilotStreamUrl: (rootId: number, mode: string, item: string) =>
    `${BASE}/copilot/${rootId}/${mode}/${encodeURIComponent(item)}/stream`,
};