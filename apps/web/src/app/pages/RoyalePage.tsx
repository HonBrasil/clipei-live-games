import { Link, useSearchParams } from 'react-router-dom';
import { ROYALE_REGIONS, ROYALE_REGION_IDS, ROYALE_WEAPONS, type RoyaleConfig, type RoyaleSnapshot } from '@clipei/shared';
import { api, nf } from '../api.ts';
import { Card, Check, Options } from '../components/ui.tsx';
import { BUSY_TEXT } from '../components/busy.ts';
import { useApp, useTick } from '../state.tsx';

const TABS = [
  { id: 'partida', label: 'Partida' },
  { id: 'comandos', label: 'Comandos e apoios' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const STATUS_LABEL: Record<RoyaleSnapshot['status'], string> = {
  idle: 'Parado',
  lobby: 'Embarque aberto',
  drop: 'Saltando de paraquedas',
  play: 'Valendo!',
  finished: 'Terminou',
  stopped: 'Encerrado',
};

export const isRoyaleActive = (s: RoyaleSnapshot | null) => !!s && ['lobby', 'drop', 'play'].includes(s.status);

export function RoyalePage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('aba')) ? params.get('aba') : 'partida') as Tab;
  const { royale } = useApp();
  const active = isRoyaleActive(royale);
  return (
    <>
      <section className="hero">
        <div>
          <p className="crumbs">
            <Link to="/app/jogos">Minigames</Link> / Battle Royale
          </p>
          <h1>
            Battle <span>Royale</span>
          </h1>
          <p>O chat salta de paraquedas, pega armas e luta até sobrar um. A tempestade fecha e quem morreu escolhe onde cai a caixa.</p>
        </div>
        {active && royale && (
          <div className="hero-live">
            <span className="pill live">Ao vivo</span>
            <b>{STATUS_LABEL[royale.status]}</b>
            <small>
              {royale.status === 'lobby' ? `${nf.format(royale.participants)} no avião` : `${nf.format(royale.alive)} vivos`}
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
      {tab === 'partida' ? <MatchTab /> : <CommandsTab />}
    </>
  );
}

function MatchTab() {
  const { me, royale, status, toast, saveSettings } = useApp();
  const cfg = me!.settings.royale;
  const active = isRoyaleActive(royale);
  const busy = status?.game && status.game !== 'royale' ? status.game : null;
  const set = (patch: Partial<RoyaleConfig>) => saveSettings({ royale: patch });

  async function open() {
    try {
      await api('/api/royale/start', cfg);
      toast('Embarque aberto! O chat entra com !entrar ou !cair <lugar> 🪂', 'ok');
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  }

  return (
    <div className="grid">
      <div className="col">
        {active && royale ? <LiveCard s={royale} /> : royale?.status === 'finished' && <ResultCard s={royale} />}
        <Card title="Como aparece na live">
          <Options
            name="brdisplay"
            value={cfg.fullscreen ? 'full' : 'window'}
            onChange={(v) => set({ fullscreen: v === 'full' })}
            options={[
              { value: 'full' as const, label: 'Tela cheia (recomendado)', hint: 'O mapa ocupa a tela toda enquanto a partida rola' },
              { value: 'window' as const, label: 'Janela', hint: 'Mapa menor, na posição e no tamanho do Overlay (OBS)' },
            ]}
          />
          <p className="muted" style={{ marginTop: 10 }}>
            Vale só para o Battle Royale. Os outros jogos seguem o modo escolhido em <Link to="/app/overlay">Overlay (OBS)</Link>.
          </p>
        </Card>
      </div>
      <div className="col">
        <Card title="Regras da partida">
          <div className="field">
            <span className="field-label">Tempo de embarque (!entrar / !cair)</span>
            <Options tight name="join" value={cfg.joinSec} onChange={(v) => set({ joinSec: v })} options={[30, 60, 90, 120].map((v) => ({ value: v, label: `${v}s` }))} />
          </div>
          <div className="field">
            <span className="field-label">
              <label htmlFor="brmax">Máximo de jogadores</label>
              <output>{cfg.maxPlayers}</output>
            </span>
            <input id="brmax" type="range" min={10} max={100} step={5} value={cfg.maxPlayers} onChange={(e) => set({ maxPlayers: Number(e.target.value) })} />
          </div>
          <Check checked={cfg.fillBots} onChange={(v) => set({ fillBots: v })}>
            Completar com soldados CPU até 10 jogadores (recomendado para chat pequeno)
          </Check>
          {busy && <p className="chat-error">{BUSY_TEXT[busy]} Um jogo por vez: espere terminar.</p>}
          <div className="actions">
            <button className="btn primary lg" disabled={active || !!busy} onClick={open}>
              🪂 Abrir embarque
            </button>
            <button
              className="btn danger lg"
              disabled={!active}
              onClick={async () => {
                await api('/api/royale/stop', {});
                toast('Battle Royale encerrado.');
              }}
            >
              Encerrar
            </button>
          </div>
          <p className="muted foot-note">
            A partida dura de 2 a 3 minutos depois do salto. Seus mods também abrem com <kbd>!royale iniciar</kbd>.
          </p>
        </Card>
      </div>
    </div>
  );
}

function LiveCard({ s }: { s: RoyaleSnapshot }) {
  const { toast, clockOffset } = useApp();
  useTick(500);
  const roster = s.roster ?? [];
  const left = s.lobbyEndsAt ? Math.max(0, Math.ceil((s.lobbyEndsAt - (Date.now() + clockOffset)) / 1000)) : 0;
  return (
    <Card title={STATUS_LABEL[s.status]} right={<span className="pill live">Ao vivo</span>}>
      <div className="race-live">
        <div>
          <b>{s.status === 'lobby' ? nf.format(s.participants) : nf.format(s.alive)}</b>
          <span>{s.status === 'lobby' ? 'no avião' : 'vivos'}</span>
        </div>
        <div>
          <b>{s.status === 'lobby' ? `${left}s` : `fase ${s.zone.stage + 1}`}</b>
          <span>{s.status === 'lobby' ? 'para decolar' : 'da tempestade'}</span>
        </div>
      </div>
      {s.status === 'lobby' && (
        <>
          <div className="br-regions">
            {ROYALE_REGION_IDS.map((id) => (
              <span key={id}>
                {ROYALE_REGIONS[id].name} <b>{s.regions[id]}</b>
              </span>
            ))}
          </div>
          <button
            className="btn block"
            style={{ marginTop: 12 }}
            onClick={async () => {
              await api('/api/royale/go', {});
              toast('Saltar! 🪂', 'ok');
            }}
          >
            ✈️ Decolar agora
          </button>
        </>
      )}
      {s.topKills.length > 0 && (
        <ol className="race-leaders">
          {s.topKills.map((idx) => {
            const p = s.players.find((x) => x[0] === idx);
            return (
              <li key={idx}>
                <i style={{ background: roster[idx]?.color }} />
                {roster[idx]?.name ?? '…'}
                <em>
                  {p?.[7] ?? 0} 💀 {p && p[5] >= 0 ? ROYALE_WEAPONS[p[5]].name : ''}
                </em>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

function ResultCard({ s }: { s: RoyaleSnapshot }) {
  const roster = s.roster ?? [];
  const w = s.winner === null ? null : roster[s.winner];
  return (
    <Card title="Última partida" subtitle={`${nf.format(s.players.length)} jogadores`}>
      <p style={{ margin: 0, fontWeight: 700 }}>{w ? `🏆 ${w.name} foi o último de pé.` : 'A tempestade levou todo mundo.'}</p>
    </Card>
  );
}

function CommandsTab() {
  return (
    <div className="grid">
      <Card title="Para o chat" subtitle="Mostre isso para o seu público">
        <div className="cmds">
          <div className="cmd">
            <kbd>!entrar</kbd>
            <p>
              <b>Embarca no avião</b> e cai num lugar sorteado.
            </p>
          </div>
          <div className="cmd">
            <kbd>!cair &lt;lugar&gt;</kbd>
            <p>
              Escolhe onde cair: <b>cidade</b> (mais armas, mais gente), <b>porto</b>, <b>fazenda</b> ou <b>floresta</b>. Também serve para entrar.
            </p>
          </div>
          <div className="cmd">
            <kbd>!curar</kbd>
            <p>
              Vivos: usa um curativo (+40 de vida), se tiver. 1 vez a cada 15 s. Curativos saem das caixas.
            </p>
          </div>
          <div className="cmd">
            <kbd>!caixa &lt;lugar&gt;</kbd>
            <p>
              <b>Quem morreu (ou só assiste)</b> vota onde cai a próxima caixa lendária: arma dourada, colete e curativo.
            </p>
          </div>
        </div>
      </Card>
      <Card title="Como funciona" subtitle="O chat decide, os soldados executam">
        <div className="cmds">
          <div className="cmd">
            <kbd>🔫</kbd>
            <p>Cada soldado anda, saqueia e atira sozinho (o atraso da live não deixa pilotar). A arma, o colete e a sorte decidem cada troca de tiros.</p>
          </div>
          <div className="cmd">
            <kbd>⚪🟢🔵🟣🟡</kbd>
            <p>Raridade das armas: pistola, escopeta, fuzil, sniper e lendária.</p>
          </div>
          <div className="cmd">
            <kbd>🌪️</kbd>
            <p>A tempestade fecha em fases e empurra todo mundo para o meio. Fora do círculo perde vida, cada vez mais rápido.</p>
          </div>
          <div className="cmd">
            <kbd>!royale iniciar</kbd>
            <p>Mods abrem o embarque pelo chat. <kbd>!royale parar</kbd> encerra.</p>
          </div>
        </div>
      </Card>
      <Card title="Apoios" subtitle="Vantagem, não vitória garantida">
        <div className="cmds">
          <div className="cmd">
            <kbd>🎯 Pontos</kbd>
            <p>
              <b>Curativo extra</b> (até 3).
            </p>
          </div>
          <div className="cmd">
            <kbd>💎 Bits</kbd>
            <p>
              <b>Colete nível 3</b> (escudo cheio).
            </p>
          </div>
          <div className="cmd">
            <kbd>⭐ Sub</kbd>
            <p>
              <b>Caixa de suprimentos</b> caindo do lado de quem apoiou.
            </p>
          </div>
          <div className="cmd">
            <kbd>🚀 Raid</kbd>
            <p>
              <b>Bombardeio:</b> explosões aleatórias dentro da zona, caos para todo mundo.
            </p>
          </div>
        </div>
        <p className="muted foot-note">Apoiou durante o embarque? Já entra no avião com o item. Pontos de quem não está vivo na partida voltam.</p>
      </Card>
    </div>
  );
}
