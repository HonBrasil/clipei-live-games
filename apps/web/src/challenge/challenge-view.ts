import type { ChallengeSnapshot } from '@clipei/shared';
import type { Sfx } from '../arena/sfx.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const RESULT: Record<string, { icon: string; text: string; tone: string }> = {
  done: { icon: '✅', text: 'Desafio cumprido!', tone: 'ok' },
  failed: { icon: '❌', text: 'Não rolou!', tone: 'bad' },
  timeout: { icon: '⏰', text: 'Acabou o tempo!', tone: 'warn' },
  skipped: { icon: '🎯', text: 'Desafio cancelado', tone: 'warn' },
};

/**
 * Desafios do Chat no OBS:
 *  - votação: cartão na posição do overlay com as opções (!1, !2…) e os votos;
 *  - desafio valendo: faixa discreta no topo com o tempo, para o streamer seguir jogando;
 *  - resultado: a faixa mostra cumprido / não rolou por alguns segundos.
 */
export class ChallengeView {
  private s: ChallengeSnapshot | null = null;
  private offset = 0;

  constructor(
    private zone: HTMLElement,
    private banner: HTMLElement,
    private stage: HTMLElement,
    private sfx: Sfx | null,
    private hooks: { onShow: () => void; confetti: () => void },
  ) {
    window.setInterval(() => this.tick(), 250);
  }

  setState(next: ChallengeSnapshot) {
    const prev = this.s;
    this.s = next;
    this.offset = next.serverNow - Date.now();

    // votação
    if (next.status === 'vote') {
      if (this.zone.classList.contains('is-hidden')) {
        this.zone.classList.remove('is-hidden');
        this.hooks.onShow();
      }
      const total = Math.max(1, next.options.reduce((a, o) => a + o.votes, 0));
      const top = Math.max(...next.options.map((o) => o.votes));
      this.zone.innerHTML = `<div class="ch-card">
        <header class="ch-head"><b>🎯 Desafio para o streamer</b><em data-k="vt"></em></header>
        <p class="ch-sub">Vote no chat com o número. O mais votado vale!</p>
        <ol class="ch-opts">${next.options
          .map(
            (o, i) => `<li class="${o.votes && o.votes === top ? 'is-top' : ''}">
              <kbd>!${i + 1}</kbd>
              <span><b>${esc(o.text)}</b><small>${o.minutes > 0 ? `⏱️ ${o.minutes} min` : '✔️ até cumprir'}</small></span>
              <em>${o.votes}</em>
              <i style="width:${Math.round((o.votes / total) * 100)}%"></i>
            </li>`,
          )
          .join('')}</ol>
        <p class="ch-foot">${next.voters} ${next.voters === 1 ? 'pessoa votou' : 'pessoas votaram'}</p>
      </div>`;
      if (prev?.status !== 'vote') this.sfx?.play('warn');
    } else this.zone.classList.add('is-hidden');

    // faixa do desafio valendo / resultado
    const showBanner = (next.status === 'active' || next.status === 'done') && next.current;
    this.banner.hidden = !showBanner;
    this.stage.classList.toggle('has-challenge', !!showBanner);
    if (showBanner && next.current) {
      const r = next.status === 'done' && next.result ? RESULT[next.result] : null;
      this.banner.className = `ch-banner ${r ? `is-${r.tone}` : ''}`;
      this.banner.innerHTML = r
        ? `<span class="ch-ico">${r.icon}</span><span class="ch-txt"><small>${r.text}</small><b>${esc(next.current.text)}</b></span>`
        : `<span class="ch-ico">🎯</span><span class="ch-txt"><small>Desafio do chat</small><b>${esc(next.current.text)}</b></span><em data-k="ct"></em>`;
      if (prev?.status !== 'active' && next.status === 'active') this.sfx?.play('spawn');
      if (prev?.status === 'active' && next.status === 'done') {
        this.sfx?.play(next.result === 'done' ? 'victory' : 'slam');
        if (next.result === 'done') this.hooks.confetti();
      }
    }
    this.tick();
  }

  private tick() {
    const s = this.s;
    if (!s) return;
    const now = Date.now() + this.offset;
    const vt = this.zone.querySelector<HTMLElement>('[data-k="vt"]');
    if (vt && s.voteEndsAt) vt.textContent = fmt(s.voteEndsAt - now);
    const ct = this.banner.querySelector<HTMLElement>('[data-k="ct"]');
    if (ct) {
      if (s.endsAt) {
        const left = s.endsAt - now;
        ct.textContent = fmt(left);
        ct.classList.toggle('is-low', left <= 30_000);
      } else ct.textContent = 'até cumprir';
    }
  }
}
