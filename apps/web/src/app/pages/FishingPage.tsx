import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FISH_RARITIES, FISH_RARITY_ORDER, FISH_SPECIES, type FishingConfig, type FishingCorner, type FishingRankPos, type FishingRankRow, type FishingStats } from '@clipei/shared';
import { api, nf } from '../api.ts';
import { Card, Check, Options, Switch } from '../components/ui.tsx';
import { GameSupportCard } from '../components/GameSupport.tsx';
import { BUSY_TEXT } from '../components/busy.ts';
import { useApp } from '../state.tsx';

const TABS = [
  { id: 'pescaria', label: 'Pescaria' },
  { id: 'ranking', label: 'Ranking' },
  { id: 'colecao', label: 'Coleção' },
  { id: 'apoios', label: 'Apoios' },
  { id: 'comandos', label: 'Comandos' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const kg = (v: number) => (v < 1 ? `${Math.round(v * 1000)} g` : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`);

/** Ranking e coleção do canal (atualiza a cada 15 s com a página aberta). */
function useFishingStats() {
  const [stats, setStats] = useState<FishingStats | null>(null);
  const load = useCallback(() => {
    fetch('/api/fishing/stats', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: FishingStats | null) => s && setStats(s))
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);
  return { stats, reload: load };
}

export function FishingPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('aba')) ? params.get('aba') : 'pescaria') as Tab;
  const { me, fishing } = useApp();
  const on = me?.settings.fishing.enabled;
  const { stats, reload } = useFishingStats();
  return (
    <>
      <section className="hero">
        <div>
          <p className="crumbs">
            <Link to="/app/jogos">Minigames</Link> / Pescaria
          </p>
          <h1>
            Pescaria da <span>Live</span>
          </h1>
          <p>Um lago discreto num canto da tela. O chat pesca quando quiser, monta a coleção e disputa o ranking da semana, que zera toda segunda.</p>
        </div>
        {on && (
          <div className="hero-live">
            <span className="pill live">{fishing?.paused ? 'Pausada' : 'Ligada'}</span>
            <b>{nf.format(fishing?.casters.length ?? 0)} pescando</b>
            <small>{fishing?.paused ? 'volta quando o outro jogo acabar' : fishing?.shoalUntil ? '🐟 cardume no lago' : `${nf.format(stats?.totalCatches ?? 0)} peixes no total`}</small>
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
      {tab === 'pescaria' ? (
        <MainTab reload={reload} />
      ) : tab === 'ranking' ? (
        <RankingTab stats={stats} />
      ) : tab === 'colecao' ? (
        <CollectionTab stats={stats} />
      ) : tab === 'apoios' ? (
        <div className="grid one">
          <GameSupportCard game="fishing" />
        </div>
      ) : (
        <CommandsTab />
      )}
    </>
  );
}

function MainTab({ reload }: { reload: () => void }) {
  const { me, fishing, status, toast, saveSettings } = useApp();
  const cfg = me!.settings.fishing;
  const set = (patch: Partial<FishingConfig>) => saveSettings({ fishing: patch });
  const busy = status?.game ?? null;
  return (
    <div className="grid">
      <div className="col">
        <Card title="Pescaria no ar" right={<Switch label="Pescaria ligada" checked={cfg.enabled} onChange={(v) => set({ enabled: v })} />}>
          <p className="muted" style={{ marginTop: 0 }}>
            {cfg.enabled
              ? 'Ligada: o lago aparece no OBS quando alguém pesca. Se você abrir outro minigame, ela pausa sozinha e volta quando ele terminar.'
              : 'Desligada. Ligue para deixar o chat pescar a live inteira (seus mods também ligam com !pescaria ligar).'}
          </p>
          {cfg.enabled && busy && <p className="chat-error">{BUSY_TEXT[busy]} A pescaria está pausada até ele terminar.</p>}
          {cfg.enabled && (
            <div className="actions">
              <button
                className="btn primary"
                disabled={!!busy || !!fishing?.shoalUntil}
                onClick={async () => {
                  try {
                    await api('/api/fishing/shoal', {});
                    toast('Cardume solto no lago! 🐟', 'ok');
                    reload();
                  } catch (err) {
                    toast((err as Error).message, 'err');
                  }
                }}
              >
                🐟 {fishing?.shoalUntil ? 'Cardume no lago' : 'Soltar cardume'}
              </button>
            </div>
          )}
          <p className="muted foot-note">Cardume: sorte e pontos em dobro e espera pela metade por alguns minutos. Também vem com raid, e os mods soltam com !cardume.</p>
        </Card>
        <Card title="Onde aparece" subtitle="Escolha o que mover e clique no lugar da tela">
          <ScreenMap cfg={cfg} set={set} />
          <div className="field">
            <span className="field-label">Fundo do lago</span>
            <Options
              tight
              name="fscene"
              value={cfg.scene}
              onChange={(v) => set({ scene: v })}
              options={[
                { value: 'transparent' as const, label: 'Transparente' },
                { value: 'full' as const, label: 'Cenário completo' },
              ]}
            />
            <small className="muted">Transparente mostra só a água por cima do jogo. Cenário completo é um cartão com céu e mata.</small>
          </div>
          <div className="field">
            <span className="field-label">Pessoas no ranking</span>
            <Options tight name="ftop" value={cfg.rankTop} onChange={(v) => set({ rankTop: v })} options={[3, 5, 10].map((v) => ({ value: v as 3 | 5 | 10, label: `Top ${v}` }))} />
          </div>
          <Check checked={cfg.hint} onChange={(v) => set({ hint: v })}>
            Mostrar o lembrete "🎣 !pescar" quando ninguém está pescando
          </Check>
        </Card>
      </div>
      <div className="col">
        <Card title="Regras">
          <div className="field">
            <span className="field-label">Espera entre lançamentos (por pessoa)</span>
            <Options
              tight
              name="fcool"
              value={cfg.cooldownSec}
              onChange={(v) => set({ cooldownSec: v })}
              options={[30, 60, 120, 300].map((v) => ({ value: v, label: v < 60 ? `${v}s` : `${v / 60} min` }))}
            />
            <small className="muted">Espera menor = mais pesca e mais movimento no chat.</small>
          </div>
          <div className="field">
            <span className="field-label">O bot anuncia no chat</span>
            <Options
              tight
              name="fann"
              value={cfg.announce}
              onChange={(v) => set({ announce: v })}
              options={[
                { value: 'raro' as const, label: 'Raro ou melhor' },
                { value: 'epico' as const, label: 'Épico ou melhor' },
                { value: 'lendario' as const, label: 'Só lendário' },
                { value: 'nunca' as const, label: 'Nunca' },
              ]}
            />
          </div>
          <div className="fish-odds">
            {FISH_RARITY_ORDER.map((r) => (
              <span key={r} style={{ ['--rc' as string]: FISH_RARITIES[r].color }}>
                <b>{FISH_RARITIES[r].label}</b> {FISH_RARITIES[r].weight}% · {FISH_RARITIES[r].points ? `${FISH_RARITIES[r].points} pts` : '0 pts'}
              </span>
            ))}
          </div>
          <p className="muted foot-note">Chances de cada pesca sem sorte extra. Peixe mais pesado vale mais pontos.</p>
        </Card>
      </div>
    </div>
  );
}

const CELLS: (FishingRankPos | null)[] = ['tl', 'tc', 'tr', 'ml', null, 'mr', 'bl', 'bc', 'br'];
const CORNERS: FishingCorner[] = ['tl', 'tr', 'bl', 'br'];
const POS_LABEL: Record<string, string> = {
  tl: 'no canto superior esquerdo',
  tc: 'no topo, ao centro',
  tr: 'no canto superior direito',
  ml: 'na lateral esquerda',
  mr: 'na lateral direita',
  bl: 'no canto inferior esquerdo',
  bc: 'embaixo, ao centro',
  br: 'no canto inferior direito',
};

/** Mapa da tela do OBS: o streamer escolhe onde ficam o lago e o ranking clicando. */
function ScreenMap({ cfg, set }: { cfg: FishingConfig; set: (p: Partial<FishingConfig>) => void }) {
  const [moving, setMoving] = useState<'lake' | 'rank'>('rank');
  const rankAt = cfg.rankPos === cfg.corner ? 'lake' : cfg.rankPos;
  return (
    <div className="screen-map-wrap">
      <div className="sm-seg" role="radiogroup" aria-label="O que mover">
        <button role="radio" aria-checked={moving === 'rank'} className={moving === 'rank' ? 'on' : ''} onClick={() => setMoving('rank')}>
          🏆 Ranking
        </button>
        <button role="radio" aria-checked={moving === 'lake'} className={moving === 'lake' ? 'on' : ''} onClick={() => setMoving('lake')}>
          🎣 Lago
        </button>
      </div>
      <div className="screen-map" aria-label="Tela do OBS">
        {CELLS.map((c, i) => {
          if (!c)
            return (
              <span key={i} className="sm-cell sm-game">
                seu jogo
              </span>
            );
          const lake = cfg.corner === c;
          const rank = rankAt === c || (lake && rankAt === 'lake' && cfg.rankPos !== 'off');
          const can = moving === 'rank' || CORNERS.includes(c as FishingCorner);
          return (
            <button
              key={c}
              className={`sm-cell ${lake ? 'has-lake' : ''} ${rank && !lake ? 'has-rank' : ''} ${can ? '' : 'is-off'}`}
              disabled={!can}
              title={can ? `${moving === 'rank' ? 'Ranking' : 'Lago'} ${POS_LABEL[c]}` : 'O lago só fica nos cantos'}
              onClick={() => (moving === 'rank' ? set({ rankPos: lake ? 'lake' : c }) : set({ corner: c as FishingCorner }))}
            >
              {lake && <b>🎣 Lago{rank ? ' + 🏆' : ''}</b>}
              {rank && !lake && <b>🏆 Ranking</b>}
            </button>
          );
        })}
      </div>
      <div className="sm-foot">
        <small className="muted">
          {cfg.rankPos === 'off'
            ? 'Ranking escondido no OBS (o chat ainda vê com !ranking).'
            : rankAt === 'lake'
              ? 'Ranking embaixo do lago, só aparece quando alguém pesca.'
              : `Ranking fixo ${POS_LABEL[rankAt]}, sempre visível com a pescaria ligada.`}
        </small>
        {moving === 'rank' && (
          <button className="btn sm" onClick={() => set({ rankPos: cfg.rankPos === 'off' ? 'lake' : 'off' })}>
            {cfg.rankPos === 'off' ? 'Mostrar ranking' : 'Esconder ranking'}
          </button>
        )}
      </div>
    </div>
  );
}

function RankTable({ rows, empty }: { rows: FishingRankRow[]; empty: string }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <ol className="race-leaders fish-rank">
      {rows.map((r) => (
        <li key={r.name}>
          <i style={{ background: r.color }} />
          {r.name}
          <em>
            {nf.format(r.points)} pts · {nf.format(r.catches)} {r.catches === 1 ? 'peixe' : 'peixes'}
          </em>
        </li>
      ))}
    </ol>
  );
}

function RankingTab({ stats }: { stats: FishingStats | null }) {
  return (
    <div className="grid">
      <Card title="Ranking da semana" subtitle={stats ? `Semana ${stats.week.split('-W')[1]} · zera toda segunda à meia-noite` : ''}>
        <RankTable rows={stats?.weekTop ?? []} empty="Ninguém pescou nesta semana ainda." />
      </Card>
      <div className="col">
        <Card title="Pódio da semana passada">
          <RankTable rows={stats?.lastWeekTop ?? []} empty="Ainda não teve uma semana completa." />
        </Card>
        <Card title="De todos os tempos" subtitle={stats ? `${nf.format(stats.players)} pescadores · ${nf.format(stats.totalCatches)} peixes` : ''}>
          <RankTable rows={stats?.allTime ?? []} empty="Sem pescas ainda." />
          {stats?.biggest && (
            <p className="muted foot-note">
              🏆 Maior peixe do canal: {FISH_SPECIES.find((f) => f.id === stats.biggest!.fish)?.name} de {kg(stats.biggest.kg)}, de {stats.biggest.name}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

function CollectionTab({ stats }: { stats: FishingStats | null }) {
  return (
    <Card title="Coleção do lago" subtitle="Quantas vezes cada peixe já saiu no seu canal. Cada pessoa vê a própria coleção com !peixes.">
      <div className="fish-grid">
        {FISH_SPECIES.map((f) => {
          const n = stats?.species[f.id] ?? 0;
          const r = FISH_RARITIES[f.rarity];
          return (
            <div key={f.id} className={`fish-cell ${n ? '' : 'is-locked'}`} style={{ ['--rc' as string]: r.color, ['--fc' as string]: f.color }}>
              <span className="fish-icon" aria-hidden="true">
                {f.rarity === 'lixo' ? '🗑️' : <i />}
              </span>
              <b>{n ? f.name : '???'}</b>
              <small>
                {r.label} · {kg(f.min)}–{kg(f.max)}
              </small>
              <em>{n ? `${nf.format(n)}×` : 'ninguém pegou'}</em>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function CommandsTab() {
  return (
    <div className="grid">
      <Card title="Para o chat" subtitle="Mostre isso para o seu público">
        <div className="cmds">
          <div className="cmd">
            <kbd>!pescar</kbd>
            <p>Lança a linha. Em alguns segundos sai um peixe (ou uma bota velha). Depois é só esperar para lançar de novo.</p>
          </div>
          <div className="cmd">
            <kbd>!peixes</kbd>
            <p>O bot responde com seus pontos da semana, posição, coleção e o maior peixe que você já pegou.</p>
          </div>
          <div className="cmd">
            <kbd>!ranking</kbd>
            <p>Top 3 da semana no chat.</p>
          </div>
        </div>
      </Card>
      <Card title="Para você e seus mods">
        <div className="cmds">
          <div className="cmd">
            <kbd>!pescaria ligar</kbd>
            <p>
              Liga a pescaria (<kbd>!pescaria desligar</kbd> desliga).
            </p>
          </div>
          <div className="cmd">
            <kbd>!cardume</kbd>
            <p>Solta um cardume: sorte e pontos em dobro por alguns minutos.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
