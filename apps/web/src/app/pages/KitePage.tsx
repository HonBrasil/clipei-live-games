import { Link, useSearchParams } from 'react-router-dom';
import { KITE_LINES, KITE_FLAG, type KiteConfig, type KiteSnapshot } from '@clipei/shared';
import { api, nf } from '../api.ts';
import { Card, Check, Options } from '../components/ui.tsx';
import { BUSY_TEXT } from '../components/busy.ts';
import { useApp, useTick } from '../state.tsx';

const TABS = [
  { id: 'partida', label: 'Partida' },
  { id: 'comandos', label: 'Comandos e apoios' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const STATUS_LABEL: Record<KiteSnapshot['status'], string> = {
  idle: 'Parado',
  lobby: 'Inscrições abertas',
  play: 'Pipas no céu',
  finished: 'Terminou',
  stopped: 'Encerrado',
};

export const isKiteActive = (s: KiteSnapshot | null) => !!s && (s.status === 'lobby' || s.status === 'play');

const fmt = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export function KitePage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('aba')) ? params.get('aba') : 'partida') as Tab;
  const { kite } = useApp();
  const active = isKiteActive(kite);
  return (
    <>
      <section className="hero">
        <div>
          <p className="crumbs">
            <Link to="/app/jogos">Minigames</Link> / Pipa Combate
          </p>
          <h1>
            Pipa <span>Combate</span>
          </h1>
          <p>Cada pessoa solta uma pipa sobre o morro. Quando as linhas cruzam, é relo: puxe, dibique ou descarregue para cortar. Pipa voada, o chat apara.</p>
        </div>
        {active && kite && (
          <div className="hero-live">
            <span className="pill live">Ao vivo</span>
            <b>{STATUS_LABEL[kite.status]}</b>
            <small>{kite.status === 'lobby' ? `${nf.format(kite.participants)} inscritos` : `${nf.format(kite.alive)} no céu`}</small>
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
  const { me, kite, status, toast, saveSettings } = useApp();
  const cfg = me!.settings.kite;
  const active = isKiteActive(kite);
  const busy = status?.game && status.game !== 'kite' ? status.game : null;
  const set = (patch: Partial<KiteConfig>) => saveSettings({ kite: patch });

  async function open() {
    try {
      await api('/api/kite/start', cfg);
      toast('Inscrições abertas! O chat entra com !pipa 🪁', 'ok');
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  }

  return (
    <div className="grid">
      <div className="col">
        {active && kite ? <LiveCard s={kite} /> : kite?.status === 'finished' && <ResultCard s={kite} />}
        <Card title="Como aparece na live">
          <Options
            name="kitedisplay"
            value={cfg.fullscreen ? 'full' : 'window'}
            onChange={(v) => set({ fullscreen: v === 'full' })}
            options={[
              { value: 'full' as const, label: 'Tela cheia (recomendado)', hint: 'O céu e o morro ocupam a tela toda durante a partida' },
              { value: 'window' as const, label: 'Janela', hint: 'Céu menor, na posição e no tamanho do Overlay (OBS)' },
            ]}
          />
          <p className="muted" style={{ marginTop: 10 }}>
            Vale só para o Pipa Combate. Os outros jogos seguem o modo escolhido em <Link to="/app/overlay">Overlay (OBS)</Link>.
          </p>
        </Card>
      </div>
      <div className="col">
        <Card title="Regras da partida">
          <div className="field">
            <span className="field-label">Tempo de inscrição (!pipa)</span>
            <Options tight name="kjoin" value={cfg.joinSec} onChange={(v) => set({ joinSec: v })} options={[30, 60, 90, 120].map((v) => ({ value: v, label: `${v}s` }))} />
          </div>
          <div className="field">
            <span className="field-label">Tempo máximo no céu</span>
            <Options
              tight
              name="kdur"
              value={cfg.durationSec}
              onChange={(v) => set({ durationSec: v })}
              options={[120, 180, 240, 300].map((v) => ({ value: v, label: `${v / 60} min` }))}
            />
            <small className="muted">Vence a última pipa no céu. Se o tempo acabar antes, vence quem cortou mais.</small>
          </div>
          <div className="field">
            <span className="field-label">
              <label htmlFor="kmax">Máximo de pipas</label>
              <output>{cfg.maxPlayers}</output>
            </span>
            <input id="kmax" type="range" min={6} max={60} step={2} value={cfg.maxPlayers} onChange={(e) => set({ maxPlayers: Number(e.target.value) })} />
          </div>
          <Check checked={cfg.fillBots} onChange={(v) => set({ fillBots: v })}>
            Completar com pipas CPU até 6 (recomendado para chat pequeno)
          </Check>
          {busy && <p className="chat-error">{BUSY_TEXT[busy]} Um jogo por vez: espere terminar.</p>}
          <div className="actions">
            <button className="btn primary lg" disabled={active || !!busy} onClick={open}>
              🪁 Abrir inscrições
            </button>
            <button
              className="btn danger lg"
              disabled={!active}
              onClick={async () => {
                await api('/api/kite/stop', {});
                toast('Pipa Combate encerrado.');
              }}
            >
              Encerrar
            </button>
          </div>
          <p className="muted foot-note">
            Seus mods também abrem com <kbd>!pipa iniciar</kbd> e encerram com <kbd>!pipa parar</kbd>.
          </p>
        </Card>
      </div>
    </div>
  );
}

function LiveCard({ s }: { s: KiteSnapshot }) {
  const { toast, clockOffset } = useApp();
  useTick(500);
  const roster = s.roster ?? [];
  const now = Date.now() + clockOffset;
  const lobby = s.status === 'lobby';
  return (
    <Card title={STATUS_LABEL[s.status]} right={<span className="pill live">Ao vivo</span>}>
      <div className="race-live">
        <div>
          <b>{lobby ? nf.format(s.participants) : nf.format(s.alive)}</b>
          <span>{lobby ? 'inscritos' : 'no céu'}</span>
        </div>
        <div>
          <b>{lobby ? fmt((s.lobbyEndsAt ?? now) - now) : fmt((s.endsAt ?? now) - now)}</b>
          <span>{lobby ? 'para subir' : 'de partida'}</span>
        </div>
        {!lobby && (
          <div>
            <b>{s.relos.length}</b>
            <span>{s.relos.length === 1 ? 'relo agora' : 'relos agora'}</span>
          </div>
        )}
      </div>
      {lobby && (
        <button
          className="btn block"
          style={{ marginTop: 12 }}
          onClick={async () => {
            await api('/api/kite/go', {});
            toast('Solta a pipa! 🪁', 'ok');
          }}
        >
          🪁 Subir as pipas agora
        </button>
      )}
      {s.topCuts.length > 0 && (
        <ol className="race-leaders">
          {s.topCuts.map((idx) => {
            const k = s.kites.find((x) => x[0] === idx);
            const alive = k ? (k[3] & KITE_FLAG.alive) !== 0 : false;
            return (
              <li key={idx} style={{ opacity: alive ? 1 : 0.55 }}>
                <i style={{ background: roster[idx]?.color }} />
                {roster[idx]?.name ?? '…'}
                <em>
                  {k?.[6] ?? 0} ✂️ {k ? KITE_LINES[k[5]]?.name : ''}
                </em>
              </li>
            );
          })}
        </ol>
      )}
      {s.aparadores.length > 0 && (
        <p className="muted foot-note">
          🙌 Quem mais aparou: <b>{s.aparadores[0].name}</b> ({s.aparadores[0].n})
        </p>
      )}
    </Card>
  );
}

function ResultCard({ s }: { s: KiteSnapshot }) {
  const roster = s.roster ?? [];
  const w = s.winner === null ? null : roster[s.winner];
  return (
    <Card title="Última partida" subtitle={`${nf.format(s.kites.length)} pipas`}>
      <p style={{ margin: 0, fontWeight: 700 }}>
        {w ? `🏆 ${w.name} foi o Rei do Céu${s.winReason === 'time' ? ' (mais cortes no fim do tempo)' : ''}.` : 'Ninguém sobrou no céu.'}
      </p>
      {s.aparadores[0] && (
        <p className="muted foot-note">
          🙌 Rei da aparada: {s.aparadores[0].name} ({s.aparadores[0].n})
        </p>
      )}
    </Card>
  );
}

function CommandsTab() {
  return (
    <div className="grid">
      <Card title="Para o chat" subtitle="Mostre isso para o seu público">
        <div className="cmds">
          <div className="cmd">
            <kbd>!pipa</kbd>
            <p>
              <b>Solta uma pipa</b> com modelo sorteado. Ou escolha: <b>!pipa raia</b>, <b>capucheta</b>, <b>arraia</b> ou <b>peixinho</b>.
            </p>
          </div>
          <div className="cmd">
            <kbd>!puxar</kbd>
            <p>
              A pipa <b>sobe</b>. Quem está mais alto leva vantagem no relo. Recarga de 5 s.
            </p>
          </div>
          <div className="cmd">
            <kbd>!dibicar</kbd>
            <p>
              Mergulha atrás da <b>pipa mais perto</b> e puxa um relo, com um pouco mais de força. Recarga de 6 s.
            </p>
          </div>
          <div className="cmd">
            <kbd>!descarregar</kbd>
            <p>
              Solta linha no relo: <b>bem mais força para cortar</b>, mas a pipa perde altura. Vale até 4 s antes do relo abrir.
            </p>
          </div>
          <div className="cmd">
            <kbd>!aparar</kbd>
            <p>
              <b>Qualquer pessoa do chat</b>: o primeiro a digitar leva a pipa voada e sobe no ranking de aparadores.
            </p>
          </div>
        </div>
      </Card>
      <Card title="Como funciona" subtitle="O chat decide a tática, a pipa voa sozinha">
        <div className="cmds">
          <div className="cmd">
            <kbd>🪁</kbd>
            <p>As pipas voam sozinhas com o vento (o atraso da live não deixa pilotar). Quando duas linhas se cruzam perto das pipas, abre um relo de 6 s.</p>
          </div>
          <div className="cmd">
            <kbd>🎏</kbd>
            <p>A rabiola é um escudo: o primeiro corte leva só ela. Sem rabiola, o próximo corte derruba a pipa.</p>
          </div>
          <div className="cmd">
            <kbd>🧵</kbd>
            <p>Linhas: Comum, Neon, Diamante e Dourada. Quanto melhor a linha, mais força no relo.</p>
          </div>
          <div className="cmd">
            <kbd>🌪️</kbd>
            <p>De tempos em tempos vem uma ventania, e às vezes uma pipa enrosca no fio e fica vulnerável.</p>
          </div>
        </div>
      </Card>
      <Card title="Apoios" subtitle="Vantagem, não vitória garantida">
        <div className="cmds">
          <div className="cmd">
            <kbd>🎯 Pontos</kbd>
            <p>
              <b>Rabiola extra</b> (até 3).
            </p>
          </div>
          <div className="cmd">
            <kbd>💎 Bits</kbd>
            <p>
              <b>Linha Diamante</b>.
            </p>
          </div>
          <div className="cmd">
            <kbd>⭐ Sub</kbd>
            <p>
              <b>Raia Dourada:</b> pipa maior e brilhante, Linha Dourada e mais uma rabiola.
            </p>
          </div>
          <div className="cmd">
            <kbd>🚀 Raid</kbd>
            <p>
              <b>Ventania</b> e <b>chuva de pipas</b> para o chat aparar.
            </p>
          </div>
        </div>
        <p className="muted foot-note">Apoiou nas inscrições? Já entra no céu com o item. Pontos de quem não está com pipa no céu voltam.</p>
      </Card>
    </div>
  );
}
