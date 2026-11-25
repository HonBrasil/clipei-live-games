import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PENALTY_COLORS, type PenaltyConfig, type PenaltySnapshot, type PenaltyTeamConfig } from '@clipei/shared';
import { api, nf } from '../api.ts';
import { Card, Check, Options } from '../components/ui.tsx';
import { BUSY_TEXT } from '../components/busy.ts';
import { GameSupportCard } from '../components/GameSupport.tsx';
import { useApp, useTick } from '../state.tsx';

const TABS = [
  { id: 'partida', label: 'Partida' },
  { id: 'apoios', label: 'Apoios' },
  { id: 'comandos', label: 'Comandos' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const STATUS_LABEL: Record<PenaltySnapshot['status'], string> = {
  idle: 'Parado',
  lobby: 'Escolha de times',
  vote: 'Votação da cobrança',
  kick: 'Cobrança!',
  result: 'Cobrança!',
  finished: 'Terminou',
  stopped: 'Encerrado',
};

export const isPenaltyActive = (s: PenaltySnapshot | null) => !!s && !['idle', 'finished', 'stopped'].includes(s.status);

export function PenaltyPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('aba')) ? params.get('aba') : 'partida') as Tab;
  const { penalty } = useApp();
  const active = isPenaltyActive(penalty);
  return (
    <>
      <section className="hero">
        <div>
          <p className="crumbs">
            <Link to="/app/jogos">Minigames</Link> / Pênaltis
          </p>
          <h1>
            Disputa de <span>Pênaltis</span>
          </h1>
          <p>O chat se divide em dois times. Quem bate vota o canto, quem defende vota o pulo do goleiro. A maioria decide, a sorte ajuda.</p>
        </div>
        {active && penalty && (
          <div className="hero-live">
            <span className="pill live">Ao vivo</span>
            <b>
              {penalty.teams[0].score} x {penalty.teams[1].score}
            </b>
            <small>{STATUS_LABEL[penalty.status]}</small>
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
      ) : tab === 'apoios' ? (
        <div className="grid one">
          <GameSupportCard game="penalty" />
        </div>
      ) : (
        <CommandsTab />
      )}
    </>
  );
}

/** Nome e cor de um time (o nome salva ao sair do campo). */
function TeamField({ label, team, other, onChange }: { label: string; team: PenaltyTeamConfig; other: PenaltyTeamConfig; onChange: (t: Partial<PenaltyTeamConfig>) => void }) {
  const [name, setName] = useState(team.name);
  useEffect(() => setName(team.name), [team.name]);
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <input
        className="input"
        value={name}
        maxLength={18}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== team.name && onChange({ name: name.trim() })}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label={`Nome do ${label}`}
      />
      <div className="pen-colors" role="radiogroup" aria-label={`Cor do ${label}`}>
        {PENALTY_COLORS.map((c) => (
          <button
            key={c.color}
            type="button"
            role="radio"
            aria-checked={team.color === c.color}
            aria-label={c.label}
            title={c.color === other.color ? `${c.label} (cor do outro time)` : c.label}
            disabled={c.color === other.color}
            className={team.color === c.color ? 'on' : ''}
            style={{ background: c.color }}
            onClick={() => onChange({ color: c.color })}
          />
        ))}
      </div>
    </div>
  );
}

function MatchTab() {
  const { me, penalty, status, toast, saveSettings } = useApp();
  const cfg = me!.settings.penalty;
  const active = isPenaltyActive(penalty);
  const busy = status?.game && status.game !== 'penalty' ? status.game : null;
  const set = (patch: Partial<PenaltyConfig>) => saveSettings({ penalty: patch });

  async function open() {
    try {
      await api('/api/penalty/start', {});
      toast('Escolha de times aberta! O chat entra com !a ou !b ⚽', 'ok');
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  }

  return (
    <div className="grid">
      <div className="col">
        {active && penalty ? <LiveCard s={penalty} /> : penalty?.status === 'finished' && <ResultCard s={penalty} />}
        <Card title="Times" subtitle="Nome e cor da camisa (os times do seu chat, de dois jogos rivais, o que quiser)">
          <TeamField label="Time A (!a)" team={cfg.teamA} other={cfg.teamB} onChange={(t) => set({ teamA: { ...cfg.teamA, ...t } })} />
          <TeamField label="Time B (!b)" team={cfg.teamB} other={cfg.teamA} onChange={(t) => set({ teamB: { ...cfg.teamB, ...t } })} />
        </Card>
        <Card title="Como aparece na live">
          <Options
            name="pendisplay"
            value={cfg.fullscreen ? 'full' : 'window'}
            onChange={(v) => set({ fullscreen: v === 'full' })}
            options={[
              { value: 'full' as const, label: 'Tela cheia (recomendado)', hint: 'Estádio completo, torcida nas cores dos times' },
              { value: 'window' as const, label: 'Janela', hint: 'Só o gol e os jogadores, com fundo transparente, na posição do Overlay (OBS)' },
            ]}
          />
        </Card>
      </div>
      <div className="col">
        <Card title="Regras da partida">
          <div className="field">
            <span className="field-label">Tempo para escolher time</span>
            <Options tight name="pjoin" value={cfg.joinSec} onChange={(v) => set({ joinSec: v })} options={[30, 45, 60, 90].map((v) => ({ value: v, label: `${v}s` }))} />
          </div>
          <div className="field">
            <span className="field-label">Tempo de votação por cobrança</span>
            <Options tight name="pvote" value={cfg.voteSec} onChange={(v) => set({ voteSec: v })} options={[8, 10, 12, 15, 20].map((v) => ({ value: v, label: `${v}s` }))} />
            <small className="muted">Mais tempo ajuda quem assiste com atraso. 12 s é um bom meio-termo.</small>
          </div>
          <div className="field">
            <span className="field-label">Cobranças para cada time</span>
            <Options
              tight
              name="pkicks"
              value={cfg.kicks}
              onChange={(v) => set({ kicks: v })}
              options={[
                { value: 3, label: '3 (rápido)' },
                { value: 5, label: '5 (oficial)' },
              ]}
            />
            <small className="muted">Empatou? Morte súbita, uma cobrança para cada lado até alguém errar.</small>
          </div>
          <Check checked={cfg.fillBots} onChange={(v) => set({ fillBots: v })}>
            Time vazio vira time da CPU (dá para jogar até com um time só)
          </Check>
          {busy && <p className="chat-error">{BUSY_TEXT[busy]} Um jogo por vez: espere terminar.</p>}
          <div className="actions">
            <button className="btn primary lg" disabled={active || !!busy} onClick={open}>
              ⚽ Abrir escolha de times
            </button>
            <button
              className="btn danger lg"
              disabled={!active}
              onClick={async () => {
                await api('/api/penalty/stop', {});
                toast('Disputa de pênaltis encerrada.');
              }}
            >
              Encerrar
            </button>
          </div>
          <p className="muted foot-note">
            Seus mods também abrem com <kbd>!penaltis iniciar</kbd> e encerram com <kbd>!penaltis parar</kbd>.
          </p>
        </Card>
      </div>
    </div>
  );
}

function LiveCard({ s }: { s: PenaltySnapshot }) {
  const { toast, clockOffset } = useApp();
  useTick(500);
  const now = Date.now() + clockOffset;
  const [a, b] = s.teams;
  const lobby = s.status === 'lobby';
  const ends = lobby ? s.lobbyEndsAt : s.phaseEndsAt;
  return (
    <Card title={STATUS_LABEL[s.status]} right={<span className="pill live">Ao vivo</span>}>
      <div className="pen-live">
        <div style={{ ['--c' as string]: a.color }}>
          <b>{a.name}</b>
          <span>{nf.format(a.players)} no time</span>
        </div>
        <strong>
          {a.score} x {b.score}
        </strong>
        <div className="r" style={{ ['--c' as string]: b.color }}>
          <b>{b.name}</b>
          <span>{nf.format(b.players)} no time</span>
        </div>
      </div>
      <p className="muted foot-note">
        {lobby
          ? `Começa em ${Math.max(0, Math.ceil(((ends ?? now) - now) / 1000))} s`
          : s.suddenDeath
            ? 'Morte súbita'
            : `Cobrança ${Math.min(s.round, s.kicks)} de ${s.kicks} · ${s.teams[s.kicking].name} bate${s.kicker ? ` (${s.kicker.name})` : ''}`}
        {s.status === 'vote' && ` · ${s.votes.kick + s.votes.keep} votos`}
      </p>
      {lobby && (
        <button
          className="btn block"
          style={{ marginTop: 12 }}
          onClick={async () => {
            await api('/api/penalty/go', {});
            toast('Bola no meio! ⚽', 'ok');
          }}
        >
          ⚽ Começar agora
        </button>
      )}
    </Card>
  );
}

function ResultCard({ s }: { s: PenaltySnapshot }) {
  const w = s.winner === null ? null : s.teams[s.winner];
  return (
    <Card title="Última partida">
      <p style={{ margin: 0, fontWeight: 700 }}>
        {w ? `🏆 ${w.name} venceu: ${s.teams[0].name} ${s.teams[0].score} x ${s.teams[1].score} ${s.teams[1].name}` : 'Sem vencedor.'}
      </p>
      {s.mvp && <p className="muted foot-note">⭐ Craque da torcida: {s.mvp.name}</p>}
    </Card>
  );
}

function CommandsTab() {
  const { me } = useApp();
  const cfg = me!.settings.penalty;
  return (
    <div className="grid">
      <Card title="Para o chat" subtitle="Mostre isso para o seu público">
        <div className="cmds">
          <div className="cmd">
            <kbd>!a</kbd>
            <p>
              Entra no time <b>{cfg.teamA.name}</b>.
            </p>
          </div>
          <div className="cmd">
            <kbd>!b</kbd>
            <p>
              Entra no time <b>{cfg.teamB.name}</b>.
            </p>
          </div>
          <div className="cmd">
            <kbd>!entrar</kbd>
            <p>Cai no time com menos gente. Quem votar sem time também entra no menor.</p>
          </div>
          <div className="cmd">
            <kbd>!esq · !meio · !dir</kbd>
            <p>
              Em cada cobrança: <b>quem bate</b> escolhe o canto, <b>quem defende</b> escolhe para onde o goleiro pula. Lado da tela. A maioria decide.
            </p>
          </div>
        </div>
      </Card>
      <Card title="Como funciona" subtitle="Votação em janela, sem precisar de reflexo">
        <div className="cmds">
          <div className="cmd">
            <kbd>🗳️</kbd>
            <p>As duas torcidas votam ao mesmo tempo, sem ver o voto do outro time. Os percentuais aparecem depois do chute.</p>
          </div>
          <div className="cmd">
            <kbd>🧤</kbd>
            <p>Goleiro no canto certo pega na maioria das vezes, mas não sempre. Fora do canto, a bola ainda pode ir na trave ou para fora.</p>
          </div>
          <div className="cmd">
            <kbd>⚡</kbd>
            <p>Decisão antecipada quando não dá mais para empatar. Empatou nas cobranças? Morte súbita.</p>
          </div>
          <div className="cmd">
            <kbd>⭐</kbd>
            <p>O craque da torcida é quem mais acertou o voto no time campeão.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
