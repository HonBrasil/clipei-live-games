import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { TermoConfig, TermoScoreRow, TermoSnapshot } from '@clipei/shared';
import { api, nf } from '../api.ts';
import { Card, Check, Options } from '../components/ui.tsx';
import { BUSY_TEXT } from '../components/busy.ts';
import { GameSupportCard } from '../components/GameSupport.tsx';
import { useApp, useTick } from '../state.tsx';

const TABS = [
  { id: 'partida', label: 'Partida' },
  { id: 'ranking', label: 'Ranking' },
  { id: 'apoios', label: 'Apoios' },
  { id: 'comandos', label: 'Comandos' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const isActive = (s: TermoSnapshot | null) => !!s && (s.status === 'playing' || s.status === 'between');

export function TermoPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('aba')) ? params.get('aba') : 'partida') as Tab;
  const { termo } = useApp();
  return (
    <>
      <section className="hero">
        <div>
          <p className="crumbs">
            <Link to="/app/jogos">Minigames</Link> / Termo do Chat
          </p>
          <h1>
            Termo do <span>Chat</span>
          </h1>
          <p>A palavra secreta de 5 letras. O chat chuta com !t, as letras ficam verdes no lugar certo e amarelas fora do lugar. Quem acerta primeiro leva os pontos.</p>
        </div>
        {isActive(termo) && termo && (
          <div className="hero-live">
            <span className="pill live">Ao vivo</span>
            <b>
              Palavra {termo.round} de {termo.rounds}
            </b>
            <small>
              {nf.format(termo.totalGuesses)} chutes · {nf.format(termo.players)} pessoas
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
      {tab === 'partida' ? (
        <MatchTab />
      ) : tab === 'ranking' ? (
        <RankingTab />
      ) : tab === 'apoios' ? (
        <div className="grid one">
          <GameSupportCard game="termo" />
        </div>
      ) : (
        <CommandsTab />
      )}
    </>
  );
}

function MatchTab() {
  const { me, termo, status, toast, saveSettings } = useApp();
  const cfg = me!.settings.termo;
  const active = isActive(termo);
  const busy = status?.game && status.game !== 'termo' ? status.game : null;
  const set = (patch: Partial<TermoConfig>) => saveSettings({ termo: patch });

  async function open() {
    try {
      await api('/api/termo/start', cfg);
      toast('Termo do Chat no ar! O chat chuta com !t e a palavra 🔤', 'ok');
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  }

  return (
    <div className="grid">
      <div className="col">
        {active && termo ? <LiveCard s={termo} /> : termo?.status === 'finished' && <ResultCard s={termo} />}
        <Card title="Como funciona">
          <div className="tm-how-list">
            <p>
              <span className="tm-mini g">C</span> letra no lugar certo
            </p>
            <p>
              <span className="tm-mini y">A</span> a palavra tem essa letra, em outro lugar
            </p>
            <p>
              <span className="tm-mini b">S</span> a palavra não tem essa letra
            </p>
          </div>
          <p className="muted foot-note">
            Acentos não importam e só valem palavras que existem. Quem acerta ganha 100 pontos mais um bônus de rapidez. Quem descobre uma letra nova também pontua:
            +10 no lugar certo, +3 fora do lugar.
          </p>
        </Card>
      </div>
      <div className="col">
        <Card title="Regras da partida">
          <div className="field">
            <span className="field-label">Palavras por partida</span>
            <Options tight name="trounds" value={cfg.rounds} onChange={(v) => set({ rounds: v })} options={[1, 3, 5].map((v) => ({ value: v, label: v === 1 ? '1 palavra' : `${v} palavras` }))} />
          </div>
          <div className="field">
            <span className="field-label">Tempo para cada palavra</span>
            <Options tight name="tsec" value={cfg.roundSec} onChange={(v) => set({ roundSec: v })} options={[90, 180, 300].map((v) => ({ value: v, label: v < 120 ? `${v}s` : `${v / 60} min` }))} />
          </div>
          <div className="field">
            <span className="field-label">Espera entre chutes (por pessoa)</span>
            <Options tight name="tcool" value={cfg.cooldownSec} onChange={(v) => set({ cooldownSec: v })} options={[0, 3, 5, 10].map((v) => ({ value: v, label: v ? `${v}s` : 'Sem espera' }))} />
            <small className="muted">Com chat grande, uma espera curta evita que poucas pessoas chutem tudo.</small>
          </div>
          <Check checked={cfg.hints} onChange={(v) => set({ hints: v })}>
            Revelar uma letra na metade do tempo e outra nos 3/4 (nunca entrega a palavra toda)
          </Check>
          {busy && <p className="chat-error">{BUSY_TEXT[busy]} Um jogo por vez: espere terminar.</p>}
          <div className="actions">
            <button className="btn primary lg" disabled={active || !!busy} onClick={open}>
              🔤 Começar
            </button>
            <button
              className="btn danger lg"
              disabled={!active}
              onClick={async () => {
                await api('/api/termo/stop', {});
                toast('Termo do Chat encerrado.');
              }}
            >
              Encerrar
            </button>
          </div>
          <p className="muted foot-note">
            Seus mods também usam <kbd>!termo iniciar</kbd>, <kbd>!termo pular</kbd> (mostra a resposta e vai para a próxima) e <kbd>!termo parar</kbd>.
          </p>
        </Card>
      </div>
    </div>
  );
}

function LiveCard({ s }: { s: TermoSnapshot }) {
  const { toast, clockOffset } = useApp();
  useTick(500);
  const now = Date.now() + clockOffset;
  const left = s.endsAt ? Math.max(0, Math.ceil((s.endsAt - now) / 1000)) : 0;
  return (
    <Card title={s.status === 'between' ? 'Entre uma palavra e outra' : 'Palavra no ar'} right={<span className="pill live">Ao vivo</span>}>
      <div className="race-live">
        <div>
          <b>
            {s.round}/{s.rounds}
          </b>
          <span>palavra</span>
        </div>
        <div>
          <b>{s.status === 'playing' ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '—'}</b>
          <span>restante</span>
        </div>
        <div>
          <b>{nf.format(s.totalGuesses)}</b>
          <span>chutes</span>
        </div>
      </div>
      <div className="tm-known-panel" aria-label="Letras já descobertas">
        {s.known.map((c, i) => (
          <span key={i} className={c ? (s.hinted[i] ? 'hint' : 'g') : ''}>
            {c?.toUpperCase() ?? ''}
          </span>
        ))}
        {s.solution && <em>Resposta: {s.solution.toUpperCase()}</em>}
      </div>
      {s.scores.length > 0 && <ScoreList rows={s.scores} />}
      {s.status === 'playing' && (
        <button
          className="btn block"
          style={{ marginTop: 12 }}
          onClick={async () => {
            await api('/api/termo/skip', {});
            toast('Palavra pulada: a resposta apareceu na tela.');
          }}
        >
          ⏭ Pular esta palavra
        </button>
      )}
    </Card>
  );
}

function ScoreList({ rows }: { rows: TermoScoreRow[] }) {
  return (
    <ol className="race-leaders">
      {rows.map((r) => (
        <li key={r.name}>
          <i style={{ background: r.color }} />
          {r.name}
          <em>
            {nf.format(r.points)} pts · {r.wins} {r.wins === 1 ? 'palavra' : 'palavras'}
          </em>
        </li>
      ))}
    </ol>
  );
}

function ResultCard({ s }: { s: TermoSnapshot }) {
  return (
    <Card title="Última partida" subtitle={`${nf.format(s.totalGuesses)} chutes de ${nf.format(s.players)} pessoas`}>
      {s.scores.length ? <ScoreList rows={s.scores} /> : <p className="muted">Ninguém pontuou dessa vez.</p>}
    </Card>
  );
}

function RankingTab() {
  const [data, setData] = useState<{ week: TermoScoreRow[]; lastWeek: TermoScoreRow[]; totalWords: number } | null>(null);
  const load = useCallback(() => {
    fetch('/api/termo/ranking', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setData(d))
      .catch(() => {});
  }, []);
  useEffect(() => load(), [load]);
  return (
    <div className="grid">
      <Card title="Ranking da semana" subtitle="Soma as partidas da semana · zera toda segunda">
        {data?.week.length ? <ScoreList rows={data.week} /> : <p className="muted">Ninguém pontuou nesta semana ainda.</p>}
      </Card>
      <Card title="Pódio da semana passada" subtitle={data ? `${nf.format(data.totalWords)} palavras jogadas no canal` : ''}>
        {data?.lastWeek.length ? <ScoreList rows={data.lastWeek} /> : <p className="muted">Ainda não teve uma semana completa.</p>}
      </Card>
    </div>
  );
}

function CommandsTab() {
  return (
    <div className="grid">
      <Card title="Para o chat" subtitle="Mostre isso para o seu público">
        <div className="cmds">
          <div className="cmd">
            <kbd>!t casal</kbd>
            <p>
              Chuta a palavra (também vale <b>!termo casal</b>). Acentos não importam. Cada pessoa espera alguns segundos entre um chute e outro.
            </p>
          </div>
          <div className="cmd">
            <kbd>!termo</kbd>
            <p>O bot explica como jogar.</p>
          </div>
        </div>
      </Card>
      <Card title="Para você e seus mods">
        <div className="cmds">
          <div className="cmd">
            <kbd>!termo iniciar</kbd>
            <p>Começa a partida.</p>
          </div>
          <div className="cmd">
            <kbd>!termo pular</kbd>
            <p>Mostra a resposta e vai para a próxima palavra.</p>
          </div>
          <div className="cmd">
            <kbd>!termo parar</kbd>
            <p>Encerra a partida.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
