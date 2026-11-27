import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BOSS_SKINS, BOSS_SKIN_IDS, LOOP_BLOCK_TEXT, LOOP_GAME_INFO, LOOP_GAMES, LOOP_TIMER_INTERVALS, type LoopConfig, type LoopGameId, type LoopSnapshot } from '@clipei/shared';
import { api, nf } from '../api.ts';
import { Card, Check, Options, Switch } from '../components/ui.tsx';
import { useApp } from '../state.tsx';

/** O que cada jogo precisa para rodar sem o streamer (aparece na lista do rodízio). */
const NEEDS: Record<LoopGameId, string> = {
  boss: 'Roda com qualquer chat: a vida do boss se ajusta a quem está falando.',
  race: 'Com "completar com bots" ligado, a pista nunca fica vazia.',
  duel: 'Precisa de 2 pessoas do chat. Se ninguém entrar, pula para o próximo.',
  royale: 'Com "completar com bots" ligado, sempre tem partida.',
  kite: 'Com "completar com bots" ligado, sempre tem pipa no céu.',
  penalty: 'Precisa de gente escolhendo time com !a e !b.',
  defense: 'Com "completar com bots" ligado, sempre tem torre na estrada.',
  termo: 'Roda com qualquer chat: uma pessoa chutando já dá jogo.',
};
const PAGES: Record<LoopGameId, string> = {
  boss: '/app/jogos/boss',
  race: '/app/jogos/corrida',
  duel: '/app/jogos/duelo',
  royale: '/app/jogos/royale',
  kite: '/app/jogos/pipa',
  penalty: '/app/jogos/penaltis',
  defense: '/app/jogos/defesa',
  termo: '/app/jogos/termo',
};

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
const hour = (t: number) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function LoopPage() {
  const { me, loop, status, clockOffset, toast, saveSettings } = useApp();
  const cfg = me!.settings.loop;
  const set = (patch: Partial<LoopConfig>) => saveSettings({ loop: patch });
  const now = useNow(!!loop?.at) + clockOffset;
  const playing = status?.game ?? null;

  const timer = cfg.mode === 'timer';
  let headline = 'Desligado';
  let detail = 'Escolha o modo e ligue: os minigames abrem sozinhos.';
  if (cfg.enabled) {
    if (playing) {
      headline = `Rolando: ${LOOP_GAME_INFO[playing as LoopGameId]?.name ?? 'minigame'}`;
      detail = loop?.playing
        ? `Aberto automaticamente. Quando acabar, ${timer ? 'a contagem recomeça' : 'começa a pausa'}.`
        : `Você abriu esse. ${timer ? 'A contagem recomeça quando ele terminar.' : 'O loop espera ele terminar.'}`;
    } else if (loop?.next && loop.at) {
      headline = `${LOOP_GAME_INFO[loop.next].emoji} ${LOOP_GAME_INFO[loop.next].name} em ${clock(loop.at - now)}`;
      detail = timer
        ? loop.warnAt && now < loop.warnAt
          ? 'O chat e o OBS recebem o aviso 1 minuto antes.'
          : 'Aviso no chat e no OBS: falta menos de 1 minuto!'
        : 'Próximo do rodízio.';
    } else if (loop?.blocked) {
      headline = 'Esperando';
      detail = LOOP_BLOCK_TEXT[loop.blocked];
    } else {
      headline = 'Preparando…';
      detail = 'Escolhendo o próximo jogo.';
    }
  }

  const skip = async () => {
    try {
      await api('/api/loop/skip', {});
      toast('Abrindo o próximo jogo! ⏭', 'ok');
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  };

  return (
    <>
      <section className="hero">
        <div>
          <p className="crumbs">
            <Link to="/app/jogos">Minigames</Link> / Automático
          </p>
          <h1>
            Minigames <span>automáticos</span>
          </h1>
          <p>Os minigames abrem sozinhos: de tempos em tempos enquanto você joga, ou em rodízio contínuo quando você sai e deixa a live aberta. A pescaria segue rodando entre um e outro.</p>
        </div>
        <div className="hero-live loop-hero">
          <span className={`pill ${cfg.enabled ? 'live' : ''}`}>{cfg.enabled ? (loop?.blocked && !playing ? 'Esperando' : 'Ligado') : 'Desligado'}</span>
          <b>{headline}</b>
          <small>{detail}</small>
          {cfg.enabled && loop && (
            <small className="muted">
              {nf.format(loop.rounds)} {loop.rounds === 1 ? 'jogo' : 'jogos'}
              {loop.since ? ` desde ${hour(loop.since)}` : ''}
              {loop.endsAt ? ` · desliga às ${hour(loop.endsAt)}` : ''}
            </small>
          )}
        </div>
      </section>

      <div className="grid">
        <div className="col">
          <Card title="Minigames automáticos" right={<Switch label="Minigames automáticos ligados" checked={cfg.enabled} onChange={(v) => set({ enabled: v })} />}>
            <div className="auto-modes" role="radiogroup" aria-label="Modo">
              <button role="radio" aria-checked={timer} className={timer ? 'on' : ''} onClick={() => set({ mode: 'timer' })}>
                <span aria-hidden="true">⏰</span>
                <b>Temporizador</b>
                <small>Um minigame de tempos em tempos, enquanto você joga.</small>
              </button>
              <button role="radio" aria-checked={!timer} className={!timer ? 'on' : ''} onClick={() => set({ mode: 'loop' })}>
                <span aria-hidden="true">🔁</span>
                <b>Modo Loop</b>
                <small>Rodízio contínuo, para quando você sai e deixa a live aberta.</small>
              </button>
            </div>
            <p className="muted">
              {cfg.enabled
                ? 'Ligado. Espera sozinho se a live cair, o OBS fechar ou o chat esvaziar, e volta quando tudo voltar.'
                : 'Desligado. Seus mods também ligam pelo chat com !loop ligar.'}
            </p>
            {cfg.enabled && !playing && loop?.blocked && <BlockFix block={loop.blocked} cfg={cfg} set={set} />}
            {cfg.enabled && (
              <div className="actions">
                <button className="btn primary" disabled={!!playing || !cfg.games.length} onClick={skip}>
                  ⏭ Abrir {loop?.next ? LOOP_GAME_INFO[loop.next].name : 'o próximo'} agora
                </button>
              </div>
            )}
            {cfg.enabled && timer && !playing && loop?.at && !loop.blocked && (
              <p className="muted foot-note">
                No Temporizador o primeiro minigame também espera o intervalo inteiro ({cfg.intervalMin} min). Para começar já, use o botão acima.
              </p>
            )}
          </Card>

          <Card title={timer ? 'Quais minigames aparecem' : 'Jogos do rodízio'} subtitle={cfg.order === 'sequence' ? 'Marque os jogos e arrume a ordem com as setas' : 'Marque os jogos: abre um diferente a cada vez, sem repetir o último'}>
            <div className="field">
              <Options
                tight
                name="lorder"
                value={cfg.order}
                onChange={(v) => set({ order: v })}
                options={[
                  { value: 'sequence' as const, label: '🔢 Em sequência' },
                  { value: 'random' as const, label: '🎲 Aleatório' },
                ]}
              />
            </div>
            <GameList cfg={cfg} set={set} next={cfg.enabled ? (loop?.next ?? null) : null} />
            {cfg.games.includes('boss') && (
              <div className="field" style={{ marginTop: 12 }}>
                <label htmlFor="loop-skin">Qual boss aparece na vez do Boss</label>
                <select id="loop-skin" className="input" value={cfg.bossSkin} onChange={(e) => set({ bossSkin: e.target.value as LoopConfig['bossSkin'] })}>
                  <option value="random">🎲 Surpresa (um diferente a cada vez)</option>
                  {BOSS_SKIN_IDS.map((id) => (
                    <option key={id} value={id}>
                      {BOSS_SKINS[id].name}: {BOSS_SKINS[id].title}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </Card>
        </div>

        <div className="col">
          <Card title="Tempo">
            {timer ? (
              <IntervalField cfg={cfg} set={set} />
            ) : (
              <div className="field">
                <span className="field-label">Pausa entre um jogo e outro</span>
                <Options
                  tight
                  name="lgap"
                  value={cfg.gapSec}
                  onChange={(v) => set({ gapSec: v })}
                  options={[30, 60, 120, 300, 600].map((v) => ({ value: v, label: v < 60 ? `${v}s` : `${v / 60} min` }))}
                />
                <small className="muted">Dá tempo de ver o resultado, conversar no chat e pescar um pouco.</small>
              </div>
            )}
            <div className="field">
              <span className="field-label">Desligar sozinho depois de</span>
              <Options
                tight
                name="lmax"
                value={cfg.maxHours}
                onChange={(v) => set({ maxHours: v })}
                options={[0, 1, 2, 4, 8].map((v) => ({ value: v, label: v ? `${v}h` : 'Nunca' }))}
              />
            </div>
          </Card>

          <Card title="Quando rodar">
            <div className="field">
              <span className="field-label">Pessoas falando no chat (últimos 10 min)</span>
              <Options
                tight
                name="lmin"
                value={cfg.minChatters}
                onChange={(v) => set({ minChatters: v })}
                options={[0, 1, 3, 5, 10].map((v) => ({ value: v, label: v ? `${v}+` : 'Sempre' }))}
              />
              <small className="muted">Chat parado? Espera em vez de abrir jogo para ninguém.</small>
            </div>
            <Check checked={cfg.onlyLive} onChange={(v) => set({ onlyLive: v })}>
              Só com a live no ar
            </Check>
            <p className="muted foot-note">Com o OBS fechado (overlay desconectado) sempre espera.</p>
          </Card>

          <Card title="Avisos">
            <Check checked={cfg.announce} onChange={(v) => set({ announce: v })}>
              Bot avisa no chat qual é o próximo jogo{timer ? ' (1 minuto antes)' : ''}
            </Check>
            <Check checked={cfg.teaser} onChange={(v) => set({ teaser: v })}>
              Mostrar no OBS a contagem para o próximo jogo{timer ? ' (no último minuto)' : ''}
            </Check>
            <div className="loop-teaser-preview" aria-hidden="true">
              <span>🔁 Próximo minigame</span>
              <b>🏁 Corrida</b>
              <i>0:42</i>
            </div>
          </Card>

          <Card title="Para seus mods">
            <div className="cmds">
              <div className="cmd">
                <kbd>!loop ligar</kbd>
                <p>
                  Liga os minigames automáticos no modo escolhido aqui (<kbd>!loop desligar</kbd> desliga).
                </p>
              </div>
              <div className="cmd">
                <kbd>!loop pular</kbd>
                <p>Abre o próximo jogo agora, sem esperar.</p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

/** Por que o automático está esperando, e o atalho para resolver. */
function BlockFix({ block, cfg, set }: { block: NonNullable<LoopSnapshot['blocked']>; cfg: LoopConfig; set: (p: Partial<LoopConfig>) => void }) {
  const info: Record<typeof block, { text: string; action?: { label: string; run: () => void } | { label: string; to: string } }> = {
    offline: {
      text: 'Sua live não está no ar, e o automático está configurado para rodar só com a live ligada.',
      action: { label: 'Rodar mesmo fora do ar', run: () => set({ onlyLive: false }) },
    },
    obs: {
      text: 'Nenhum OBS conectado. Abra a URL do overlay no OBS (ou numa aba do navegador, para testar).',
      action: { label: 'Pegar a URL do overlay', to: '/app/overlay' },
    },
    chat: {
      text: `Menos de ${cfg.minChatters} ${cfg.minChatters === 1 ? 'pessoa falou' : 'pessoas falaram'} no chat nos últimos 10 minutos.`,
      action: { label: 'Rodar com qualquer chat', run: () => set({ minChatters: 0 }) },
    },
    plan: { text: 'Seu plano não está ativo.', action: { label: 'Ver planos', to: '/app/plano' } },
    empty: { text: 'Nenhum minigame marcado. Marque pelo menos um na lista.' },
  };
  const { text, action } = info[block];
  return (
    <div className="loop-block" role="status">
      <span aria-hidden="true">⏸</span>
      <p>
        <b>Esperando:</b> {text}
      </p>
      {action &&
        ('to' in action ? (
          <Link className="btn sm" to={action.to}>
            {action.label}
          </Link>
        ) : (
          <button className="btn sm" onClick={action.run}>
            {action.label}
          </button>
        ))}
    </div>
  );
}

function IntervalField({ cfg, set }: { cfg: LoopConfig; set: (p: Partial<LoopConfig>) => void }) {
  const preset = (LOOP_TIMER_INTERVALS as readonly number[]).includes(cfg.intervalMin);
  const [custom, setCustom] = useState(!preset);
  return (
    <div className="field">
      <span className="field-label">Um minigame a cada</span>
      <Options
        tight
        name="linterval"
        value={custom ? -1 : cfg.intervalMin}
        onChange={(v) => {
          if (v === -1) setCustom(true);
          else {
            setCustom(false);
            set({ intervalMin: v });
          }
        }}
        options={[...LOOP_TIMER_INTERVALS.map((m) => ({ value: m as number, label: m < 60 ? `${m} min` : `${m / 60} h`.replace('.5', ',5') })), { value: -1, label: 'Outro' }]}
      />
      {custom && (
        <div className="inline-input">
          <input
            className="input"
            type="number"
            min={5}
            max={720}
            step={5}
            defaultValue={cfg.intervalMin}
            onBlur={(e) => set({ intervalMin: Math.min(720, Math.max(5, Number(e.target.value) || 30)) })}
          />
          <span>minutos (de 5 a 720)</span>
        </div>
      )}
      <small className="muted">Conta a partir do fim do último minigame, até os que você abre na mão.</small>
    </div>
  );
}

function GameList({ cfg, set, next }: { cfg: LoopConfig; set: (p: Partial<LoopConfig>) => void; next: LoopGameId | null }) {
  // marcados primeiro (na ordem do rodízio), depois os desmarcados
  const rows = [...cfg.games, ...LOOP_GAMES.filter((g) => !cfg.games.includes(g))];
  const toggle = (g: LoopGameId, on: boolean) => set({ games: on ? [...cfg.games, g] : cfg.games.filter((x) => x !== g) });
  const move = (g: LoopGameId, dir: -1 | 1) => {
    const list = [...cfg.games];
    const i = list.indexOf(g);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    set({ games: list });
  };
  return (
    <ul className="loop-list">
      {rows.map((g) => {
        const on = cfg.games.includes(g);
        const pos = cfg.games.indexOf(g);
        const info = LOOP_GAME_INFO[g];
        return (
          <li key={g} className={`${on ? 'is-on' : ''} ${next === g ? 'is-next' : ''}`}>
            <label className="loop-pick">
              <input type="checkbox" checked={on} onChange={(e) => toggle(g, e.target.checked)} />
              <span className="loop-emoji" aria-hidden="true">
                {info.emoji}
              </span>
              <span className="loop-name">
                <b>
                  {on && cfg.order === 'sequence' && <em>{pos + 1}º</em>}
                  {info.name}
                  {next === g && <span className="pill live">próximo</span>}
                </b>
                <small>{NEEDS[g]}</small>
              </span>
            </label>
            <span className="loop-tools">
              {on && cfg.order === 'sequence' && (
                <>
                  <button className="icon-btn" aria-label={`Subir ${info.name}`} disabled={pos === 0} onClick={() => move(g, -1)}>
                    ↑
                  </button>
                  <button className="icon-btn" aria-label={`Descer ${info.name}`} disabled={pos === cfg.games.length - 1} onClick={() => move(g, 1)}>
                    ↓
                  </button>
                </>
              )}
              <Link to={PAGES[g]} className="loop-cfg" title={`Configurar ${info.name}`}>
                Ajustes
              </Link>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
