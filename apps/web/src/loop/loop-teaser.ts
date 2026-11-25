import { LOOP_GAME_INFO, type LoopSnapshot } from '@clipei/shared';

/** Pílula no topo do OBS: "Próximo minigame · 🏁 Corrida · 0:42" (Modo Loop). */
export class LoopTeaser {
  private state: LoopSnapshot | null = null;
  private offset = 0;
  private timer: number | null = null;

  constructor(private root: HTMLElement) {}

  setState(s: LoopSnapshot) {
    this.state = s;
    this.offset = s.serverNow - Date.now();
    const show = s.enabled && s.teaser && !!s.next && s.at !== null;
    this.root.hidden = !show;
    if (!show) {
      this.stop();
      return;
    }
    const g = LOOP_GAME_INFO[s.next!];
    this.root.innerHTML = `<span class="ln-label">🔁 Próximo minigame</span>
      <b class="ln-game">${g.emoji} ${g.name}</b>
      <span class="ln-time"></span>`;
    this.render();
    if (this.timer === null) this.timer = window.setInterval(() => this.render(), 250);
  }

  private render() {
    const s = this.state;
    const el = this.root.querySelector<HTMLElement>('.ln-time');
    if (!s?.at || !el) return;
    const now = Date.now() + this.offset;
    // Temporizador: só aparece no último minuto
    const before = s.warnAt !== null && now < s.warnAt;
    this.root.hidden = before;
    if (before) return;
    const left = Math.max(0, Math.ceil((s.at - now) / 1000));
    el.textContent = left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'agora!';
    this.root.classList.toggle('is-soon', left <= 10);
  }

  private stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }
}
