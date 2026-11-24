import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ClipRecord, MeResponse, RoomSettings, RoomStatus } from '@clipei/shared';
import { connectRoom } from '../ws.ts';
import { api, type BossInfo } from './api.ts';

export interface LogItem {
  id: number;
  at: number;
  text: string;
  tone: string;
}

export interface ToastItem {
  id: number;
  text: string;
  tone: '' | 'ok' | 'err';
}

interface AppState {
  me: MeResponse | null;
  boss: BossInfo | null;
  status: RoomStatus | null;
  logs: LogItem[];
  online: boolean;
  loadError: boolean;
  /** relógio do servidor - relógio local (contagens regressivas) */
  clockOffset: number;
  refresh: () => Promise<void>;
  saveSettings: (patch: unknown) => void;
  toast: (text: string, tone?: ToastItem['tone']) => void;
  toasts: ToastItem[];
  setBoss: (b: Partial<BossInfo>) => void;
}

const Ctx = createContext<AppState | null>(null);
let seq = 0;

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [boss, setBossState] = useState<BossInfo | null>(null);
  const [status, setStatus] = useState<RoomStatus | null>(null);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [online, setOnline] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [clockOffset, setClockOffset] = useState(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const saveTimer = useRef<number>();
  const pending = useRef<Record<string, unknown>>({});

  const toast = useCallback((text: string, tone: ToastItem['tone'] = '') => {
    const id = ++seq;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [m, b] = await Promise.all([api<MeResponse>('/api/me'), api<BossInfo>('/api/boss')]);
      setMe(m);
      setBossState(b);
      setStatus(m.status);
      setClockOffset(m.status.serverNow - Date.now());
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // tempo real: estado do boss, status da sala, mensagens do bot, clips
  useEffect(() => {
    if (!me?.overlayKey) return;
    const conn = connectRoom(
      me.overlayKey,
      (msg) => {
        if (msg.type === 'boss') setBossState((b) => (b ? { ...b, state: msg.state } : b));
        if (msg.type === 'room') {
          setStatus(msg.status);
          setClockOffset(msg.status.serverNow - Date.now());
        }
        if (msg.type === 'settings') setMe((m) => (m ? { ...m, settings: msg.settings } : m));
        if (msg.type === 'toast') setLogs((l) => [{ id: ++seq, at: Date.now(), text: msg.text, tone: msg.tone ?? 'info' }, ...l].slice(0, 40));
        if (msg.type === 'clip') setMe((m) => (m ? { ...m, clips: [msg.clip, ...m.clips].slice(0, 20) as ClipRecord[] } : m));
      },
      setOnline,
      'panel',
    );
    return () => conn.close();
  }, [me?.overlayKey]);

  // configurações: atualiza na hora e salva agrupando alterações rápidas
  const saveSettings = useCallback(
    (patch: unknown) => {
      setMe((m) => (m ? { ...m, settings: deepMerge(m.settings, patch) as RoomSettings } : m));
      pending.current = deepMerge(pending.current, patch) as Record<string, unknown>;
      clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(async () => {
        const body = pending.current;
        pending.current = {};
        try {
          const { settings } = await api<{ settings: RoomSettings }>('/api/settings', body);
          setMe((m) => (m ? { ...m, settings } : m));
        } catch (err) {
          toast((err as Error).message, 'err');
        }
      }, 250);
    },
    [toast],
  );

  const setBoss = useCallback((b: Partial<BossInfo>) => setBossState((cur) => (cur ? { ...cur, ...b } : cur)), []);

  const value = useMemo(
    () => ({ me, boss, status, logs, online, loadError, clockOffset, refresh, saveSettings, toast, toasts, setBoss }),
    [me, boss, status, logs, online, loadError, clockOffset, refresh, saveSettings, toast, toasts, setBoss],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp fora do AppProvider');
  return v;
}

function deepMerge(a: unknown, b: unknown): unknown {
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null || Array.isArray(b)) return b;
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b as Record<string, unknown>)) out[k] = deepMerge(out[k], v);
  return out;
}

/** Re-renderiza a cada `ms` (contagens regressivas). */
export function useTick(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}
