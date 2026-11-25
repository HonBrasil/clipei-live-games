import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RACE_LIMITS, RACE_TRACKS, RACE_TRACK_IDS, type RaceConfig, type RaceSnapshot, type RaceTrackId } from '@clipei/shared';
import { api, nf } from '../api.ts';
import { Card, Check, Options } from '../components/ui.tsx';
import { BUSY_TEXT } from '../components/busy.ts';
import { GameSupportCard } from '../components/GameSupport.tsx';
import { useApp, useTick } from '../state.tsx';
import { drawTrackThumb } from '../../race/race-arena.ts';

const TABS = [
  { id: 'corrida', label: 'Corrida' },
  { id: 'apoios', label: 'Apoios' },
  { id: 'comandos', label: 'Comandos' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const STATUS_LABEL: Record<RaceSnapshot['status'], string> = {
  idle: 'Parada',
  lobby: 'Inscrições abertas',
  running: 'Correndo',
  finished: 'Terminou',
  stopped: 'Encerrada',
};

export function RacePage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('aba')) ? params.get('aba') : 'corrida') as Tab;
  const { race } = useApp();
  const active = race?.status === 'lobby' || race?.status === 'running';

  return (
    <>
      <section className="hero">
        <div>
          <p className="crumbs">
            <Link to="/app/jogos">Minigames</Link> / Corrida
          </p>
          <h1>
            Cor<span>rida</span>
          </h1>
          <p>Cada pessoa do chat vira um piloto. Obstáculos na pista, janelas de turbo e apoios que viram foguetes.</p>
        </div>
        {active && race && (
          <div className="hero-live">
            <span className="pill live">Ao vivo</span>
            <b>{RACE_TRACKS[race.track].name}</b>
            <small>
              {STATUS_LABEL[race.status]} · {nf.format(race.participants)} {race.participants === 1 ? 'piloto' : 'pilotos'}
            </small>
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

      {tab === 'corrida' ? (
        <RaceTab />
      ) : tab === 'apoios' ? (
        <div className="grid one">
          <GameSupportCard game="race" />
        </div>
      ) : (
        <CommandsTab />
      )}
    </>
  );
}

function TrackThumb({ id }: { id: RaceTrackId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawTrackThumb(ref.current, id);
  }, [id]);
  return <canvas ref={ref} width={192} height={108} aria-hidden="true" className="track-thumb" />;
}

function RaceTab() {
  const { me, race, status, toast, saveSettings } = useApp();
  const cfg = me!.settings.race;
  const active = race?.status === 'lobby' || race?.status === 'running';
  const busy = status?.game && status.game !== 'race' ? status.game : null;
  const set = (patch: Partial<RaceConfig>) => saveSettings({ race: patch });

  async function open() {
    try {
      await api('/api/race/start', cfg);
      toast(`Corrida aberta na ${RACE_TRACKS[cfg.track].name}! O chat entra com !correr 🏁`, 'ok');
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  }

  return (
    <div className="grid">
      <div className="col">
        {active && race ? <LiveCard race={race} /> : race?.status === 'finished' && race.podium.length > 0 && <ResultCard race={race} />}
        <Card title="Pista" subtitle="Muda o cenário e as cores. O circuito é o mesmo">
          <div className="boss-picker track-picker" role="radiogroup" aria-label="Pista">
            {RACE_TRACK_IDS.map((id) => (
              <label className="boss-opt" key={id}>
                <input type="radio" name="track" checked={cfg.track === id} onChange={() => set({ track: id })} />
                <span>
                  <TrackThumb id={id} />
                  <b>{RACE_TRACKS[id].name}</b>
                  <small>{RACE_TRACKS[id].title}</small>
                </span>
              </label>
            ))}
          </div>
        </Card>
      </div>
      <div className="col">
        <Card title="Regras da corrida">
          <div className="field">
            <span className="field-label">Tempo de inscrição (!correr)</span>
            <Options tight name="join" value={cfg.joinSec} onChange={(v) => set({ joinSec: v })} options={[20, 30, 45, 60, 90].map((v) => ({ value: v, label: `${v}s` }))} />
          </div>
          <div className="field">
            <span className="field-label">Voltas</span>
            <Options
              tight
              name="laps"
              value={cfg.laps}
              onChange={(v) => set({ laps: v })}
              options={[
                { value: 1, label: '1 volta', hint: '~20 s' },
                { value: 2, label: '2 voltas', hint: '~40 s' },
                { value: 3, label: '3 voltas', hint: '~1 min' },
              ]}
            />
          </div>
          <div className="field">
            <span className="field-label">
              <label htmlFor="max">Máximo de pilotos</label>
              <output>{cfg.maxRunners}</output>
            </span>
            <input
              id="max"
              type="range"
              min={RACE_LIMITS.maxRunners[0]}
              max={RACE_LIMITS.maxRunners[1]}
              step={2}
              value={cfg.maxRunners}
              onChange={(e) => set({ maxRunners: Number(e.target.value) })}
            />
          </div>
          <Check checked={cfg.fillBots} onChange={(v) => set({ fillBots: v })}>
            Completar com pilotos da Clipei (CPU) quando tiver menos de 4
          </Check>
          {busy && <p className="chat-error">{BUSY_TEXT[busy]} Um jogo por vez: espere terminar para abrir a corrida.</p>}
          <div className="actions">
            <button className="btn primary lg" disabled={active || !!busy} onClick={open}>
              🏁 Abrir corrida
            </button>
            <button
              className="btn danger lg"
              disabled={!active}
              onClick={async () => {
                await api('/api/race/stop', {});
                toast('Corrida encerrada.');
              }}
            >
              Encerrar
            </button>
          </div>
          <p className="muted foot-note">
            Seus mods também abrem pelo chat com <kbd>!corrida iniciar</kbd>. Para a corrida virar a tela principal, use o modo tela cheia em{' '}
            <Link to="/app/overlay">Overlay (OBS)</Link>.
          </p>
        </Card>
      </div>
    </div>
  );
}

function LiveCard({ race }: { race: RaceSnapshot }) {
  const { toast, clockOffset } = useApp();
  useTick(500);
  const now = Date.now() + clockOffset;
  const roster = race.roster ?? [];
  const lobbyLeft = race.lobbyEndsAt ? Math.max(0, Math.ceil((race.lobbyEndsAt - now) / 1000)) : 0;

  return (
    <Card title={STATUS_LABEL[race.status]} subtitle={`${RACE_TRACKS[race.track].name} · ${race.laps} ${race.laps === 1 ? 'volta' : 'voltas'}`} right={<span className="pill live">Ao vivo</span>}>
      <div className="race-live">
        <div>
          <b>{nf.format(race.participants)}</b>
          <span>{race.participants === 1 ? 'piloto' : 'pilotos'}</span>
        </div>
        {race.status === 'lobby' ? (
          <div>
            <b>{lobbyLeft}s</b>
            <span>para a largada</span>
          </div>
        ) : (
          <div>
            <b>{race.turbo.open ? '⚡' : '—'}</b>
            <span>{race.turbo.open ? 'turbo liberado' : 'turbo fechado'}</span>
          </div>
        )}
      </div>
      {race.status === 'running' && race.leaders.length > 0 && (
        <ol className="race-leaders">
          {race.leaders.map((idx) => (
            <li key={idx}>
              <i style={{ background: roster[idx]?.color }} />
              {roster[idx]?.name ?? '…'}
            </li>
          ))}
        </ol>
      )}
      {race.status === 'lobby' && (
        <button
          className="btn block"
          style={{ marginTop: 12 }}
          onClick={async () => {
            await api('/api/race/go', {});
            toast('Largada! 🚦', 'ok');
          }}
        >
          🚦 Largar agora
        </button>
      )}
    </Card>
  );
}

function ResultCard({ race }: { race: RaceSnapshot }) {
  const medals = ['🥇', '🥈', '🥉'];
  return (
    <Card title="Última corrida" subtitle={`${RACE_TRACKS[race.track].name} · ${nf.format(race.participants)} pilotos`}>
      <ol className="race-leaders podium">
        {race.podium.map((p, i) => (
          <li key={p.name}>
            <span>{medals[i]}</span>
            {p.name}
            <em>{p.timeMs ? `${(p.timeMs / 1000).toFixed(1).replace('.', ',')} s` : '—'}</em>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function CommandsTab() {
  return (
    <div className="grid">
      <Card title="Para o chat" subtitle="Mostre isso para o seu público">
        <div className="cmds">
          <div className="cmd">
            <kbd>!correr</kbd>
            <p>
              <b>Entra na corrida</b> durante as inscrições. Uma vez por pessoa (também vale <kbd>!entrar</kbd>).
            </p>
          </div>
          <div className="cmd">
            <kbd>!turbo</kbd>
            <p>
              Só quando aparecer <b>TURBO!</b> na tela (a cada 8 a 11 s, por 4 s): um arranque forte, uma vez por janela. Tem 15% de chance de tropeçar.
            </p>
          </div>
          <div className="cmd">
            <kbd>🍌</kbd>
            <p>Cascas de banana e manchas de óleo aparecem na pista, e cada piloto desvia como consegue.</p>
          </div>
          <div className="cmd">
            <kbd>!corrida</kbd>
            <p>O bot explica como jogar.</p>
          </div>
        </div>
      </Card>
      <Card title="Para você e seus mods" subtitle="Controle sem abrir o painel">
        <div className="cmds">
          <div className="cmd">
            <kbd>!corrida iniciar</kbd>
            <p>
              <b>Abre as inscrições</b> com as regras salvas aqui.
            </p>
          </div>
          <div className="cmd">
            <kbd>!corrida parar</kbd>
            <p>Encerra a corrida na hora.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
