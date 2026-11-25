import { DEFAULT_SETTINGS, DUEL_SCENES, RACE_TRACKS, ROYALE_FLAG, ROYALE_REGIONS, ROYALE_REGION_IDS, ROYALE_WEAPONS, type RoyaleSnapshot, type DuelSnapshot, type BossSnapshot, type LayoutSettings, type LeaderboardEntry, type RaceSnapshot, type RoomSettings } from '@clipei/shared';
import { Arena } from './arena/arena.ts';
import { Sfx } from './arena/sfx.ts';
import { RaceArena } from './race/race-arena.ts';
import { DuelArena } from './duel/duel-arena.ts';
import { RoyaleArena } from './royale/royale-arena.ts';

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
    <section class="zone race-zone is-hidden" id="race-zone">
      <canvas class="arena-canvas" id="race-canvas"></canvas>
      <div class="race-chip" id="race-chip"><b id="race-track">Corrida</b><span id="race-info"></span></div>
      <ol class="rank race-rank" id="race-rank" aria-label="Posições"></ol>
      <div class="race-lobby" id="race-lobby" hidden>
        <small>Corrida aberta</small>
        <b>Digite <kbd>!correr</kbd> para entrar</b>
        <span>Largada em <em id="race-lobby-time">0:45</em> · <em id="race-lobby-count">0</em> pilotos</span>
      </div>
      <div class="race-count" id="race-count" hidden></div>
      <div class="race-turbo" id="race-turbo" hidden>
        <b>⚡ TURBO!</b><span>digite <kbd>!turbo</kbd></span>
        <i><em id="race-turbo-bar"></em></i>
      </div>
      <div class="alerts" id="race-alerts" aria-live="polite"></div>
      <div class="result" id="race-result">
        <div class="confetti" id="race-confetti"></div>
        <div class="result-card" id="race-result-card"></div>
      </div>
    </section>
    <section class="zone duel-zone is-hidden" id="duel-zone">
      <canvas class="arena-canvas" id="duel-canvas"></canvas>
      <div class="race-chip duel-chip" id="duel-chip"><b>Duelo</b><span id="duel-info">X1</span></div>
      <div class="duel-score" id="duel-score" hidden></div>
      <div class="race-lobby duel-lobby" id="duel-lobby" hidden>
        <small>🤠 Duelo</small>
        <b>Digite <kbd>!duelo</kbd> para entrar</b>
        <span id="duel-lobby-who">Os dois primeiros se enfrentam</span>
        <span>Fecha em <em id="duel-lobby-time">1:00</em></span>
      </div>
      <div class="duel-big" id="duel-big" hidden></div>
      <div class="duel-cheer" id="duel-cheer" hidden>
        <kbd>!1</kbd>
        <div class="duel-cheer-bar"><i id="duel-cheer-a"></i><i id="duel-cheer-b"></i></div>
        <kbd>!2</kbd>
      </div>
      <div class="cta duel-cta" id="duel-cta" hidden>Duelistas: <kbd>!bang</kbd> no FOGO <span class="dot">·</span> Torcida: <kbd class="alt">!1</kbd> ou <kbd class="alt">!2</kbd></div>
      <div class="alerts" id="duel-alerts" aria-live="polite"></div>
      <div class="result" id="duel-result">
        <div class="confetti" id="duel-confetti"></div>
        <div class="result-card" id="duel-result-card"></div>
      </div>
    </section>
    <section class="zone royale-zone is-hidden" id="br-zone">
      <canvas class="arena-canvas" id="br-canvas"></canvas>
      <div class="br-top">
        <div class="br-chip"><b>Battle Royale</b><span id="br-alive"></span></div>
        <div class="br-storm" id="br-storm" hidden></div>
      </div>
      <ol class="br-feed" id="br-feed" aria-label="Abates"></ol>
      <div class="race-lobby br-lobby" id="br-lobby" hidden>
        <small>🪂 Embarque aberto</small>
        <b>Digite <kbd>!entrar</kbd></b>
        <span>ou escolha onde cair: <kbd class="sm">!cair</kbd> + cidade, floresta, porto ou fazenda</span>
        <span>Decola em <em id="br-lobby-time">1:00</em> · <em id="br-lobby-count">0</em> jogadores</span>
      </div>
      <div class="br-vote" id="br-vote" hidden>
        <b>📦 Caixa lendária</b>
        <span>Quem morreu ou assiste escolhe onde cai: <kbd>!caixa &lt;lugar&gt;</kbd></span>
        <div class="br-vote-opts" id="br-vote-opts"></div>
      </div>
      <div class="duel-big br-big" id="br-big" hidden></div>
      <div class="cta br-cta" id="br-cta" hidden>Vivos: <kbd>!curar</kbd> <span class="dot">·</span> Fora do jogo: <kbd class="alt">!caixa &lt;lugar&gt;</kbd></div>
      <div class="alerts" id="br-alerts" aria-live="polite"></div>
      <div class="result" id="br-result">
        <div class="confetti" id="br-confetti"></div>
        <div class="result-card" id="br-result-card"></div>
      </div>
    </section>
    <div class="idle-screen" id="idle-screen" hidden>
      <img src="${logo}" alt="" />
      <b>Aguardando o próximo jogo</b>
      <span>Fique de olho no chat: vem boss <kbd>!atk</kbd>, corrida <kbd>!correr</kbd> duelo <kbd>!duelo</kbd> ou battle royale <kbd>!entrar</kbd></span>
    </div>
    ${
      opts.preview
        ? `<div class="waiting" id="waiting"><img src="${logo}" alt="" /><span>Aguardando jogo…</span><small>O minigame aparece aqui quando começar</small></div>`
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
    raceZone: $('race-zone'),
    raceTrack: $('race-track'),
    raceInfo: $('race-info'),
    raceRank: $('race-rank'),
    raceLobby: $('race-lobby'),
    raceLobbyTime: $('race-lobby-time'),
    raceLobbyCount: $('race-lobby-count'),
    raceCount: $('race-count'),
    raceTurbo: $('race-turbo'),
    raceTurboBar: $('race-turbo-bar'),
    raceAlerts: $('race-alerts'),
    raceResult: $('race-result'),
    raceResultCard: $('race-result-card'),
    raceConfetti: $('race-confetti'),
    idle: $('idle-screen'),
    duelZone: $('duel-zone'),
    duelInfo: $('duel-info'),
    duelScore: $('duel-score'),
    duelLobby: $('duel-lobby'),
    duelLobbyWho: $('duel-lobby-who'),
    duelLobbyTime: $('duel-lobby-time'),
    duelBig: $('duel-big'),
    duelCheer: $('duel-cheer'),
    duelCheerA: $('duel-cheer-a'),
    duelCheerB: $('duel-cheer-b'),
    duelCta: $('duel-cta'),
    duelAlerts: $('duel-alerts'),
    duelResult: $('duel-result'),
    duelResultCard: $('duel-result-card'),
    duelConfetti: $('duel-confetti'),
    brZone: $('br-zone'),
    brAlive: $('br-alive'),
    brStorm: $('br-storm'),
    brFeed: $('br-feed'),
    brLobby: $('br-lobby'),
    brLobbyTime: $('br-lobby-time'),
    brLobbyCount: $('br-lobby-count'),
    brVote: $('br-vote'),
    brVoteOpts: $('br-vote-opts'),
    brBig: $('br-big'),
    brCta: $('br-cta'),
    brAlerts: $('br-alerts'),
    brResult: $('br-result'),
    brResultCard: $('br-result-card'),
    brConfetti: $('br-confetti'),
  };

  const sfx = new Sfx();
  sfx.muted = !!opts.muted;
  const canvas = $('arena') as HTMLCanvasElement;
  const arena = new Arena(canvas, sfx);
  const raceArena = new RaceArena($('race-canvas') as HTMLCanvasElement, sfx);
  const duelArena = new DuelArena($('duel-canvas') as HTMLCanvasElement, sfx);
  const brArena = new RoyaleArena($('br-canvas') as HTMLCanvasElement, sfx);
  /** O Battle Royale pode ocupar a tela inteira mesmo com o overlay no modo sobreposto. */
  let brFull = true;

  // ─── Layout (posição, tamanho, barra de vida) ───────────────
  let layout: LayoutSettings = DEFAULT_SETTINGS.layout;
  let stageScale = 1;

  function applyLayout(next: LayoutSettings) {
    layout = next;
    const full = next.display === 'fullscreen';
    stage.dataset.display = full ? 'fullscreen' : 'overlay';
    arena.setBackdrop(full);
    raceArena.setDisplay(full);
    duelArena.setDisplay(full);
    stage.dataset.pos = next.position;
    stage.dataset.hp = next.hpBar;
    stage.style.setProperty('--z', String(next.size / 100));
    els.rank.hidden = !next.showRanking;
    arena.setFloor(next.showFloor);
    arena.setNames(next.names);
    raceArena.setNames(next.names);
    brArena.setNames(next.names);
    // barra de vida: acima do boss (dentro da arena) ou no topo da tela
    if (next.hpBar === 'top') stage.appendChild(els.bossbar);
    else els.zone.appendChild(els.bossbar);
    updateResolution();
  }

  function updateResolution() {
    // tela cheia: a arena de 960×540 ocupa 1920×1080 (escala 2)
    const zoom = layout.display === 'fullscreen' ? 2 : layout.size / 100;
    const res = stageScale * zoom * (window.devicePixelRatio || 1);
    arena.setResolution(res);
    raceArena.setResolution(res);
    duelArena.setResolution(res);
    brArena.setResolution(stageScale * (brFull || layout.display === 'fullscreen' ? 2 : layout.size / 100) * (window.devicePixelRatio || 1));
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
      els.raceZone.classList.add('is-hidden');
      els.duelZone.classList.add('is-hidden');
      els.brZone.classList.add('is-hidden');
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

  function confetti(box: HTMLElement = els.confetti) {
    const colors = ['#ff1f2d', '#ffffff', '#ffc83d', '#ff4b55'];
    box.innerHTML = '';
    for (let i = 0; i < 90; i++) {
      const c = document.createElement('i');
      c.style.left = `${10 + Math.random() * 80}%`;
      c.style.background = colors[i % colors.length];
      c.style.setProperty('--drift', `${(Math.random() - 0.5) * 220}px`);
      c.style.setProperty('--rot', `${Math.random() * 1080}deg`);
      c.style.animationDuration = `${1.8 + Math.random() * 1.8}s`;
      c.style.animationDelay = `${Math.random() * 0.6}s`;
      box.appendChild(c);
    }
  }

  // ─── Corrida ────────────────────────────────────────────────
  let race: RaceSnapshot | null = null;
  let raceOffset = 0;
  let raceResultTimer: number | undefined;
  let goUntil = 0;

  function renderRace(next: RaceSnapshot) {
    const prev = race;
    race = next;
    raceOffset = next.serverNow - Date.now();
    raceArena.setState(next);
    const active = next.status === 'lobby' || next.status === 'running';
    const roster = raceArena.rosterEntries;

    if (active) {
      clearTimeout(raceResultTimer);
      els.raceResult.classList.remove('is-visible');
      els.raceZone.classList.remove('is-hidden');
      // um jogo por vez: a corrida tira o boss da tela
      els.zone.classList.add('is-hidden');
      els.bossbar.classList.add('is-hidden');
      els.duelZone.classList.add('is-hidden');
      els.brZone.classList.add('is-hidden');
    } else if (prev && (prev.status === 'running' || prev.status === 'lobby') && next.status === 'finished') {
      setTimeout(() => showRaceResult(next), 1200);
    } else if (next.status === 'stopped' || next.status === 'idle') {
      els.raceZone.classList.add('is-hidden');
    }
    if (els.waiting) els.waiting.hidden = active || next.status === 'finished' || state?.status === 'running';

    els.raceTrack.textContent = RACE_TRACKS[next.track].name;
    els.raceLobby.hidden = next.status !== 'lobby';
    els.raceLobbyCount.textContent = nf.format(next.participants);
    els.raceRank.hidden = next.status !== 'running' || !layout.showRanking;
    els.raceRank.innerHTML = next.leaders
      .map((idx, i) => {
        const r = roster[idx];
        if (!r) return '';
        return `<li><span class="pos">${i + 1}</span><i class="dot" style="background:${esc(r.color)}"></i><span class="who">${esc(r.name)}</span></li>`;
      })
      .join('');

    const ICON: Record<string, string> = { rocket: '🚀', shield: '🛡️', banana: '🍌', raid: '🌬️' };
    const TEXT: Record<string, string> = { rocket: 'FOGUETE', shield: 'ESCUDO', banana: 'banana no líder', raid: 'vento a favor' };
    for (const e of next.events) {
      if (!ICON[e.kind]) continue;
      const who = e.kind === 'banana' || e.kind === 'raid' ? (e.label ?? 'Apoio') : (roster[e.who]?.name ?? '');
      const el = document.createElement('div');
      el.className = `alert alert--${e.kind === 'shield' ? 'points' : e.kind === 'raid' ? 'raid' : 'bits'}`;
      el.innerHTML = `<span class="a-ico">${ICON[e.kind]}</span><b>${esc(who)}</b><span>${TEXT[e.kind]}</span>`;
      els.raceAlerts.prepend(el);
      while (els.raceAlerts.children.length > 3) els.raceAlerts.lastElementChild?.remove();
      setTimeout(() => el.classList.add('is-out'), 4500);
      setTimeout(() => el.remove(), 5000);
    }
    tickRace();
  }

  function showRaceResult(s: RaceSnapshot) {
    const [a] = s.podium;
    const medals = ['🥇', '🥈', '🥉'];
    const fmt = (ms: number | null) => (ms === null ? 'não chegou' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`);
    els.raceResultCard.innerHTML = `
      <div class="r-title">${a ? `${esc(a.name)} venceu!` : 'Fim da corrida'}</div>
      <div class="r-sub">${nf.format(s.participants)} ${s.participants === 1 ? 'piloto' : 'pilotos'} · ${esc(RACE_TRACKS[s.track].name)}</div>
      <div class="r-podium">${s.podium.map((p, i) => `<span class="r-top"><i>${medals[i]}</i> ${esc(p.name)} <em>${fmt(p.timeMs)}</em></span>`).join('')}</div>`;
    els.raceResult.classList.add('is-visible');
    els.raceConfetti.innerHTML = '';
    confetti(els.raceConfetti);
    clearTimeout(raceResultTimer);
    raceResultTimer = window.setTimeout(() => {
      els.raceResult.classList.remove('is-visible');
      els.raceZone.classList.add('is-hidden');
    }, 9000);
  }

  /** Relógios da corrida (inscrição, contagem 3-2-1, janela de turbo, volta). */
  function tickRace() {
    if (!race) return;
    const now = Date.now() + raceOffset;
    if (race.status === 'lobby' && race.lobbyEndsAt) {
      const left = Math.max(0, Math.ceil((race.lobbyEndsAt - now) / 1000));
      els.raceLobbyTime.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      els.raceInfo.textContent = 'Inscrições';
    }
    const counting = race.status === 'running' && race.startedAt !== null && now < race.startedAt;
    if (race.status === 'running' && race.startedAt !== null && now >= race.startedAt && now - race.startedAt < 800) goUntil = Date.now() + 700;
    const showGo = Date.now() < goUntil;
    els.raceCount.hidden = !counting && !showGo;
    if (counting) els.raceCount.textContent = String(Math.ceil((race.startedAt! - now) / 1000));
    else if (showGo) els.raceCount.textContent = 'JÁ!';

    const open = race.status === 'running' && race.turbo.open && race.turbo.until !== null;
    els.raceTurbo.hidden = !open;
    if (open) els.raceTurboBar.style.width = `${Math.max(0, Math.min(100, ((race.turbo.until! - now) / 4000) * 100))}%`;

    if (race.status === 'running' && !counting) {
      const lead = race.runners.find((r) => r[0] === race!.leaders[0]);
      const lap = lead ? Math.min(race.laps, Math.floor(lead[1] / 1e4) + 1) : 1;
      els.raceInfo.textContent = `Volta ${lap}/${race.laps}`;
    }
  }

  // ─── Duelo ──────────────────────────────────────────────────
  let duel: DuelSnapshot | null = null;
  let duelOffset = 0;
  let duelResultTimer: number | undefined;
  let fireShownUntil = 0;
  let roundMsgUntil = 0;
  let lastBeep = -1;

  function renderDuel(next: DuelSnapshot) {
    const prev = duel;
    duel = next;
    duelOffset = next.serverNow - Date.now();
    duelArena.setState(next);
    const active = !['idle', 'finished', 'stopped'].includes(next.status);
    const [a, b] = next.players;

    if (active) {
      clearTimeout(duelResultTimer);
      els.duelResult.classList.remove('is-visible');
      els.duelZone.classList.remove('is-hidden');
      els.zone.classList.add('is-hidden');
      els.bossbar.classList.add('is-hidden');
      els.raceZone.classList.add('is-hidden');
      els.brZone.classList.add('is-hidden');
    } else if (prev && prev.status !== 'finished' && next.status === 'finished') {
      setTimeout(() => showDuelResult(next), 1600);
    } else if (next.status === 'stopped' || next.status === 'idle') {
      els.duelZone.classList.add('is-hidden');
    }
    if (els.waiting) els.waiting.hidden = active || next.status === 'finished' || state?.status === 'running';

    els.duelInfo.textContent = `${next.bestOf === 3 ? `MD3 · rodada ${Math.max(1, next.round)}` : 'X1'} · ${DUEL_SCENES[next.scene].name}`;
    els.duelLobby.hidden = next.status !== 'lobby';
    els.duelLobbyWho.innerHTML = a ? `<b class="who" style="color:${esc(a.color)}">${esc(a.name)}</b> espera um rival` : 'Os dois primeiros se enfrentam';
    els.duelScore.hidden = next.bestOf !== 3 || !b;
    if (b) els.duelScore.innerHTML = `<span style="color:${esc(a.color)}">${next.score[0]}</span><i>x</i><span style="color:${esc(b.color)}">${next.score[1]}</span>`;

    const cheering = next.cheerOn && !!b && active && next.status !== 'lobby';
    els.duelCheer.hidden = !cheering;
    if (cheering) {
      const [ca, cb] = next.cheers;
      const tot = ca + cb;
      const pa = tot ? (ca / tot) * 100 : 50;
      els.duelCheerA.style.width = `${pa}%`;
      els.duelCheerA.style.background = a.color;
      els.duelCheerB.style.width = `${100 - pa}%`;
      els.duelCheerB.style.background = b.color;
      els.duelCheerA.textContent = tot ? String(ca) : '';
      els.duelCheerB.textContent = tot ? String(cb) : '';
    }
    els.duelCta.hidden = !(active && next.status !== 'lobby');

    if (prev?.status !== 'fire' && next.status === 'fire') fireShownUntil = Date.now() + 1100;
    if (next.status === 'round' && prev?.status !== 'round') roundMsgUntil = Date.now() + 3000;

    for (const e of next.events) {
      if (e.kind !== 'item') continue;
      const p = next.players[e.who];
      const icon = e.item === 'aim' ? '🎯' : e.item === 'vest' ? '🦺' : '✨';
      const text = e.item === 'aim' ? 'mira +15%' : e.item === 'vest' ? 'colete' : 'revólver dourado';
      const el = document.createElement('div');
      el.className = `alert alert--${e.item === 'aim' ? 'points' : e.item === 'vest' ? 'bits' : 'sub'}`;
      el.innerHTML = `<span class="a-ico">${icon}</span><b>${esc(e.label ?? 'Apoio')}</b><span>${text} para ${esc(p?.name ?? '')}</span>`;
      els.duelAlerts.prepend(el);
      while (els.duelAlerts.children.length > 3) els.duelAlerts.lastElementChild?.remove();
      setTimeout(() => el.classList.add('is-out'), 4500);
      setTimeout(() => el.remove(), 5000);
    }
    tickDuel();
  }

  function showDuelResult(s: DuelSnapshot) {
    const w = s.winner;
    const win = w === null ? null : s.players[w];
    const lose = w === null ? null : s.players[1 - w];
    els.duelResultCard.innerHTML = `
      <div class="r-title">${win ? `${esc(win.name)} venceu!` : 'Empate!'}</div>
      <div class="r-sub">${win && lose ? `Sacou mais rápido que <b>${esc(lose.name)}</b>${s.bestOf === 3 ? ` · ${Math.max(...s.score)} x ${Math.min(...s.score)}` : ''}` : 'Ninguém acertou ninguém'}</div>`;
    els.duelResult.classList.add('is-visible');
    if (win) confetti(els.duelConfetti);
    clearTimeout(duelResultTimer);
    duelResultTimer = window.setTimeout(() => {
      els.duelResult.classList.remove('is-visible');
      els.duelZone.classList.add('is-hidden');
    }, 8000);
  }

  /** Textos grandes do duelo: nomes, 3-2-1, silêncio, FOGO!, vencedor da rodada. */
  function tickDuel() {
    if (!duel) return;
    const now = Date.now() + duelOffset;
    const [a, b] = duel.players;
    if (duel.status === 'lobby' && duel.phaseEndsAt) {
      const left = Math.max(0, Math.ceil((duel.phaseEndsAt - now) / 1000));
      els.duelLobbyTime.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    }
    let big = '';
    let cls = '';
    if (duel.status === 'intro' && a && b) {
      const left = duel.phaseEndsAt ? Math.max(0, Math.ceil((duel.phaseEndsAt - now) / 1000)) : 0;
      big = `<div class="vs-names"><span style="color:${esc(a.color)}">${esc(a.name)}</span><i>x</i><span style="color:${esc(b.color)}">${esc(b.name)}</span></div>${
        duel.cheerOn ? `<small class="vs-cheer">Torcida aberta: <kbd>!1</kbd> ou <kbd>!2</kbd> · <b>${left}s</b></small>` : ''
      }`;
      cls = 'vs';
    } else if (duel.status === 'countdown' && duel.phaseEndsAt) {
      const n = Math.ceil((duel.phaseEndsAt - now) / 1000);
      big = String(Math.max(1, n));
      cls = 'count';
      if (n !== lastBeep && n >= 1 && n <= 3) {
        lastBeep = n;
        sfx.play('hit');
      }
    } else if (duel.status === 'wait') {
      big = '…';
      cls = 'count';
      lastBeep = -1;
    } else if (Date.now() < fireShownUntil) {
      big = 'FOGO!';
      cls = 'fire';
    } else if (duel.status === 'round' && Date.now() < roundMsgUntil) {
      const w = duel.winner;
      big = w === null ? 'Ninguém acertou' : `${esc(duel.players[w].name)} venceu a rodada`;
      cls = 'round';
    }
    els.duelBig.hidden = !big;
    if (els.duelBig.innerHTML !== big) els.duelBig.innerHTML = big;
    els.duelBig.className = `duel-big ${cls}`;
  }

  // ─── Battle Royale ──────────────────────────────────────────
  let br: RoyaleSnapshot | null = null;
  let brOffset = 0;
  let brResultTimer: number | undefined;
  let brBigUntil = 0;
  let brBigText = '';

  function renderRoyale(next: RoyaleSnapshot) {
    const prev = br;
    br = next;
    brOffset = next.serverNow - Date.now();
    if (brFull !== next.fullscreen) {
      brFull = next.fullscreen;
      updateResolution();
    }
    els.brZone.classList.toggle('force-full', next.fullscreen);
    brArena.setState(next);
    const active = next.status === 'lobby' || next.status === 'drop' || next.status === 'play';
    const roster = brArena.rosterEntries;

    if (active) {
      clearTimeout(brResultTimer);
      els.brResult.classList.remove('is-visible');
      els.brZone.classList.remove('is-hidden');
      for (const z of [els.zone, els.bossbar, els.raceZone, els.duelZone]) z.classList.add('is-hidden');
    } else if (prev && prev.status !== 'finished' && next.status === 'finished') {
      brBigText = next.winner === null ? 'NINGUÉM SOBREVIVEU' : 'ÚLTIMO DE PÉ!';
      brBigUntil = Date.now() + 2600;
      setTimeout(() => showRoyaleResult(next), 2600);
    } else if (next.status === 'stopped' || next.status === 'idle') {
      els.brZone.classList.add('is-hidden');
    }
    if (els.waiting) els.waiting.hidden = active || next.status === 'finished' || state?.status === 'running';
    if (prev?.status === 'lobby' && next.status === 'drop') {
      brBigText = 'SALTAR!';
      brBigUntil = Date.now() + 1600;
    }
    if (prev?.status === 'drop' && next.status === 'play') {
      brBigText = 'VALENDO!';
      brBigUntil = Date.now() + 1400;
    }

    els.brLobby.hidden = next.status !== 'lobby';
    els.brLobbyCount.textContent = nf.format(next.participants);
    els.brCta.hidden = next.status !== 'play';
    els.brAlive.textContent = next.status === 'lobby' ? 'embarque' : `${nf.format(next.alive)} vivos`;

    // lista de abates
    for (const e of next.events) {
      if (e.kind !== 'kill' && e.kind !== 'storm') continue;
      const victim = roster[e.b];
      const killer = e.a >= 0 ? roster[e.a] : null;
      const li = document.createElement('li');
      const how = killer ? `<i style="color:${ROYALE_WEAPONS[e.weapon ?? 0]?.color ?? '#fff'}">${esc(ROYALE_WEAPONS[e.weapon ?? 0]?.name ?? '')}</i>` : `<i>${e.label === 'bombardeio' ? '💣' : e.label === 'tempo' ? '⏱️' : '🌪️'}</i>`;
      li.innerHTML = `${killer ? `<b style="color:${esc(killer.color)}">${esc(killer.name)}</b>` : ''} ${how} <span>${esc(victim?.name ?? '')}</span>`;
      els.brFeed.prepend(li);
      while (els.brFeed.children.length > 5) els.brFeed.lastElementChild?.remove();
      setTimeout(() => li.classList.add('is-out'), 6000);
      setTimeout(() => li.remove(), 6600);
    }
    // apoios
    for (const e of next.events) {
      if (e.kind !== 'item' && e.kind !== 'supply') continue;
      const icon = e.kind === 'supply' ? '📦' : e.label === 'colete' ? '🦺' : '🩹';
      const text = e.kind === 'supply' ? `caixa lendária caindo${e.label ? ` · ${esc(e.label)}` : ''}` : e.label === 'colete' ? 'colete nível 3' : 'curativo extra';
      const who = e.kind === 'supply' ? 'Atenção' : (roster[e.a]?.name ?? '');
      const el = document.createElement('div');
      el.className = `alert alert--${e.kind === 'supply' ? 'sub' : e.label === 'colete' ? 'bits' : 'points'}`;
      el.innerHTML = `<span class="a-ico">${icon}</span><b>${esc(who)}</b><span>${text}</span>`;
      els.brAlerts.prepend(el);
      while (els.brAlerts.children.length > 3) els.brAlerts.lastElementChild?.remove();
      setTimeout(() => el.classList.add('is-out'), 4500);
      setTimeout(() => el.remove(), 5000);
    }
    tickRoyale();
  }

  function showRoyaleResult(s: RoyaleSnapshot) {
    const roster = brArena.rosterEntries;
    const w = s.winner === null ? null : roster[s.winner];
    const wk = s.winner === null ? 0 : (s.players.find((p) => p[0] === s.winner)?.[7] ?? 0);
    const top = s.topKills
      .slice(0, 3)
      .map((idx) => {
        const k = s.players.find((p) => p[0] === idx)?.[7] ?? 0;
        return `<span class="r-top"><i>💀</i> ${esc(roster[idx]?.name ?? '')} <em>${k}</em></span>`;
      })
      .join('');
    els.brResultCard.innerHTML = `
      <div class="r-title">${w ? `${esc(w.name)} venceu!` : 'Ninguém sobreviveu'}</div>
      <div class="r-sub">${w ? `Último de pé entre <b>${nf.format(roster.length)}</b> jogadores · ${wk} ${wk === 1 ? 'abate' : 'abates'}` : 'A tempestade levou todo mundo'}</div>
      ${top ? `<div class="r-podium">${top}</div>` : ''}`;
    els.brResult.classList.add('is-visible');
    if (w) confetti(els.brConfetti);
    clearTimeout(brResultTimer);
    brResultTimer = window.setTimeout(() => {
      els.brResult.classList.remove('is-visible');
      els.brZone.classList.add('is-hidden');
    }, 9000);
  }

  function tickRoyale() {
    if (!br) return;
    const now = Date.now() + brOffset;
    const fmt = (ms: number) => {
      const t = Math.max(0, Math.ceil(ms / 1000));
      return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    };
    if (br.status === 'lobby' && br.lobbyEndsAt) els.brLobbyTime.textContent = fmt(br.lobbyEndsAt - now);
    const z = br.zone;
    const showStorm = br.status === 'play';
    els.brStorm.hidden = !showStorm;
    if (showStorm) {
      els.brStorm.textContent = z.shrinkEndsAt ? '🌪️ Tempestade fechando!' : z.closesAt ? `🌪️ Fecha em ${fmt(z.closesAt - now)}` : '🌪️ Círculo final';
      els.brStorm.classList.toggle('is-urgent', !!z.shrinkEndsAt);
    }
    const voting = br.status === 'play' && br.vote.endsAt !== null;
    els.brVote.hidden = !voting;
    if (voting) {
      els.brVoteOpts.innerHTML = ROYALE_REGION_IDS.map((id) => `<span><kbd>!caixa ${id}</kbd><b>${br!.vote.counts[id]}</b></span>`).join('') + `<em>${fmt(br.vote.endsAt! - now)}</em>`;
    }
    const showBig = Date.now() < brBigUntil;
    els.brBig.hidden = !showBig;
    if (showBig && els.brBig.textContent !== brBigText) {
      els.brBig.textContent = brBigText;
      els.brBig.className = `duel-big br-big ${brBigText === 'ÚLTIMO DE PÉ!' ? 'round' : 'fire'}`;
    }
  }
  void ROYALE_FLAG;
  void ROYALE_REGIONS;

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
    tickRace();
    tickDuel();
    tickRoyale();
    // tela cheia sem jogo: tela de espera com a marca (o OBS não fica vazio)
    const nothing = els.zone.classList.contains('is-hidden') && els.raceZone.classList.contains('is-hidden') && els.duelZone.classList.contains('is-hidden') && els.brZone.classList.contains('is-hidden');
    els.idle.hidden = !(layout.display === 'fullscreen' && nothing);
    if (els.waiting && layout.display === 'fullscreen') els.waiting.hidden = true;
  }, 250);

  return {
    render,
    renderRace,
    renderDuel,
    renderRoyale,
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
