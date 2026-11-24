import './styles/overlay.css';
import './styles/demo.css';
import {
  BOSS_SKINS,
  BOSS_SKIN_IDS,
  DEFAULT_SETTINGS,
  mergeSettings,
  type ArenaPosition,
  type BossSkinId,
  type ChatEvent,
  type RoomSettings,
  type SupportEvent,
  type SupportKind,
} from '@clipei/shared';
import {
  BossGame,
  ChatActivity,
  autoBossHp,
  bossAnnouncement,
  bossHelpText,
  incomingAnnouncement,
  parseBossChatCommand,
  supportAnnouncement,
  supportDamage,
  supportLabel,
  supportName,
  supportThanks,
  type BossEvent,
} from '@clipei/games';
import { mountOverlay } from './overlay-view.ts';
import { bossDef, bossSprite } from './arena/sprites.ts';
import logoUrl from '../public/logo.png';

/**
 * Prévia interativa: roda o Boss coletivo inteiro no navegador, sem servidor.
 * Usa a mesma lógica de jogo (BossGame), o mesmo overlay e os mesmos textos do bot
 * que a versão real — só o chat é simulado.
 */
{
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const nf = new Intl.NumberFormat('pt-BR');

  ($('logo') as HTMLImageElement).src = logoUrl;

  // ─── Overlay ───────────────────────────────────────────────
  const wrap = $('stage-wrap');
  const view = mountOverlay($('stage'), { preview: true, logoUrl, fitTo: wrap, muted: true });
  let settings: RoomSettings = mergeSettings(DEFAULT_SETTINGS, {});
  const updateSettings = (patch: unknown) => {
    settings = mergeSettings(settings, patch);
    view.setSettings(settings);
  };
  view.setSettings(settings);
  const activity = new ChatActivity();

  // som: navegadores só liberam áudio depois de um clique
  let soundOn = false;
  const soundBtn = $('sound');
  soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    view.setMuted(!soundOn);
    soundBtn.textContent = soundOn ? '🔊 Som ligado' : '🔇 Ligar som';
    soundBtn.setAttribute('aria-pressed', String(soundOn));
  });

  // ─── Estado da partida ─────────────────────────────────────
  const HP_OPTIONS = [
    { hp: 0, label: 'Automática', hint: 'pelo chat' },
    { hp: 1500, label: 'Rápida', hint: '1.500 HP' },
    { hp: 12000, label: 'Longa', hint: '12.000 HP' },
  ];
  const TIME_OPTIONS = [
    { sec: 60, label: '1 min' },
    { sec: 120, label: '2 min' },
    { sec: 300, label: '5 min' },
  ];
  let skin: BossSkinId | 'random' = 'glitchador';
  let lastSkin: BossSkinId = 'glitchador';
  let hp = 0; // 0 = automática
  let duration = 120;
  let game: BossGame | null = null;

  function startBoss(forced?: BossSkinId | 'random') {
    const want = forced ?? skin;
    cancelIncoming();
    let chosen: BossSkinId;
    if (want === 'random') {
      const others = BOSS_SKIN_IDS.filter((id) => id !== lastSkin);
      chosen = others[Math.floor(Math.random() * others.length)];
    } else chosen = want;
    lastSkin = chosen;
    game?.stop();
    const maxHp = hp || autoBossHp({ activeChatters: Math.max(activity.count(), $<HTMLInputElement>('sim-on').checked ? sim.viewers.length : 0), cooldownMs: 1500, durationSec: duration });
    game = new BossGame({ skin: chosen, name: BOSS_SKINS[chosen].name, maxHp, durationSec: duration, cooldownMs: 1500 });
    announce(game.start());
    view.render(game.snapshot());
    if (!sim.running && $<HTMLInputElement>('sim-on').checked) sim.start();
    syncButtons();
  }

  function stopBoss() {
    if (!game) return;
    announce(game.stop());
    view.render(game.snapshot());
    syncButtons();
  }

  function announce(events: BossEvent[]) {
    if (!game) return;
    for (const e of events) {
      const text = bossAnnouncement(e, game.config.name);
      if (text) addBot(text);
      if (e.type === 'stopped') addBot('Partida encerrada pelo streamer.');
      if (e.type === 'victory' && $<HTMLInputElement>('clip-on').checked) {
        setTimeout(() => addBot('🎬 Clip da vitória: clips.twitch.tv/… (na prévia o clip é simulado)'), 4000);
      }
      if (e.type === 'victory' || e.type === 'escaped') {
        setTimeout(() => addBot('Escolha outro boss ali embaixo e clique em Invocar boss para mais uma rodada.'), 2500);
      }
    }
  }

  function handleChat(event: ChatEvent) {
    activity.record(`${event.platform}:${event.user.id}`);
    const cmd = parseBossChatCommand(event);
    if (cmd) {
      if (cmd.type === 'help') addBot(bossHelpText(!!game?.isRunning));
      else if (cmd.type === 'start') startBoss(cmd.skin ?? lastSkin);
      else stopBoss();
      return;
    }
    if (!game) return;
    announce(game.handle(event));
  }

  // ─── Apoios simulados (bits, sub, presentes, pontos, raid) ──
  function handleSupport(e: SupportEvent) {
    const damage = supportDamage(e, { ...settings.support, points: { ...settings.support.points, enabled: true } });
    if (!game?.isRunning || damage === null) {
      addBot(supportThanks(e) ?? 'Invoque um boss para ver o efeito do apoio.');
      return;
    }
    const events = game.special({
      id: `${e.platform}:${e.user?.id ?? 'anon'}`,
      name: supportName(e),
      platform: e.platform,
      damage,
      kind: e.kind,
      label: supportLabel(e),
      amount: e.amount,
    });
    addBot(supportAnnouncement(e, damage, game.config.name));
    announce(events);
  }
  document.querySelectorAll<HTMLButtonElement>('[data-support]').forEach((b) =>
    b.addEventListener('click', () => {
      const v = pick(sim.viewers.length ? sim.viewers : [{ id: 'x', name: 'ApoiadorBR', color: '#ffc83d', sub: true }]);
      handleSupport({
        kind: b.dataset.support as SupportKind,
        amount: Number(b.dataset.amount),
        platform: 'twitch',
        user: { id: v.id, name: v.name, color: v.color },
      });
    }),
  );

  // ─── Boss automático (demonstração com aviso de 10 s) ──────
  let incomingTimer = 0;
  function cancelIncoming() {
    clearTimeout(incomingTimer);
    incomingTimer = 0;
    view.incoming(null);
  }
  $('auto-demo').addEventListener('click', () => {
    if (game?.isRunning) stopBoss();
    cancelIncoming();
    addBot(incomingAnnouncement(null).replace('1 minuto', '10 segundos'));
    view.incoming(Date.now() + 10_000);
    incomingTimer = window.setTimeout(() => startBoss('random'), 10_000);
  });

  // loop: mesmo ritmo do servidor (100 ms)
  setInterval(() => {
    if (!game) return;
    announce(game.update());
    if (game.dirty) {
      view.render(game.snapshot());
      syncButtons();
      updateYou();
    }
  }, 100);

  // ─── Você no chat ──────────────────────────────────────────
  const ME = { id: 'voce', name: 'Você', color: '#ff4b55' };
  let seq = 0;

  function say(text: string) {
    const clean = text.trim().slice(0, 200);
    if (!clean) return;
    const isSub = $<HTMLInputElement>('is-sub').checked;
    addLine(ME.name, ME.color, clean, isSub, true);
    if ((!game || !game.isRunning) && /^!(atk|ult|ataque|especial)/i.test(clean)) {
      addBot('Nenhum boss na arena agora. Clique em Invocar boss ou digite !boss iniciar.');
    }
    handleChat({
      id: `me-${++seq}`,
      platform: 'twitch',
      channelId: 'demo',
      text: clean,
      ts: Date.now(),
      // na prévia você é o streamer: pode usar !boss iniciar / !boss parar
      user: { id: ME.id, login: 'voce', displayName: ME.name, color: ME.color, isSub, isMod: false, isVip: false, isBroadcaster: true },
    });
    updateYou();
  }

  function updateYou() {
    const el = $('you');
    if (!game) return;
    const all = game.leaderboard(100000);
    const pos = all.findIndex((p) => p.name === ME.name && p.platform === 'twitch');
    if (pos < 0) {
      el.innerHTML = 'Seu herói ainda não atacou. Digite <kbd>!atk</kbd> no chat.';
      return;
    }
    const me = all[pos];
    el.innerHTML = `Seu herói: <b>${nf.format(me.damage)} de dano</b> em ${me.hits} golpe${me.hits === 1 ? '' : 's'} · <b>${pos + 1}º</b> de ${nf.format(all.length)}`;
  }

  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('chat-text');
    say(input.value);
    input.value = '';
  });
  document.querySelectorAll<HTMLButtonElement>('[data-say]').forEach((b) =>
    b.addEventListener('click', () => say(b.dataset.say!)),
  );

  // ─── Feed do chat ──────────────────────────────────────────
  const feed = $('feed');
  const MAX_LINES = 80;
  let pendingSim: { name: string; color: string; text: string; sub: boolean }[] = [];

  function append(li: HTMLLIElement) {
    const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60;
    feed.appendChild(li);
    while (feed.children.length > MAX_LINES) feed.firstElementChild?.remove();
    if (nearBottom || li.classList.contains('me') || li.classList.contains('bot')) feed.scrollTop = feed.scrollHeight;
  }

  function addLine(name: string, color: string, text: string, sub: boolean, me = false) {
    const li = document.createElement('li');
    if (me) li.className = 'me';
    const isCmd = text.startsWith('!');
    li.innerHTML = `${sub ? '<i class="sub" title="Assinante"></i>' : ''}<span class="n" style="color:${color}">${esc(name)}</span>: <span class="${isCmd ? 'cmd' : ''}">${esc(text)}</span>`;
    append(li);
  }

  function addBot(text: string) {
    const li = document.createElement('li');
    li.className = 'bot';
    li.innerHTML = `<span class="badge">BOT</span><span class="n">ClipeiBot</span>: ${esc(text)}`;
    append(li);
  }

  // o chat simulado pode mandar centenas de mensagens/s; o feed mostra no máximo ~12/s
  setInterval(() => {
    const batch = pendingSim.splice(0, 2);
    pendingSim = pendingSim.slice(-6);
    for (const m of batch) addLine(m.name, m.color, m.text, m.sub);
  }, 160);

  // ─── Chat simulado ─────────────────────────────────────────
  const PREFIX = ['Dark', 'Neo', 'Mega', 'Turbo', 'Pixel', 'Shadow', 'Cyber', 'Lord', 'Mestre', 'Brabo', 'Lobo', 'Ninja', 'Zika', 'Mago', 'Fênix', 'Tigrão', 'Bug', 'Lag'];
  const SUFFIX = ['Gamer', 'BR', 'Snipa', 'Killer', 'Zueiro', 'TTV', 'Craft', 'Clutch', 'GG', 'Noob', 'Rush', 'Combo', 'Tryhard', 'Mito', 'Lenda', 'Speed'];
  const COLORS = ['#FF4B55', '#FFFFFF', '#FFC83D', '#2FE38A', '#3FA9FF', '#FF7A1A', '#C77DFF', '#9EF01A', '#5CE1E6', '#FF8FAB'];
  const CHATTER = ['kkkkkkk', 'GG', 'bora chat', 'vai morrer', 'que boss forte', 'Pog', 'aaaaaa', 'CADÊ O DANO', 'EZ', 'tô chegando', 'ataca ataca'];
  const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

  const sim = {
    running: false,
    viewers: [] as { id: string; name: string; color: string; sub: boolean }[],
    rate: 8,
    carry: 0,
    timer: 0,
    setViewers(n: number) {
      while (this.viewers.length < n) {
        const i = this.viewers.length;
        const name = `${pick(PREFIX)}${pick(SUFFIX)}${Math.random() < 0.5 ? Math.floor(Math.random() * 99) : ''}`;
        this.viewers.push({ id: `sim-${i}`, name, color: pick(COLORS), sub: Math.random() < 0.2 });
      }
      this.viewers.length = n;
      $('viewers').textContent = `${nf.format(n)} assistindo`;
    },
    start() {
      if (this.running) return;
      this.running = true;
      this.timer = window.setInterval(() => this.step(), 100);
    },
    stop() {
      this.running = false;
      clearInterval(this.timer);
    },
    step() {
      this.carry += this.rate / 10;
      let n = Math.floor(this.carry);
      this.carry -= n;
      const fighting = !!game?.isRunning;
      while (n-- > 0) {
        const v = pick(this.viewers);
        const r = Math.random();
        const text = fighting ? (r < 0.84 ? '!atk' : r < 0.87 ? '!ult' : pick(CHATTER)) : r < 0.15 ? pick(CHATTER) : '';
        if (!text) continue;
        pendingSim.push({ name: v.name, color: v.color, text, sub: v.sub });
        handleChat({
          id: `sim-${++seq}`,
          platform: 'simulator',
          channelId: 'demo',
          text,
          ts: Date.now(),
          user: { id: v.id, login: v.name.toLowerCase(), displayName: v.name, color: v.color, isSub: v.sub, isMod: false, isVip: false, isBroadcaster: false },
        });
      }
    },
  };

  const viewersInput = $<HTMLInputElement>('sim-viewers');
  const rateInput = $<HTMLInputElement>('sim-rate');
  const syncSim = () => {
    sim.setViewers(Number(viewersInput.value));
    sim.rate = Number(rateInput.value);
    $('out-viewers').textContent = nf.format(Number(viewersInput.value));
    $('out-rate').textContent = `${rateInput.value}/s`;
  };
  viewersInput.addEventListener('input', syncSim);
  rateInput.addEventListener('input', syncSim);
  $<HTMLInputElement>('sim-on').addEventListener('change', (e) => {
    if ((e.target as HTMLInputElement).checked) sim.start();
    else sim.stop();
  });
  syncSim();

  // ─── Controles do streamer ─────────────────────────────────
  const picker = $('picker');
  picker.innerHTML =
    BOSS_SKIN_IDS.map((id) => {
      const s = BOSS_SKINS[id];
      return `<button type="button" class="boss-opt" role="radio" aria-checked="${id === skin}" data-skin="${id}" style="--sky:${bossDef(id).theme.sky}">
        <canvas width="120" height="96" aria-hidden="true"></canvas><b>${esc(s.name)}</b><small>${esc(s.title)}</small></button>`;
    }).join('') +
    `<button type="button" class="boss-opt" role="radio" aria-checked="false" data-skin="random" style="--sky:#2a2a30">
       <canvas width="120" height="96" aria-hidden="true" data-dice></canvas><b>Surpresa</b><small>Sorteia um boss diferente</small></button>`;

  picker.querySelectorAll<HTMLButtonElement>('.boss-opt').forEach((btn) => {
    const c = btn.querySelector('canvas')!;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    if (btn.dataset.skin === 'random') {
      drawDice(ctx, c.width, c.height);
    } else {
      const sp = bossSprite(btn.dataset.skin as BossSkinId, 1);
      const sc = Math.floor(Math.min((c.width - 10) / sp.width, (c.height - 6) / sp.height));
      ctx.drawImage(sp, Math.round((c.width - sp.width * sc) / 2), c.height - sp.height * sc - 2, sp.width * sc, sp.height * sc);
    }
    btn.addEventListener('click', () => {
      skin = btn.dataset.skin as BossSkinId | 'random';
      picker.querySelectorAll('.boss-opt').forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
    });
  });

  function drawDice(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const s = 6;
    const size = 11 * s;
    const x = Math.round((w - size) / 2);
    const y = Math.round((h - size) / 2);
    ctx.fillStyle = '#000';
    ctx.fillRect(x - s, y - s, size + 2 * s, size + 2 * s);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#ff1f2d';
    for (const [dx, dy] of [[2, 2], [7.5, 2], [4.75, 4.75], [2, 7.5], [7.5, 7.5]]) ctx.fillRect(x + dx * s, y + dy * s, 1.5 * s, 1.5 * s);
  }

  function optionButtons<T>(el: HTMLElement, items: T[], label: (i: T) => string, isOn: (i: T) => boolean, onPick: (i: T) => void) {
    el.innerHTML = items.map((it, i) => `<button type="button" class="opt-btn" data-i="${i}" aria-pressed="${isOn(it)}">${label(it)}</button>`).join('');
    el.querySelectorAll<HTMLButtonElement>('.opt-btn').forEach((b) =>
      b.addEventListener('click', () => {
        onPick(items[Number(b.dataset.i)]);
        el.querySelectorAll('.opt-btn').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      }),
    );
  }
  optionButtons($('hp-opts'), HP_OPTIONS, (o) => `${o.label}<small>${o.hint}</small>`, (o) => o.hp === hp, (o) => (hp = o.hp));
  optionButtons($('time-opts'), TIME_OPTIONS, (o) => o.label, (o) => o.sec === duration, (o) => (duration = o.sec));

  $('start').addEventListener('click', () => startBoss());
  $('stop').addEventListener('click', stopBoss);

  function syncButtons() {
    const running = !!game?.isRunning;
    $('start').textContent = running ? 'Reiniciar boss' : 'Invocar boss';
    $<HTMLButtonElement>('stop').disabled = !running;
  }

  // ─── Fundo da prévia: sobre um jogo × escuro ────────────────
  document.querySelectorAll<HTMLButtonElement>('[data-bg]').forEach((b) =>
    b.addEventListener('click', () => {
      $('screen').classList.toggle('dark', b.dataset.bg === 'dark');
      document.querySelectorAll('[data-bg]').forEach((x) => x.classList.toggle('is-on', x === b));
    }),
  );

  // ─── Visual na live (o mesmo do painel do streamer) ────────
  const POS: { v: ArenaPosition; label: string }[] = [
    { v: 'left', label: 'Esquerda' },
    { v: 'center', label: 'Centro' },
    { v: 'right', label: 'Direita' },
  ];
  optionButtons($('pos-opts'), POS, (o) => o.label, (o) => o.v === settings.layout.position, (o) => updateSettings({ layout: { position: o.v } }));
  optionButtons(
    $('hp-pos-opts'),
    [
      { v: 'boss', label: 'Acima do boss' },
      { v: 'top', label: 'Topo da tela' },
    ],
    (o) => o.label,
    (o) => o.v === settings.layout.hpBar,
    (o) => updateSettings({ layout: { hpBar: o.v } }),
  );
  const sizeInput = $<HTMLInputElement>('size');
  const syncSize = () => {
    $('out-size').textContent = `${sizeInput.value}%`;
    updateSettings({ layout: { size: Number(sizeInput.value) } });
  };
  sizeInput.value = String(settings.layout.size);
  sizeInput.addEventListener('input', syncSize);
  syncSize();
  $<HTMLInputElement>('show-rank').addEventListener('change', (e) =>
    updateSettings({ layout: { showRanking: (e.target as HTMLInputElement).checked } }),
  );
  $<HTMLInputElement>('show-floor').addEventListener('change', (e) =>
    updateSettings({ layout: { showFloor: (e.target as HTMLInputElement).checked } }),
  );

  // abre já com uma luta rolando
  addBot('Bem-vindo à prévia! O boss já está na arena. Digite !atk aqui no chat para seu herói entrar na luta.');
  addBot('Aqui você é o streamer: teste também !boss brasa, !boss surpresa e !boss parar.');
  startBoss();
}
