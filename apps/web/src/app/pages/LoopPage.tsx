import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LOOP_BLOCK_TEXT, LOOP_GAME_INFO, LOOP_GAMES, type LoopConfig, type LoopGameId } from '@clipei/shared';
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
};
const PAGES: Record<LoopGameId, string> = {
  boss: '/app/jogos/boss',
  race: '/app/jogos/corrida',
  duel: '/app/jogos/duelo',
  royale: '/app/jogos/royale',
  kite: '/app/jogos/pipa',
  penalty: '/app/jogos/penaltis',
  defense: '/app/jogos/defesa',
};

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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

  let headline = 'Desligado';
  let detail = 'Ligue para os minigames se revezarem sozinhos.';
  if (cfg.enabled) {
    if (playing) {
      headline = `Rolando: ${LOOP_GAME_INFO[playing as LoopGameId]?.name ?? 'minigame'}`;
      detail = loop?.playing ? 'Aberto pelo loop. Quando acabar, começa a pausa.' : 'Você abriu esse. O loop espera ele terminar.';
    } else if (loop?.next && loop.at) {
      headline = `${LOOP_GAME_INFO[loop.next].emoji} ${LOOP_GAME_INFO[loop.next].name} em ${clock(loop.at - now)}`;
      detail = 'Próximo do rodízio.';
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
            <Link to="/app/jogos">Minigames</Link> / Modo Loop
          </p>
          <h1>
            Modo <span>Loop</span>
          </h1>
          <p>Vai sair e deixar a live aberta? Os minigames se revezam sozinhos: abre um, espera terminar, faz uma pausa e chama o próximo. A pescaria segue rodando entre um e outro.</p>
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
          <Card title="Rodízio automático" right={<Switch label="Modo Loop ligado" checked={cfg.enabled} onChange={(v) => set({ enabled: v })} />}>
            <p className="muted" style={{ marginTop: 0 }}>
              {cfg.enabled
                ? 'Ligado. Pode sair tranquilo: o loop pausa sozinho se a live cair, o OBS fechar ou o chat esvaziar, e volta quando tudo voltar.'
                : 'Desligado. Seus mods também ligam pelo chat com !loop ligar.'}
            </p>
            {cfg.enabled && (
              <div className="actions">
                <button className="btn primary" disabled={!!playing || !cfg.games.length} onClick={skip}>
                  ⏭ Abrir o próximo agora
                </button>
              </div>
            )}
          </Card>

          <Card title="Jogos do rodízio" subtitle={cfg.order === 'sequence' ? 'Marque os jogos e arrume a ordem com as setas' : 'Marque os jogos: o loop sorteia sem repetir o último'}>
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
          </Card>
        </div>

        <div className="col">
          <Card title="Tempo">
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
              <small className="muted">Chat parado? O loop espera em vez de abrir jogo para ninguém.</small>
            </div>
            <Check checked={cfg.onlyLive} onChange={(v) => set({ onlyLive: v })}>
              Só com a live no ar
            </Check>
            <p className="muted foot-note">Com o OBS fechado (overlay desconectado) o loop sempre espera.</p>
          </Card>

          <Card title="Avisos">
            <Check checked={cfg.announce} onChange={(v) => set({ announce: v })}>
              Bot avisa no chat qual é o próximo jogo
            </Check>
            <Check checked={cfg.teaser} onChange={(v) => set({ teaser: v })}>
              Mostrar no OBS a contagem para o próximo jogo
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
                  Liga o rodízio (<kbd>!loop desligar</kbd> desliga).
                </p>
              </div>
              <div className="cmd">
                <kbd>!loop pular</kbd>
                <p>Abre o próximo jogo sem esperar a pausa.</p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
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
