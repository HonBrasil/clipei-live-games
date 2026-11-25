import { Link, useSearchParams } from 'react-router-dom';
import { DEFENSE_CLASSES, DEFENSE_CLASS_IDS, DEFENSE_MONSTERS, DEFENSE_UPGRADES, DEFENSE_UPGRADE_IDS, type DefenseConfig, type DefenseSnapshot } from '@clipei/shared';
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

const STATUS_LABEL: Record<DefenseSnapshot['status'], string> = {
  idle: 'Parado',
  lobby: 'Inscrições abertas',
  wave: 'Onda chegando',
  vote: 'Votação de melhoria',
  finished: 'Terminou',
  stopped: 'Encerrado',
};

export const isDefenseActive = (s: DefenseSnapshot | null) => !!s && (s.status === 'lobby' || s.status === 'wave' || s.status === 'vote');

const fmt = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export function DefensePage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('aba')) ? params.get('aba') : 'partida') as Tab;
  const { defense } = useApp();
  const active = isDefenseActive(defense);
  return (
    <>
      <section className="hero">
        <div>
          <p className="crumbs">
            <Link to="/app/jogos">Minigames</Link> / Defesa da Base
          </p>
          <h1>
            Defesa da <span>Base</span>
          </h1>
          <p>Monstros chegam em ondas e cada pessoa do chat vira uma torre: arqueiro, mago ou canhão. Entre as ondas o chat vota a melhoria. Se a base cair, acabou.</p>
        </div>
        {active && defense && (
          <div className="hero-live">
            <span className="pill live">Ao vivo</span>
            <b>{defense.status === 'lobby' ? STATUS_LABEL.lobby : `Onda ${defense.wave} de ${defense.waves}`}</b>
            <small>
              {nf.format(defense.towers.length)} torres · base {defense.baseHp}/{defense.baseMax}
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
      ) : tab === 'apoios' ? (
        <div className="grid one">
          <GameSupportCard game="defense" />
        </div>
      ) : (
        <CommandsTab />
      )}
    </>
  );
}

function MatchTab() {
  const { me, defense, status, toast, saveSettings } = useApp();
  const cfg = me!.settings.defense;
  const active = isDefenseActive(defense);
  const busy = status?.game && status.game !== 'defense' ? status.game : null;
  const set = (patch: Partial<DefenseConfig>) => saveSettings({ defense: patch });

  async function open() {
    try {
      await api('/api/defense/start', cfg);
      toast('Inscrições abertas! O chat vira torre com !arqueiro, !mago ou !canhao 🏰', 'ok');
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  }

  return (
    <div className="grid">
      <div className="col">
        {active && defense ? <LiveCard s={defense} /> : defense?.status === 'finished' && <ResultCard s={defense} />}
        <Card title="Como aparece na live">
          <Options
            name="defdisplay"
            value={cfg.fullscreen ? 'full' : 'window'}
            onChange={(v) => set({ fullscreen: v === 'full' })}
            options={[
              { value: 'full' as const, label: 'Tela cheia (recomendado)', hint: 'O mapa ocupa a tela toda durante a partida' },
              { value: 'window' as const, label: 'Janela', hint: 'Mapa menor e sem fundo, na posição e no tamanho do Overlay (OBS)' },
            ]}
          />
          <p className="muted" style={{ marginTop: 10 }}>
            Vale só para a Defesa da Base. Os outros jogos seguem o modo escolhido em <Link to="/app/overlay">Overlay (OBS)</Link>.
          </p>
        </Card>
        <Card title="As torres" subtitle="Cada pessoa escolhe a sua">
          <div className="def-cls-list">
            {DEFENSE_CLASS_IDS.map((c) => {
              const d = DEFENSE_CLASSES[c];
              return (
                <div key={c} style={{ ['--c' as string]: d.color }}>
                  <span aria-hidden="true">{d.emoji}</span>
                  <b>
                    {d.name} <kbd>!{c}</kbd>
                  </b>
                  <small>{d.desc}</small>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
      <div className="col">
        <Card title="Regras da partida">
          <div className="field">
            <span className="field-label">Tempo de inscrição</span>
            <Options tight name="djoin" value={cfg.joinSec} onChange={(v) => set({ joinSec: v })} options={[30, 60, 90, 120].map((v) => ({ value: v, label: `${v}s` }))} />
          </div>
          <div className="field">
            <span className="field-label">Ondas para vencer</span>
            <Options
              tight
              name="dwaves"
              value={cfg.waves}
              onChange={(v) => set({ waves: v })}
              options={[
                { value: 5, label: '5 · rápida' },
                { value: 8, label: '8 · normal' },
                { value: 12, label: '12 · longa' },
              ]}
            />
            <small className="muted">Cada onda leva perto de 1 minuto, mais a votação. A última sempre traz o Rei Ogro.</small>
          </div>
          <div className="field">
            <span className="field-label">Dificuldade</span>
            <Options
              tight
              name="ddiff"
              value={cfg.difficulty}
              onChange={(v) => set({ difficulty: v })}
              options={[
                { value: 'facil' as const, label: '🙂 Fácil' },
                { value: 'normal' as const, label: '😤 Normal' },
                { value: 'dificil' as const, label: '💀 Difícil' },
              ]}
            />
            <small className="muted">Os monstros ficam mais fortes quanto mais gente entra. No normal o chat vence uns 2 de cada 3 jogos.</small>
          </div>
          <div className="field">
            <span className="field-label">Votação entre as ondas</span>
            <Options tight name="dvote" value={cfg.voteSec} onChange={(v) => set({ voteSec: v })} options={[10, 15, 20, 30].map((v) => ({ value: v, label: `${v}s` }))} />
          </div>
          <div className="field">
            <span className="field-label">
              <label htmlFor="dmax">Máximo de torres</label>
              <output>{cfg.maxPlayers}</output>
            </span>
            <input id="dmax" type="range" min={6} max={68} step={2} value={Math.min(68, cfg.maxPlayers)} onChange={(e) => set({ maxPlayers: Number(e.target.value) })} />
          </div>
          <Check checked={cfg.fillBots} onChange={(v) => set({ fillBots: v })}>
            Completar com torres CPU até 6 (recomendado para chat pequeno)
          </Check>
          {busy && <p className="chat-error">{BUSY_TEXT[busy]} Um jogo por vez: espere terminar.</p>}
          <div className="actions">
            <button className="btn primary lg" disabled={active || !!busy} onClick={open}>
              🏰 Abrir inscrições
            </button>
            <button
              className="btn danger lg"
              disabled={!active}
              onClick={async () => {
                await api('/api/defense/stop', {});
                toast('Defesa da Base encerrada.');
              }}
            >
              Encerrar
            </button>
          </div>
          <p className="muted foot-note">
            Seus mods também abrem com <kbd>!defesa iniciar</kbd>, começam na hora com <kbd>!defesa comecar</kbd> e encerram com <kbd>!defesa parar</kbd>.
          </p>
        </Card>
      </div>
    </div>
  );
}

function LiveCard({ s }: { s: DefenseSnapshot }) {
  const { toast, clockOffset } = useApp();
  useTick(500);
  const now = Date.now() + clockOffset;
  const lobby = s.status === 'lobby';
  const ratio = s.baseHp / Math.max(1, s.baseMax);
  return (
    <Card title={STATUS_LABEL[s.status]} right={<span className="pill live">Ao vivo</span>}>
      <div className="race-live">
        <div>
          <b>{nf.format(lobby ? s.humans : s.towers.length)}</b>
          <span>{lobby ? 'inscritos' : 'torres'}</span>
        </div>
        <div>
          <b>{lobby ? fmt((s.lobbyEndsAt ?? now) - now) : `${s.wave}/${s.waves}`}</b>
          <span>{lobby ? 'para começar' : 'onda'}</span>
        </div>
        {!lobby && (
          <div>
            <b>{nf.format(s.kills)}</b>
            <span>monstros derrubados</span>
          </div>
        )}
      </div>
      {!lobby && (
        <div className="def-base-bar" aria-label={`Vida da base ${s.baseHp} de ${s.baseMax}`}>
          <span>🏰 Base</span>
          <i>
            <em style={{ width: `${Math.max(0, ratio) * 100}%`, background: ratio > 0.5 ? '#3ddc6b' : ratio > 0.25 ? '#ffc83d' : '#ff4d5e' }} />
          </i>
          <b>
            {s.baseHp}/{s.baseMax}
          </b>
        </div>
      )}
      {s.status === 'vote' && (
        <div className="def-votes">
          {DEFENSE_UPGRADE_IDS.map((u) => (
            <span key={u} style={{ ['--c' as string]: DEFENSE_UPGRADES[u].color }}>
              {DEFENSE_UPGRADES[u].emoji} {DEFENSE_UPGRADES[u].name} <b>{s.votes[u]}</b>
            </span>
          ))}
        </div>
      )}
      {!lobby && DEFENSE_UPGRADE_IDS.some((u) => s.upgrades[u]) && (
        <p className="muted foot-note">
          Melhorias:{' '}
          {DEFENSE_UPGRADE_IDS.filter((u) => s.upgrades[u])
            .map((u) => `${DEFENSE_UPGRADES[u].emoji} ${DEFENSE_UPGRADES[u].name} ${s.upgrades[u]}`)
            .join(' · ')}
        </p>
      )}
      {lobby && (
        <button
          className="btn block"
          style={{ marginTop: 12 }}
          onClick={async () => {
            await api('/api/defense/go', {});
            toast('Lá vêm eles! 🏰', 'ok');
          }}
        >
          🏰 Começar agora
        </button>
      )}
    </Card>
  );
}

function ResultCard({ s }: { s: DefenseSnapshot }) {
  return (
    <Card title="Última partida" subtitle={`${nf.format(s.kills)} monstros derrubados`}>
      <p style={{ margin: 0, fontWeight: 700 }}>{s.result === 'won' ? `🏆 A base resistiu às ${s.waves} ondas!` : `💥 A base caiu na onda ${s.wave} de ${s.waves}.`}</p>
      {s.mvp.length > 0 && (
        <ol className="race-leaders">
          {s.mvp.map((m) => (
            <li key={m.name}>
              <i style={{ background: m.color }} />
              {m.name}
              <em>
                {DEFENSE_CLASSES[m.cls].emoji} {nf.format(m.dmg)} de dano · {m.kills} abates
              </em>
            </li>
          ))}
        </ol>
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
            <kbd>!arqueiro</kbd>
            <p>
              Vira uma torre de <b>arqueiro</b>: atira rápido e de longe. Também vale <b>!mago</b> e <b>!canhao</b>. Dá para entrar no meio da partida.
            </p>
          </div>
          <div className="cmd">
            <kbd>!atk</kbd>
            <p>
              Carrega um <b>tiro forte</b> (3x o dano) na sua torre. Recarga de 8 s.
            </p>
          </div>
          <div className="cmd">
            <kbd>!muralha</kbd>
            <p>
              Entre as ondas, vote a melhoria: <b>!muralha</b> conserta a base, <b>!gelo</b> deixa os monstros lentos, <b>!fogo</b> aumenta o dano. Na votação também dá para trocar de torre.
            </p>
          </div>
        </div>
      </Card>
      <Card title="Os monstros" subtitle="Cada onda vem mais forte">
        <div className="cmds">
          <div className="cmd">
            <kbd>👺</kbd>
            <p>
              <b>Goblin</b>: o comum, vem em grupo. Canhão é o melhor contra eles. Tira {DEFENSE_MONSTERS.goblin.dmg} de vida da base.
            </p>
          </div>
          <div className="cmd">
            <kbd>🐺</kbd>
            <p>
              <b>Lobo</b>: rápido, chega em matilha de 3. Arqueiro pega de longe.
            </p>
          </div>
          <div className="cmd">
            <kbd>👹</kbd>
            <p>
              <b>Ogro</b>: lento e de armadura. Flechas e balas perdem força nele, a magia do mago não. Tira {DEFENSE_MONSTERS.ogro.dmg} da base.
            </p>
          </div>
          <div className="cmd">
            <kbd>👑</kbd>
            <p>
              <b>Rei Ogro</b>: o chefe da última onda. Se chegar na base, tira {DEFENSE_MONSTERS.rei.dmg} de vida.
            </p>
          </div>
        </div>
      </Card>
      <Card title="Para você e seus mods">
        <div className="cmds">
          <div className="cmd">
            <kbd>!defesa iniciar</kbd>
            <p>
              Abre as inscrições. <b>!defesa comecar</b> pula a espera e <b>!defesa parar</b> encerra.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
