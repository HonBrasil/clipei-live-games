import type { ChatEvent, SimulatorStatus } from '@clipei/shared';

/**
 * Simulador de chat: gera espectadores falsos mandando comandos.
 * Serve para testar o overlay no OBS e o comportamento com chat lotado
 * antes de entrar ao vivo.
 */

const PREFIX = ['Dark', 'Neo', 'Mega', 'Turbo', 'Pixel', 'Shadow', 'Cyber', 'Lord', 'Mestre', 'Brabo', 'Guerreiro', 'Lobo', 'Ninja', 'Zika', 'Pro', 'Mago', 'Fênix', 'Tigrão', 'Bug', 'Lag'];
const SUFFIX = ['Gamer', 'BR', 'Snipa', 'Killer', 'Zueiro', 'TTV', 'Craft', 'Clutch', 'GG', 'Noob', 'Rush', 'Headshot', 'Combo', 'Tryhard', 'Mito', 'Lenda', 'Fps', 'Speed'];
const COLORS = ['#FF4D6D', '#7C5CFF', '#00E0FF', '#FFC300', '#3DFF8B', '#FF7A00', '#FF5CF4', '#9EF01A', '#5CA8FF', '#FFFFFF'];
const CHATTER = ['kkkkkkk', 'GG', 'bora chat', 'vai morrer', 'que boss forte', 'Pog', 'aaaaaa', 'CADÊ O DANO', 'EZ', 'tô chegando'];

interface FakeViewer {
  id: string;
  name: string;
  color: string;
  isSub: boolean;
}

export class ChatSimulator {
  private timer: NodeJS.Timeout | null = null;
  private viewers: FakeViewer[] = [];
  private carry = 0;
  private seq = 0;
  status: SimulatorStatus = { running: false, viewers: 60, messagesPerSecond: 25, subRatio: 0.2 };

  constructor(
    private channelId: string,
    private emit: (event: ChatEvent) => void,
  ) {}

  configure(next: Partial<SimulatorStatus>) {
    const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
    this.status = {
      running: next.running ?? this.status.running,
      viewers: clamp(Math.round(next.viewers ?? this.status.viewers), 1, 5000),
      messagesPerSecond: clamp(next.messagesPerSecond ?? this.status.messagesPerSecond, 0.5, 2000),
      subRatio: clamp(next.subRatio ?? this.status.subRatio, 0, 1),
    };
    this.buildViewers();
    if (this.status.running) this.start();
    else this.stop();
    return this.status;
  }

  private buildViewers() {
    const { viewers, subRatio } = this.status;
    while (this.viewers.length < viewers) {
      const i = this.viewers.length;
      const name = `${pick(PREFIX)}${pick(SUFFIX)}${Math.random() < 0.5 ? Math.floor(Math.random() * 99) : ''}`;
      this.viewers.push({ id: `sim-${i}`, name, color: pick(COLORS), isSub: false });
    }
    this.viewers.length = viewers;
    this.viewers.forEach((v, i) => (v.isSub = i < viewers * subRatio));
  }

  private start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), 100);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.status.running = false;
  }

  private step() {
    this.carry += this.status.messagesPerSecond / 10;
    let count = Math.floor(this.carry);
    this.carry -= count;
    while (count-- > 0) {
      const v = pick(this.viewers);
      const r = Math.random();
      const text = r < 0.86 ? '!atk' : r < 0.9 ? '!ult' : pick(CHATTER);
      this.emit({
        id: `sim-msg-${++this.seq}`,
        platform: 'simulator',
        channelId: this.channelId,
        text,
        ts: Date.now(),
        user: {
          id: v.id,
          login: v.name.toLowerCase(),
          displayName: v.name,
          color: v.color,
          isSub: v.isSub,
          isMod: false,
          isVip: false,
          isBroadcaster: false,
        },
      });
    }
  }
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
