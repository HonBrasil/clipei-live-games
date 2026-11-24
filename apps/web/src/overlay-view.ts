import { DEFAULT_SETTINGS, type BossSnapshot, type LayoutSettings, type LeaderboardEntry, type RoomSettings } from '@clipei/shared';
import { Arena } from './arena/arena.ts';
import { Sfx } from './arena/sfx.ts';

/**
 * Overlay do OBS: tela 1920×1080 transparente com a arena (boss + heróis)
 * e um HUD discreto, sem caixas por cima da gameplay.
 * Usado pela fonte do OBS (overlay.ts) e pela prévia interativa (demo.ts).
 *
 * Posição, tamanho, barra de vida e ranking vêm das configurações da sala
 * e mudam ao vivo, sem precisar colar a URL de novo no OBS.
 */
export interface OverlayOptions {
  /** mostra "aguardando boss" quando não há luta (prévia do painel) */
  preview?: boolean;
  logoUrl?: string;
  /** elemento usado como referência de tamanho (padrão: a janela) */
  fitTo?: HTMLElement;
  /** começa sem som (prévia no painel, para não tocar junto com o OBS) */
  muted?: boolean;
}

const nf = new Intl.NumberFormat('pt-BR');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function mountOverlay(stage: HTMLElement, opts: OverlayOptions = {}) {
  const logo = opts.logoUrl ?? '/logo.png';
  stage.classList.add('stage');

  stage.innerHTML = /* html */ `
    <section class="zone is-hidden" id="zone">
      <canvas class="arena-canvas" id="arena"></canvas>
      <ol class="rank" id="rank" aria-label="Top dano"></ol>
      <div class="alerts" id="alerts" aria-live="polite"></div>
      <div class="cta" id="cta"><kbd>!atk</kbd> para atacar <span class="dot">·</span> <kbd class="alt">!ult</kbd> 1x <span class="dot">·</span> <b id="players">0</b> guerreiros</div>
      <div class="incoming" id="incoming" hidden>
        <span class="incoming-icon" aria-hidden="true">!</span>
        <span><small>Boss a caminho</small><b id="incoming-time">1:00</b></span>
      </div>
      <div class="result" id="result">
        <div class="confetti" id="confetti"></div>
        <div class="result-card" id="result-card"></div>
      </div>
    </section>
    <div class="bossbar" id="bossbar">
      <div class="bb-head">
        <span class="bb-name" id="name">Boss</span>
        <span class="bb-tag" id="tag"></span>
        <span class="bb-time" id="time"></span>
      </div>
      <div class="bb-track">
        <div class="bb-ghost" id="hp-ghost" style="width:100%"></div>
        <div class="bb-fill" id="hp-fill" style="width:100%"></div>
        <i style="left:50%"></i><i style="left:20%"></i>
      </div>
      <div class="bb-hp" id="hp-text"></div>
    </div>
    ${
      opts.preview
        ? `<div class="waiting" id="waiting"><img src="${logo}" alt="" /><span>Aguardando boss…</span><small>A arena aparece aqui quando um boss for invocado</small></div>`
        : ''
    }
    <div class="conn-lost" id="conn" hidden>Reconectando…</div>
  `;

  const $ = (id: string) => stage.querySelector<HTMLElement>(`#${id}`)!;
  const els = {
    zone: $('zone'),
    bossbar: $('bossbar'),
    name: $('name'),
    tag: $('tag'),
    time: $('time'),
    hpFill: $('hp-fill'),
    hpGhost: $('hp-ghost'),
    hpText: $('hp-text'),
    players: $('players'),
    cta: $('cta'),
    alerts: $('alerts'),
    rank: $('rank'),
    result: $('result'),
    resultCard: $('result-card'),
    confetti: $('confetti'),
    incoming: $('incoming'),
    incomingTime: $('incoming-time'),
    waiting: stage.querySelector<HTMLElement>('#waiting'),
    conn: $('conn'),
  };

  const sfx = new Sfx();
  sfx.muted = !!opts.muted;
  const canvas = $('arena') as HTMLCanvasElement;
  const arena = new Arena(canvas, sfx);

  // ─── Layout (posição, tamanho, barra de vida) ───────────────
  let layout: LayoutSettings = DEFAULT_SETTINGS.layout;
  let stageScale = 1;

  function applyLayout(next: LayoutSettings) {
    layout = next;
    stage.dataset.pos = next.position;
    stage.dataset.hp = next.hpBar;
    stage.style.setProperty('--z', String(next.size / 100));
    els.rank.hidden = !next.showRanking;
    arena.setFloor(next.showFloor);
    // barra de vida: acima do boss (dentro da arena) ou no topo da tela
    if (next.hpBar === 'top') stage.appendChild(els.bossbar);
    else els.zone.appendChild(els.bossbar);
    updateResolution();
  }

  function updateResolution() {
    arena.setResolution(stageScale * (layout.size / 100) * (window.devicePixelRatio || 1));
  }

  // ─── Escala 1920×1080 → tamanho real (fonte do OBS ou container) ──
  function fit() {
    const w = opts.fitTo ? opts.fitTo.clientWidth : innerWidth;
    const h = opts.fitTo ? opts.fitTo.clientHeight : innerHeight;
    stageScale = Math.min(w / 1920, h / 1080);
    stage.style.transform = `scale(${stageScale})`;
    stage.style.left = `${(w - 1920 * stageScale) / 2}px`;
    stage.style.top = `${(h - 1080 * stageScale) / 2}px`;
    updateResolution();
  }
  if (opts.fitTo) new ResizeObserver(fit).observe(opts.fitTo);
  else addEventListener('resize', fit);
  fit();
  applyLayout(layout);

  // ─── Estado da luta ─────────────────────────────────────────
  let state: BossSnapshot | null = null;
  let prevStatus: BossSnapshot['status'] | null = null;
  let clockOffset = 0;
  let resultTimer: number | undefined;
  let incomingAt: number | null = null;
  let incomingOffset = 0;

  function setVisible(show: boolean) {
    els.zone.classList.toggle('is-hidden', !show);
    els.bossbar.classList.toggle('is-hidden', !show);
  }
  setVisible(false);

  function render(next: BossSnapshot) {
    clockOffset = next.serverNow - Date.now();
    const firstLoad = prevStatus === null;
    state = next;
    arena.setState(next);

    const running = next.status === 'running';
    const justEnded = prevStatus === 'running' && (next.status === 'victory' || next.status === 'escaped');

    if (running) {
      clearTimeout(resultTimer);
      els.result.classList.remove('is-visible');
      els.cta.hidden = false;
      setVisible(true);
    } else if (justEnded) {
      els.bossbar.classList.add('is-hidden');
      els.cta.hidden = true;
      // deixa a explosão/fuga acontecer antes do placar
      setTimeout(() => showResult(next), next.status === 'victory' ? 2000 : 1500);
    } else if (firstLoad || next.status === 'idle') {
      setVisible(false);
    }
    if (els.waiting) els.waiting.hidden = running || justEnded || incomingAt !== null;

    stage.classList.toggle('phase-2', next.phase === 2);
    stage.classList.toggle('phase-3', next.phase === 3);
    els.tag.textContent = next.phase === 2 ? 'Fúria' : next.phase === 3 ? 'Desespero' : '';
    els.tag.hidden = next.phase === 1;

    const pct = Math.max(0, (next.hp / next.maxHp) * 100);
    els.name.textContent = next.name;
    els.hpFill.style.width = `${pct}%`;
    els.hpGhost.style.width = `${pct}%`;
    els.hpText.textContent = `${nf.format(next.hp)} / ${nf.format(next.maxHp)}`;
    els.players.textContent = nf.format(next.participants);
    renderRank(next.leaderboard);
    for (const h of next.recentHits) if (h.special) showAlert(h);
    prevStatus = next.status;
  }

  const ALERT_ICON: Record<string, string> = { bits: '💎', sub: '⭐', gift: '🎁', points: '🎯', raid: '🚀' };
  function showAlert(h: BossSnapshot['recentHits'][number]) {
    const el = document.createElement('div');
    el.className = `alert alert--${h.special}`;
    el.innerHTML = `<span class="a-ico">${ALERT_ICON[h.special!] ?? '✨'}</span><b>${esc(h.name)}</b><span>${esc(h.label ?? '')}</span><em>-${nf.format(h.damage)}</em>`;
    els.alerts.prepend(el);
    while (els.alerts.children.length > 3) els.alerts.lastElementChild?.remove();
    setTimeout(() => el.classList.add('is-out'), 4500);
    setTimeout(() => el.remove(), 5000);
  }

  function renderRank(top: LeaderboardEntry[]) {
    els.rank.innerHTML = top
      .slice(0, 3)
      .map((p, i) => `<li><span class="pos">${i + 1}</span><span class="who">${esc(p.name)}</span><span class="val">${nf.format(p.damage)}</span></li>`)
      .join('');
  }

  function showResult(s: BossSnapshot) {
    const victory = s.status === 'victory';
    const top = s.leaderboard
      .slice(0, 3)
      .map((p, i) => `<span class="r-top"><i>${i + 1}º</i> ${esc(p.name)} <em>${nf.format(p.damage)}</em></span>`)
      .join('');
    els.result.classList.toggle('is-escaped', !victory);
    els.resultCard.innerHTML = `
      <div class="r-title">${victory ? 'Boss derrotado!' : 'O boss fugiu…'}</div>
      <div class="r-sub">${
        victory
          ? `Golpe final de <b>${esc(s.finalBlow ?? '—')}</b> · ${nf.format(s.participants)} guerreiros`
          : `Faltaram <b>${nf.format(s.hp)}</b> de vida · revanche na próxima!`
      }</div>
      <div class="r-podium">${top}</div>`;
    els.result.classList.add('is-visible');
    if (victory) confetti();
    clearTimeout(resultTimer);
    resultTimer = window.setTimeout(() => {
      els.result.classList.remove('is-visible');
      setVisible(false);
    }, 9000);
  }

  function confetti() {
    const colors = ['#ff1f2d', '#ffffff', '#ffc83d', '#ff4b55'];
    els.confetti.innerHTML = '';
    for (let i = 0; i < 90; i++) {
      const c = document.createElement('i');
      c.style.left = `${10 + Math.random() * 80}%`;
      c.style.background = colors[i % colors.length];
      c.style.setProperty('--drift', `${(Math.random() - 0.5) * 220}px`);
      c.style.setProperty('--rot', `${Math.random() * 1080}deg`);
      c.style.animationDuration = `${1.8 + Math.random() * 1.8}s`;
      c.style.animationDelay = `${Math.random() * 0.6}s`;
      els.confetti.appendChild(c);
    }
  }

  // ─── Relógio + aviso de boss chegando ───────────────────────
  setInterval(() => {
    if (state?.status === 'running' && state.endsAt) {
      const s = Math.ceil(Math.max(0, state.endsAt - (Date.now() + clockOffset)) / 1000);
      els.time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      els.time.classList.toggle('is-urgent', s <= 15);
    } else {
      els.time.textContent = '';
    }

    const showIncoming = incomingAt !== null && state?.status !== 'running';
    els.incoming.hidden = !showIncoming;
    if (showIncoming) {
      els.zone.classList.remove('is-hidden');
      const left = Math.max(0, Math.ceil((incomingAt! - (Date.now() + incomingOffset)) / 1000));
      els.incomingTime.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      if (els.waiting) els.waiting.hidden = true;
    }
  }, 250);

  return {
    render,
    setOnline(online: boolean) {
      els.conn.hidden = online || !state;
    },
    setSettings(settings: RoomSettings) {
      sfx.setVolume(settings.volume / 100);
      applyLayout(settings.layout ?? DEFAULT_SETTINGS.layout);
    },
    incoming(at: number | null, serverNow = Date.now()) {
      incomingAt = at;
      incomingOffset = serverNow - Date.now();
      if (at !== null) sfx.play('warn');
      else if (state?.status !== 'running') els.zone.classList.add('is-hidden');
    },
    testSound() {
      sfx.play('victory');
    },
    /** Libera o áudio (navegadores exigem um clique; o OBS não). */
    unlockAudio() {
      sfx.unlock();
    },
    setMuted(muted: boolean) {
      sfx.muted = muted;
      if (!muted) sfx.unlock();
    },
  };
}
