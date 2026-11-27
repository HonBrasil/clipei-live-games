import type { ServerMessage } from '@clipei/shared';

/**
 * Endereço do WebSocket do jogo. Na Vercel o site e o servidor do jogo ficam em
 * hosts diferentes: o servidor informa o endereço em /api/config. Em dev (e quando
 * o servidor também entrega o site) é o próprio host.
 */
let wsBasePromise: Promise<string> | null = null;
function wsBase() {
  const same = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  wsBasePromise ??= fetch('/api/config')
    .then((r) => (r.ok ? r.json() : null))
    .then((c: { wsUrl?: string | null } | null) => c?.wsUrl || same)
    .catch(() => {
      wsBasePromise = null; // tenta de novo na próxima reconexão
      return same;
    });
  return wsBasePromise;
}

/** WebSocket com reconexão automática (o OBS deixa a fonte aberta por horas). */
export function connectRoom(
  key: string,
  onMessage: (msg: ServerMessage) => void,
  onStatus: (online: boolean) => void = () => {},
  /** "panel" = painel do streamer, "preview" = prévia do painel (nenhum conta como OBS conectado) */
  client: 'overlay' | 'panel' | 'preview' = 'overlay',
) {
  let ws: WebSocket | null = null;
  let retry = 1000;
  let stopped = false;

  const open = async () => {
    const base = await wsBase();
    if (stopped) return;
    ws = new WebSocket(`${base}?key=${encodeURIComponent(key)}&client=${client}`);
    ws.onopen = () => {
      retry = 1000;
      onStatus(true);
    };
    ws.onmessage = (ev) => {
      try {
        onMessage(JSON.parse(ev.data));
      } catch {
        /* ignora mensagens inválidas */
      }
    };
    ws.onclose = (ev) => {
      onStatus(false);
      if (stopped || ev.code === 4004) return;
      setTimeout(() => void open(), retry);
      retry = Math.min(retry * 2, 15_000);
    };
  };
  void open();

  return {
    send(data: unknown) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
    },
    close() {
      stopped = true;
      ws?.close();
    },
  };
}
