import { Link, useSearchParams } from 'react-router-dom';
import { DUEL_SCENES, DUEL_SCENE_IDS, type DuelConfig, type DuelSceneId, type DuelSnapshot } from '@clipei/shared';
import { api, nf } from '../api.ts';
import { Card, Check, Options } from '../components/ui.tsx';
import { useApp, useTick } from '../state.tsx';

const TABS = [
  { id: 'duelo', label: 'Duelo' },
  { id: 'comandos', label: 'Comandos e apoios' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const STATUS_LABEL: Record<DuelSnapshot['status'], string> = {
  idle: 'Parado',
  lobby: 'Esperando duelistas',
  intro: 'Encarada',
  countdown: 'Contagem',
  wait: 'Silêncio…',
  fire: 'FOGO!',
  round: 'Fim da rodada',
  finished: 'Terminou',
  stopped: 'Encerrado',
};

/** Cores de cada cenário para a miniatura. */
const SCENE_ART: Record<DuelSceneId, { sky: string; ground: string; sun: string }> = {
  saloon: { sky: 'linear-gradient(180deg,#5fb4ea,#f6dca0)', ground: '#d9b077', sun: '#fff3c4' },
  deserto: { sky: 'linear-gradient(180deg,#3b1d5e,#e0603a 60%,#ffc36b)', ground: '#c4753e', sun: '#ffdf7e' },
  fantasma: { sky: 'linear-gradient(180deg,#05070f,#1b2340)', ground: '#3a3742', sun: '#f1edd8' },
};

export const isDuelActive = (d: DuelSnapshot | null) => !!d && !['idle', 'finished', 'stopped'].includes(d.status);

export function DuelPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('aba')) ? params.get('aba') : 'duelo') as Tab;
  const { duel } = useApp();
  const active = isDuelActive(duel);

  return (
    <>
      <section className="hero">
        <div>
          <p className="crumbs">
            <Link to="/app/jogos">Minigames</Link> / Duelo
          </p>
          <h1>
            Du<span>elo</span>
          </h1>
          <p>X1 no velho oeste: os dois primeiros que digitarem !duelo se enfrentam. Reflexo com uma pitada de sorte.</p>
        </div>
        {active && duel && (
          <div className="hero-live">
            <span className="pill live">Ao vivo</span>
            <b>{duel.players.length === 2 ? `${duel.players[0].name} x ${duel.players[1].name}` : 'Duelo aberto'}</b>
            <small>{STATUS_LABEL[duel.status]}</small>
          </div>
        )}
      </section>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => setParams({ aba: t.id })}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'duelo' ? <DuelTab /> : <CommandsTab />}
    </>
  );
}

function DuelTab() {
  const { me, duel, status, toast, saveSettings } = useApp();
  const cfg = me!.settings.duel;
  const active = isDuelActive(duel);
  const busy = status?.game && status.game !== 'duel' ? status.game : null;
  const set = (patch: Partial<DuelConfig>) => saveSettings({ duel: patch });

  async function open() {
    try {
      await api('/api/duel/start', cfg);
      toast('Duelo aberto! Os dois primeiros que digitarem !duelo se enfrentam 🤠', 'ok');
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  }

  return (
    <div className="grid">
      <div className="col">
        {active && duel ? <LiveCard duel={duel} /> : duel?.status === 'finished' && <ResultCard duel={duel} />}
        <Card title="Cenário" subtitle="Aparece completo no modo tela cheia">
          <div className="boss-picker scene-picker" role="radiogroup" aria-label="Cenário">
            {DUEL_SCENE_IDS.map((id) => (
              <label className="boss-opt" key={id}>
                <input type="radio" name="scene" checked={cfg.scene === id} onChange={() => set({ scene: id })} />
                <span>
                  <i className="scene-thumb" style={{ background: SCENE_ART[id].sky }} aria-hidden="true">
                    <em style={{ background: SCENE_ART[id].sun }} />
                    <s style={{ background: SCENE_ART[id].ground }} />
                  </i>
                  <b>{DUEL_SCENES[id].name}</b>
                  <small>{DUEL_SCENES[id].title}</small>
                </span>
              </label>
            ))}
          </div>
        </Card>
      </div>
      <div className="col">
        <Card title="Regras do duelo">
          <div className="field">
            <span className="field-label">Formato</span>
            <Options
              name="bestof"
              value={cfg.bestOf}
              onChange={(v) => set({ bestOf: v })}
              options={[
                { value: 1 as const, label: 'X1', hint: 'Um tiro certeiro decide' },
                { value: 3 as const, label: 'Melhor de 3', hint: 'Quem vencer 2 rodadas' },
              ]}
            />
          </div>
          <div className="field">
            <span className="field-label">Tempo para aparecerem os duelistas</span>
            <Options tight name="join" value={cfg.joinSec} onChange={(v) => set({ joinSec: v })} options={[30, 60, 90, 120].map((v) => ({ value: v, label: `${v}s` }))} />
          </div>
          <Check checked={cfg.cheer} onChange={(v) => set({ cheer: v })}>
            Torcida do chat (!1 / !2): o lado com mais torcida ganha até +10% de mira
          </Check>
          {busy && <p className="chat-error">{busy === 'boss' ? 'Tem um boss na arena.' : 'Tem uma corrida rolando.'} Um jogo por vez: espere terminar para abrir o duelo.</p>}
          <div className="actions">
            <button className="btn primary lg" disabled={active || !!busy} onClick={open}>
              🤠 Abrir duelo
            </button>
            <button
              className="btn danger lg"
              disabled={!active}
              onClick={async () => {
                await api('/api/duel/stop', {});
                toast('Duelo encerrado.');
              }}
            >
              Encerrar
            </button>
          </div>
          <p className="muted foot-note">
            Seus mods também abrem com <kbd>!duelo iniciar</kbd>. Para o duelo virar a tela principal, use o modo tela cheia em <Link to="/app/overlay">Overlay (OBS)</Link>.
          </p>
        </Card>
      </div>
    </div>
  );
}

function LiveCard({ duel }: { duel: DuelSnapshot }) {
  const { clockOffset } = useApp();
  useTick(500);
  const [a, b] = duel.players;
  const left = duel.phaseEndsAt ? Math.max(0, Math.ceil((duel.phaseEndsAt - (Date.now() + clockOffset)) / 1000)) : null;
  const items = (p: DuelSnapshot['players'][number]) => [p.aim && '🎯', p.vest && '🦺', p.gold && '✨', p.jammed && '🔒'].filter(Boolean).join(' ');
  return (
    <Card title={STATUS_LABEL[duel.status]} subtitle={duel.bestOf === 3 ? `Melhor de 3 · rodada ${Math.max(1, duel.round)}` : 'X1'} right={<span className="pill live">Ao vivo</span>}>
      <div className="duel-live">
        {[a, b].map((p, i) => (
          <div key={i} className="duelist">
            {p ? (
              <>
                <i style={{ background: p.color }} />
                <b>{p.name}</b>
                <small>{items(p) || ' '}</small>
              </>
            ) : (
              <>
                <i />
                <b className="muted">esperando…</b>
                <small>!duelo</small>
              </>
            )}
            <em>{duel.score[i]}</em>
          </div>
        ))}
      </div>
      {duel.cheerOn && b && (
        <p className="muted" style={{ marginTop: 10 }}>
          Torcida: {nf.format(duel.cheers[0])} × {nf.format(duel.cheers[1])}
        </p>
      )}
      {duel.status === 'lobby' && left !== null && <p className="muted">Fecha em {left}s se ninguém aceitar.</p>}
    </Card>
  );
}

function ResultCard({ duel }: { duel: DuelSnapshot }) {
  const w = duel.winner;
  return (
    <Card title="Último duelo" subtitle={duel.players.map((p) => p.name).join(' x ')}>
      <p style={{ margin: 0, fontWeight: 700 }}>
        {w === null ? 'Empate: ninguém acertou ninguém.' : `🏆 ${duel.players[w].name} venceu${duel.bestOf === 3 ? ` por ${Math.max(...duel.score)} x ${Math.min(...duel.score)}` : ''}.`}
      </p>
    </Card>
  );
}

function CommandsTab() {
  return (
    <div className="grid">
      <Card title="Para o chat" subtitle="Mostre isso para o seu público">
        <div className="cmds">
          <div className="cmd">
            <kbd>!duelo</kbd>
            <p>
              <b>Entra no duelo.</b> Os dois primeiros se enfrentam.
            </p>
          </div>
          <div className="cmd">
            <kbd>!bang</kbd>
            <p>
              Atira, <b>só depois do FOGO!</b>. O primeiro tiro tem ~60% de chance de acertar; errou, recarrega por 1,2 s. Atirar antes do FOGO <b>trava a arma</b>.
            </p>
          </div>
          <div className="cmd">
            <kbd>!1 / !2</kbd>
            <p>
              <b>Torcida</b> para o duelista da esquerda (1) ou da direita (2). O lado com mais torcida ganha até +10% de mira.
            </p>
          </div>
        </div>
      </Card>
      <Card title="Para você e seus mods" subtitle="Controle sem abrir o painel">
        <div className="cmds">
          <div className="cmd">
            <kbd>!duelo iniciar</kbd>
            <p>
              <b>Abre o duelo</b> com as regras salvas aqui.
            </p>
          </div>
          <div className="cmd">
            <kbd>!duelo parar</kbd>
            <p>Encerra o duelo na hora.</p>
          </div>
        </div>
      </Card>
      <Card title="Apoios viram equipamento" subtitle="Vai para quem apoiou (se estiver duelando) ou para o lado que a pessoa torce">
        <div className="cmds">
          <div className="cmd">
            <kbd>🎯 Pontos</kbd>
            <p>
              <b>Mira:</b> +15% de chance de acerto.
            </p>
          </div>
          <div className="cmd">
            <kbd>🦺 Bits</kbd>
            <p>
              <b>Colete:</b> aguenta 1 tiro.
            </p>
          </div>
          <div className="cmd">
            <kbd>✨ Sub</kbd>
            <p>
              <b>Revólver dourado:</b> o próximo tiro não erra.
            </p>
          </div>
        </div>
        <p className="muted foot-note">Cada duelista guarda 1 de cada item. Item repetido ou apoio de quem não duela nem torce não vale (os pontos voltam).</p>
      </Card>
    </div>
  );
}
