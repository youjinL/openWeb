import { useSyncExternalStore } from 'react';

export interface CopilotPrefs {
  open: boolean;
  docked: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

const data = new Map<string, CopilotPrefs>();
const listeners = new Set<() => void>();

function key(rootId: number, mode: string, item: string) {
  return `${rootId}|${mode}|${item}`;
}

function defaults(): CopilotPrefs {
  return {
    open: false,
    docked: false,
    x: Math.max(20, window.innerWidth - 480),
    y: 60,
    w: 460,
    h: 560,
  };
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit() {
  for (const cb of listeners) cb();
}

export function getCopilotPrefs(rootId: number, mode: string, item: string): CopilotPrefs | null {
  return data.get(key(rootId, mode, item)) ?? null;
}

export function saveCopilotPrefs(
  rootId: number,
  mode: string,
  item: string,
  patch: Partial<CopilotPrefs>,
) {
  const k = key(rootId, mode, item);
  const prev = data.get(k) ?? defaults();
  data.set(k, { ...prev, ...patch });
  emit();
}

export function useCopilotOpen(rootId: number, mode: string, item: string): boolean {
  return useSyncExternalStore(subscribe, () => getCopilotPrefs(rootId, mode, item)?.open ?? false);
}

export function useCopilotPrefs(rootId: number, mode: string, item: string): CopilotPrefs | null {
  return useSyncExternalStore(subscribe, () => getCopilotPrefs(rootId, mode, item));
}