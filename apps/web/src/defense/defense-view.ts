import { DEFENSE_CLASSES, DEFENSE_UPGRADES, DEFENSE_UPGRADE_IDS, type DefenseSnapshot } from '@clipei/shared';
import type { Sfx } from '../arena/sfx.ts';
import type { NameMode } from '../arena/name-tags.ts';
import { DefenseArena } from './defense-arena.ts';

const nf = new Intl.NumberFormat('pt-BR');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/**
 * Tela da Defesa da Base no OBS: o canvas (DefenseArena) e o HUD por cima
 * (onda, vida da base, inscrições, votação de melhoria, avisos e resultado).
 */
export class DefenseView {
  readonly arena: DefenseArena;
  /** true = tela cheia mesmo com o overlay sobreposto */
  fullscreen = true;
  private s: DefenseSnapshot | null = null;
  private offset = 0;
  private bigText = '';
  private bigTone = '';
  private bigUntil = 0;
  private resultTimer: number | undefined;
  private el: Record<string, HTMLElement> = {};

  constructor(
    private zone: HTMLElement,
    sfx: Sfx | null,
    private hooks: { onShow: () => void; onFullscreen: () => void; confetti: (box: HTMLElement) => void; onIdle: () => void },
  ) {
    zone.innerHTML = `
      <canvas class="arena-canvas"></canvas>
      <div class="br-top">
        <div class="br-chip"><b>Defesa da Base</b><span data-k="wave"></span></div>
        <div class="br-storm def-ups" data-k="ups" hidden></div>
      </div>
      <div class="race-lobby br-lobby def-lobby" data-k="lobby" hidden>
        <small>🏰 Defesa da Base</small>
        <b>Vire uma torre!</b>
        <div class="def-classes">
          ${(['arqueiro', 'mago', 'canhao'] as const)
            .map((c) => `<div style="--c:${DEFENSE_CLASSES[c].color}"><span>${DEFENSE_CLASSES[c].emoji}</span><kbd>!${c}</kbd><small>${DEFENSE_CLASSES[c].desc}</small></div>`)
            .join('')}
        </div>
        <span>Os monstros chegam em <em data-k="lobbyTime">1:00</em> · <em data-k="lobbyCount">0</em> torres</span>
      </div>
      <div class="def-vote" data-k="vote" hidden></div>
      <div class="duel-big br-big def-big" data-k="big" hidden></div>
      <div class="cta br-cta" data-k="cta" hidden>Sua torre atira sozinha <span class="dot">·</span> Tiro forte: <kbd>!atk</kbd> <span class="dot">·</span> Entre: <kbd class="alt">!arqueiro</kbd> <kbd class="alt">!mago</kbd> <kbd class="alt">!canhao</kbd></div>
      <div class="alerts" data-k="alerts" aria-live="polite"></div>
      <div class="result" data-k="result">
        <div class="confetti" data-k="confetti"></div>
        <div class="result-card" data-k="card"></div>
      </div>`;
    zone.querySelectorAll<HTMLElement>('[data-k]').forEach((n) => (this.el[n.dataset.k!] = n));
    this.arena = new DefenseArena(zone.querySelector('canvas')!, sfx);
    window.setInterval(() => this.tick(), 250);
  }

  setNames(mode: NameMode) {
    this.arena.setNames(mode);
  }

  setState(next: DefenseSnapshot) {
    const prev = this.s;
    this.s = next;
    this.offset = next.serverNow - Date.now();
    if (this.fullscreen !== next.fullscreen) {
      this.fullscreen = next.fullscreen;
      this.hooks.onFullscreen();
    }
    this.zone.classList.toggle('force-full', next.fullscreen);
    this.arena.setState(next);
    const active = next.status === 'lobby' || next.status === 'wave' || next.status === 'vote';
    if (active) {
      window.clearTimeout(this.resultTimer);
      this.el.result!.classList.remove('is-visible');
      if (this.zone.classList.contains('is-hidden')) {
        this.zone.classList.remove('is-hidden');
        this.hooks.onShow();
      }
    } else if (prev && prev.status !== 'finished' && next.status === 'finished') {
      this.big(next.result === 'won' ? 'A BASE RESISTIU!' : 'A BASE CAIU!', next.result === 'won' ? 'win' : 'lose', 2400);
      window.setTimeout(() => this.showResult(next), 2400);
    } else if (next.status === 'stopped' || next.status === 'idle') {
      this.zone.classList.add('is-hidden');
      this.hooks.onIdle();
    }

    // começo de onda e melhoria escolhida
    if (next.status === 'wave' && (prev?.status !== 'wave' || prev.wave !== next.wave)) {
      this.big(next.wave === next.waves ? 'ÚLTIMA ONDA!' : `ONDA ${next.wave}`, next.wave === next.waves ? 'lose' : '', 2200);
    }
    for (const f of next.fx) {
      if (f.kind === 'upgrade') {
        const u = DEFENSE_UPGRADES[f.u];
        this.alert(u.emoji, u.name.toUpperCase(), u.desc, 'points');
      } else if (f.kind === 'meteor') this.alert('☄️', f.name, 'meteoro!', 'bits');
      else if (f.kind === 'hero') this.alert('🦸', f.name, 'herói na base', 'sub');
      else if (f.kind === 'allies') this.alert('⚔️', f.name === 'Raid' ? 'RAID' : f.name, `${f.n} aliados saindo da base`, 'raid');
      else if (f.kind === 'level') this.alert('🗼', f.name, `torre nível ${f.level}`, 'points');
    }

    // topo
    this.el.wave!.textContent =
      next.status === 'lobby' ? 'inscrições' : next.status === 'finished' ? `onda ${next.wave}/${next.waves}` : `onda ${Math.max(1, next.wave)}/${next.waves} · ${nf.format(next.kills)} 💀`;
    const ups = DEFENSE_UPGRADE_IDS.filter((u) => next.upgrades[u] > 0);
    this.el.ups!.hidden = !ups.length || next.status === 'lobby';
    this.el.ups!.innerHTML = ups.map((u) => `<span title="${DEFENSE_UPGRADES[u].name}">${DEFENSE_UPGRADES[u].emoji}${next.upgrades[u] > 1 ? `<sup>${next.upgrades[u]}</sup>` : ''}</span>`).join('');

    // inscrições
    this.el.lobby!.hidden = next.status !== 'lobby';
    this.el.lobbyCount!.textContent = nf.format(next.humans);
    this.el.cta!.hidden = next.status !== 'wave';

    // votação
    this.el.vote!.hidden = next.status !== 'vote';
    if (next.status === 'vote') {
      const total = Math.max(1, next.votes.muralha + next.votes.gelo + next.votes.fogo);
      const top = Math.max(next.votes.muralha, next.votes.gelo, next.votes.fogo);
      this.el.vote!.innerHTML = `
        <div class="dv-head"><b>Onda ${next.wave} segurada!</b><span>Votem a melhoria · <em data-k="voteTime"></em></span></div>
        <div class="dv-opts">${DEFENSE_UPGRADE_IDS.map((u) => {
          const d = DEFENSE_UPGRADES[u];
          const n = next.votes[u];
          return `<div class="dv-opt ${n && n === top ? 'is-top' : ''}" style="--c:${d.color}">
            <span class="dv-ico">${d.emoji}</span><b>${d.name}${next.upgrades[u] ? ` <sup>nv ${next.upgrades[u] + 1}</sup>` : ''}</b>
            <small>${d.desc}</small><kbd>!${u}</kbd>
            <i style="width:${Math.round((n / total) * 100)}%"></i><em>${nf.format(n)} ${n === 1 ? 'voto' : 'votos'}</em></div>`;
        }).join('')}</div>`;
      this.el.voteTime = this.el.vote!.querySelector<HTMLElement>('[data-k="voteTime"]')!;
    }
    this.tick();
  }

  private big(text: string, tone: string, ms: number) {
    this.bigText = text;
    this.bigTone = tone;
    this.bigUntil = Date.now() + ms;
  }

  private alert(icon: string, who: string, text: string, tone: string) {
    const el = document.createElement('div');
    el.className = `alert alert--${tone}`;
    el.innerHTML = `<span class="a-ico">${icon}</span><b>${esc(who)}</b><span>${esc(text)}</span>`;
    this.el.alerts!.prepend(el);
    while (this.el.alerts!.children.length > 3) this.el.alerts!.lastElementChild?.remove();
    window.setTimeout(() => el.classList.add('is-out'), 4500);
    window.setTimeout(() => el.remove(), 5000);
  }

  private showResult(s: DefenseSnapshot) {
    const won = s.result === 'won';
    const podium = s.mvp
      .map(
        (m, i) =>
          `<span class="r-top"><i>${['🥇', '🥈', '🥉'][i]}</i> <b style="color:${esc(m.color)}">${esc(m.name)}</b> ${DEFENSE_CLASSES[m.cls].emoji} <em>${nf.format(m.dmg)}</em></span>`,
      )
      .join('');
    this.el.card!.innerHTML = `
      <div class="r-title">${won ? 'A base resistiu!' : `A base caiu na onda ${s.wave}`}</div>
      <div class="r-sub">${won ? `${s.waves} ondas seguradas` : `de ${s.waves} ondas`} · <b>${nf.format(s.kills)}</b> monstros derrubados · ${nf.format(s.humans)} torres do chat</div>
      ${podium ? `<div class="r-sub">Quem mais causou dano</div><div class="r-podium">${podium}</div>` : ''}`;
    this.el.result!.classList.add('is-visible');
    if (won) this.hooks.confetti(this.el.confetti!);
    window.clearTimeout(this.resultTimer);
    this.resultTimer = window.setTimeout(() => {
      this.el.result!.classList.remove('is-visible');
      this.zone.classList.add('is-hidden');
      this.hooks.onIdle();
    }, 9500);
  }

  private tick() {
    const s = this.s;
    if (!s) return;
    const now = Date.now() + this.offset;
    if (s.status === 'lobby' && s.lobbyEndsAt) this.el.lobbyTime!.textContent = fmt(s.lobbyEndsAt - now);
    if (s.status === 'vote' && s.phaseEndsAt && this.el.voteTime) this.el.voteTime.textContent = `${Math.max(0, Math.ceil((s.phaseEndsAt - now) / 1000))}s`;
    const big = Date.now() < this.bigUntil;
    this.el.big!.hidden = !big;
    if (big) {
      this.el.big!.textContent = this.bigText;
      this.el.big!.className = `duel-big br-big def-big ${this.bigTone}`;
    }
  }
}
