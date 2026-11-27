import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CHALLENGE_LIMITS, type ChallengeConfig, type ChallengeItem, type ChallengeSnapshot } from '@clipei/shared';
import { api, nf } from '../api.ts';
import { Card, Options, Switch } from '../components/ui.tsx';
import { BUSY_TEXT } from '../components/busy.ts';
import { GameSupportCard } from '../components/GameSupport.tsx';
import { useApp, useTick } from '../state.tsx';

const TABS = [
  { id: 'desafios', label: 'Meus desafios' },
  { id: 'votacao', label: 'Votação' },
  { id: 'sugestoes', label: 'Sugestões do chat' },
  { id: 'apoios', label: 'Apoios' },
  { id: 'comandos', label: 'Comandos' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const MINUTES = [0, 1, 2, 3, 5, 10, 15, 20, 30, 45, 60];
const minLabel = (m: number) => (m ? `${m} min` : 'Até cumprir');
const RESULT: Record<string, string> = { done: '✅ Cumprido', failed: '❌ Não rolou', timeout: '⏰ Tempo esgotado', skipped: '🎯 Cancelado' };
const clock = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const newId = () => `u${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

/** Ideias prontas para o streamer adicionar com um clique. */
const IDEAS: { text: string; minutes: number }[] = [
  { text: 'Jogar com a mão errada no mouse', minutes: 3 },
  { text: 'Responder o chat só rimando', minutes: 3 },
  { text: 'Imitar um personagem famoso', minutes: 2 },
  { text: 'Beber um copo de água', minutes: 0 },
  { text: 'Só falar sussurrando', minutes: 3 },
  { text: 'Contar uma história constrangedora', minutes: 0 },
  { text: 'Trocar o fundo da câmera', minutes: 0 },
  { text: 'Jogar sem mira na tela', minutes: 5 },
];

export function ChallengePage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('aba')) ? params.get('aba') : 'desafios') as Tab;
  const { me, challenge } = useApp();
  const pending = me!.settings.challenge.pending.length;
  return (
    <>
      <section className="hero">
        <div>
          <p className="crumbs">
            <Link to="/app/jogos">Minigames</Link> / Desafios do Chat
          </p>
          <h1>
            Desafios do <span>Chat</span>
          </h1>
          <p>Você monta a lista de desafios, o chat vota com !1, !2 ou !3 e o mais votado vale. Ele fica numa faixa no topo da tela com o tempo correndo, sem atrapalhar o seu jogo.</p>
        </div>
        {challenge && challenge.status !== 'idle' && (
          <div className="hero-live">
            <span className="pill live">{challenge.status === 'vote' ? 'Votação' : challenge.status === 'active' ? 'Valendo' : 'Resultado'}</span>
            <b>{challenge.status === 'vote' ? `${challenge.options.length} opções` : challenge.current?.text}</b>
            <small>{challenge.status === 'vote' ? `${nf.format(challenge.voters)} votos` : `${nf.format(challenge.current?.votes ?? 0)} votos`}</small>
          </div>
        )}
      </section>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => setParams({ aba: t.id })}>
            {t.label}
            {t.id === 'sugestoes' && pending > 0 && <span className="tab-badge">{pending}</span>}
          </button>
        ))}
      </div>
      {tab === 'desafios' ? (
        <ListTab />
      ) : tab === 'votacao' ? (
        <VoteTab />
      ) : tab === 'sugestoes' ? (
        <SuggestionsTab />
      ) : tab === 'apoios' ? (
        <div className="grid one">
          <GameSupportCard game="challenge" />
        </div>
      ) : (
        <CommandsTab />
      )}
    </>
  );
}

// ─── Lista de desafios (personalização) ─────────────────────

function ListTab() {
  const { me, saveSettings, toast } = useApp();
  const saved = me!.settings.challenge.list;
  const [list, setList] = useState<ChallengeItem[]>(saved);
  const [text, setText] = useState('');
  const [minutes, setMinutes] = useState(5);
  const [filter, setFilter] = useState('');
  const savedKey = JSON.stringify(saved);
  useEffect(() => setList(saved), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(list) !== savedKey;
  const on = list.filter((i) => i.enabled).length;
  const full = list.length >= CHALLENGE_LIMITS.items;
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? list.filter((i) => i.text.toLowerCase().includes(f)) : list;
  }, [list, filter]);

  const patch = (id: string, p: Partial<ChallengeItem>) => setList((l) => l.map((i) => (i.id === id ? { ...i, ...p } : i)));
  const move = (id: string, d: -1 | 1) =>
    setList((l) => {
      const i = l.findIndex((x) => x.id === id);
      const j = i + d;
      if (i < 0 || j < 0 || j >= l.length) return l;
      const n = [...l];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  function add(t = text, m = minutes) {
    const clean = t.replace(/\s+/g, ' ').trim().slice(0, CHALLENGE_LIMITS.text);
    if (!clean) return;
    if (list.some((i) => i.text.toLowerCase() === clean.toLowerCase())) return toast('Esse desafio já está na lista.', 'err');
    if (full) return toast(`Limite de ${CHALLENGE_LIMITS.items} desafios.`, 'err');
    setList((l) => [{ id: newId(), text: clean, minutes: m, enabled: true }, ...l]);
    if (t === text) setText('');
  }
  async function save() {
    await saveSettings({ challenge: { list } });
    toast('Desafios salvos ✔', 'ok');
  }
  const ideas = IDEAS.filter((i) => !list.some((x) => x.text.toLowerCase() === i.text.toLowerCase()));

  return (
    <div className="grid">
      <div className="col">
        <Card title="Novo desafio" subtitle="Escreva como o chat vai ler na tela">
          <form
            className="ch-add"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <input className="input" value={text} maxLength={CHALLENGE_LIMITS.text} placeholder="Ex.: Jogar só de faca por 5 minutos" onChange={(e) => setText(e.target.value)} />
            <select className="input" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="Duração">
              {MINUTES.map((m) => (
                <option key={m} value={m}>
                  {minLabel(m)}
                </option>
              ))}
            </select>
            <button className="btn primary" disabled={!text.trim() || full}>
              Adicionar
            </button>
          </form>
          <small className="muted">
            {text.length}/{CHALLENGE_LIMITS.text} caracteres · "Até cumprir" não tem relógio: vale até você marcar cumprido ou falhou.
          </small>
          {ideas.length > 0 && (
            <div className="ch-ideas">
              <span className="field-label">Ideias rápidas</span>
              <div>
                {ideas.map((i) => (
                  <button key={i.text} type="button" className="chip" onClick={() => add(i.text, i.minutes)}>
                    + {i.text}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
        <Card title="Dicas para bons desafios">
          <ul className="ch-tips">
            <li>Curtos e visuais funcionam melhor: o chat lê em 2 segundos.</li>
            <li>Misture desafios rápidos (1 a 3 min) com alguns mais longos.</li>
            <li>Evite nada que quebre as regras da plataforma ou coloque alguém em risco.</li>
            <li>Desative em vez de apagar os que não combinam com o jogo do dia.</li>
          </ul>
        </Card>
      </div>
      <div className="col">
        <Card
          title={`Sua lista (${list.length})`}
          subtitle={`${on} ${on === 1 ? 'ativo' : 'ativos'} · entram na votação só os ativos`}
          right={
            <button className="btn primary" disabled={!dirty} onClick={save}>
              {dirty ? 'Salvar' : 'Salvo'}
            </button>
          }
        >
          {list.length > 6 && <input className="input" value={filter} placeholder="Buscar na lista…" onChange={(e) => setFilter(e.target.value)} style={{ marginBottom: 10 }} />}
          {shown.length ? (
            <ul className="ch-list">
              {shown.map((i) => (
                <li key={i.id} className={i.enabled ? '' : 'is-off'}>
                  <Switch checked={i.enabled} onChange={(v) => patch(i.id, { enabled: v })} label={i.enabled ? 'Ativo' : 'Desativado'} />
                  <div className="ch-item">
                    <input className="input" value={i.text} maxLength={CHALLENGE_LIMITS.text} aria-label="Texto do desafio" onChange={(e) => patch(i.id, { text: e.target.value })} />
                    <div className="ch-item-meta">
                      <select className="input sm" value={MINUTES.includes(i.minutes) ? i.minutes : 5} aria-label="Duração" onChange={(e) => patch(i.id, { minutes: Number(e.target.value) })}>
                        {MINUTES.map((m) => (
                          <option key={m} value={m}>
                            ⏱️ {minLabel(m)}
                          </option>
                        ))}
                      </select>
                      {i.by && <span className="pill">💡 sugestão de {i.by}</span>}
                    </div>
                  </div>
                  <div className="ch-item-act">
                    {!filter && (
                      <>
                        <button className="icon-btn" aria-label="Subir" onClick={() => move(i.id, -1)}>
                          ↑
                        </button>
                        <button className="icon-btn" aria-label="Descer" onClick={() => move(i.id, 1)}>
                          ↓
                        </button>
                      </>
                    )}
                    <button className="icon-btn danger" aria-label="Apagar" onClick={() => setList((l) => l.filter((x) => x.id !== i.id))}>
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{filter ? 'Nada encontrado.' : 'Sua lista está vazia. Adicione desafios ao lado.'}</p>
          )}
          {dirty && (
            <div className="actions">
              <button className="btn" onClick={() => setList(saved)}>
                Desfazer
              </button>
              <button className="btn primary" onClick={save}>
                Salvar alterações
              </button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ─── Votação e desafio valendo ──────────────────────────────

function VoteTab() {
  const { me, challenge, status, saveSettings, toast } = useApp();
  const cfg = me!.settings.challenge;
  const set = (p: Partial<ChallengeConfig>) => saveSettings({ challenge: p });
  const active = cfg.list.filter((i) => i.enabled);
  const [pick, setPick] = useState<string[]>([]);
  const busy = status?.game && status.game !== 'challenge' ? status.game : null;
  const running = !!challenge && (challenge.status === 'vote' || challenge.status === 'active');

  async function call(path: string, body: unknown, ok: string) {
    try {
      await api(path, body);
      toast(ok, 'ok');
      setPick([]);
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  }
  const toggle = (id: string) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 5 ? p : [...p, id]));

  return (
    <div className="grid">
      <div className="col">
        {challenge && challenge.status !== 'idle' && <LiveCard s={challenge} />}
        <Card title="Regras da votação">
          <div className="field">
            <span className="field-label">Opções na votação</span>
            <Options tight name="chopt" value={cfg.options} onChange={(v) => set({ options: v })} options={[2, 3, 4, 5].map((v) => ({ value: v, label: `${v} opções` }))} />
          </div>
          <div className="field">
            <span className="field-label">Tempo de votação</span>
            <Options tight name="chsec" value={cfg.voteSec} onChange={(v) => set({ voteSec: v })} options={[20, 30, 45, 60, 90].map((v) => ({ value: v, label: `${v}s` }))} />
          </div>
          {busy && <p className="chat-error">{BUSY_TEXT[busy]} A votação ocupa a tela: espere terminar.</p>}
          <div className="actions">
            <button className="btn primary lg" disabled={running || !!busy || active.length < 2} onClick={() => call('/api/challenge/vote', {}, 'Votação no ar! O chat vota com !1, !2… 🎯')}>
              🎲 Votação com sorteio
            </button>
          </div>
          {active.length < 2 && <p className="chat-error">Ative pelo menos 2 desafios na aba "Meus desafios".</p>}
          <p className="muted foot-note">O sorteio evita repetir os últimos desafios. Para escolher as opções você mesmo, marque na lista ao lado.</p>
        </Card>
        <HistoryCard />
      </div>
      <div className="col">
        <Card title="Escolher as opções" subtitle={pick.length ? `${pick.length} marcados (máx. 5)` : 'Marque 2 a 5 para a votação, ou comece um direto'}>
          {active.length ? (
            <ul className="ch-pick">
              {active.map((i) => (
                <li key={i.id} className={pick.includes(i.id) ? 'is-on' : ''}>
                  <label>
                    <input type="checkbox" checked={pick.includes(i.id)} onChange={() => toggle(i.id)} />
                    <span>
                      <b>{i.text}</b>
                      <small>⏱️ {minLabel(i.minutes)}</small>
                    </span>
                  </label>
                  <button className="btn sm" disabled={running} onClick={() => call('/api/challenge/start', { id: i.id }, 'Desafio valendo! 🎯')}>
                    Valer agora
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nenhum desafio ativo.</p>
          )}
          <div className="actions">
            <button className="btn primary" disabled={pick.length < 2 || running || !!busy} onClick={() => call('/api/challenge/vote', { pick }, 'Votação no ar com as suas opções! 🎯')}>
              Abrir votação com {pick.length || ''} {pick.length === 1 ? 'opção' : 'opções'}
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function LiveCard({ s }: { s: ChallengeSnapshot }) {
  const { toast, clockOffset } = useApp();
  useTick(500);
  const now = Date.now() + clockOffset;
  const finish = async (result: 'done' | 'failed' | 'skipped', msg: string) => {
    await api('/api/challenge/finish', { result });
    toast(msg);
  };
  if (s.status === 'vote') {
    const total = Math.max(1, s.options.reduce((a, o) => a + o.votes, 0));
    return (
      <Card title="Votação no ar" right={<span className="pill live">{s.voteEndsAt ? clock(s.voteEndsAt - now) : 'Ao vivo'}</span>}>
        <ol className="ch-live-opts">
          {s.options.map((o, i) => (
            <li key={i}>
              <kbd>!{i + 1}</kbd>
              <span>{o.text}</span>
              <em>{o.votes}</em>
              <i style={{ width: `${Math.round((o.votes / total) * 100)}%` }} />
            </li>
          ))}
        </ol>
        <button className="btn block" style={{ marginTop: 12 }} onClick={() => finish('skipped', 'Votação cancelada.')}>
          Cancelar votação
        </button>
      </Card>
    );
  }
  if (!s.current) return null;
  return (
    <Card title={s.status === 'active' ? 'Desafio valendo' : 'Último desafio'} right={s.status === 'active' && <span className="pill live">{s.endsAt ? clock(s.endsAt - now) : 'Até cumprir'}</span>}>
      <p className="ch-now">🎯 {s.current.text}</p>
      <p className="muted">
        {nf.format(s.current.votes)} votos{s.status === 'done' && s.result ? ` · ${RESULT[s.result]}` : ''}
      </p>
      {s.status === 'active' && (
        <div className="actions">
          <button className="btn primary" onClick={() => finish('done', 'Desafio cumprido! ✅')}>
            ✅ Cumprido
          </button>
          <button className="btn" onClick={() => finish('failed', 'Desafio marcado como não cumprido.')}>
            ❌ Não rolou
          </button>
          <button className="btn danger" onClick={() => finish('skipped', 'Desafio cancelado.')}>
            Cancelar
          </button>
        </div>
      )}
    </Card>
  );
}

function HistoryCard() {
  const { me } = useApp();
  const h = me!.settings.challenge.history;
  const done = h.filter((x) => x.result === 'done').length;
  return (
    <Card title="Histórico" subtitle={h.length ? `${done} de ${h.length} cumpridos` : undefined}>
      {h.length ? (
        <ul className="ch-history">
          {h.map((x, i) => (
            <li key={i}>
              <span>{x.text}</span>
              <em className={`is-${x.result}`}>{RESULT[x.result]}</em>
              <small>{new Date(x.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Os desafios que valerem aparecem aqui.</p>
      )}
    </Card>
  );
}

// ─── Sugestões do chat ──────────────────────────────────────

function SuggestionsTab() {
  const { me, saveSettings, toast, refresh } = useApp();
  const cfg = me!.settings.challenge;
  const [mins, setMins] = useState<Record<string, number>>({});
  async function act(id: string, action: 'approve' | 'reject') {
    try {
      await api('/api/challenge/suggestion', { id, action, minutes: mins[id] ?? 5 });
      await refresh();
      toast(action === 'approve' ? 'Sugestão aprovada: já está na sua lista ✔' : 'Sugestão recusada.', action === 'approve' ? 'ok' : undefined);
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  }
  return (
    <div className="grid">
      <Card title="Quem pode sugerir" subtitle="Com !sugerir no chat · tudo passa pela sua aprovação">
        <Options
          name="chsug"
          value={cfg.suggestions}
          onChange={(v) => saveSettings({ challenge: { suggestions: v } })}
          options={[
            { value: 'off', label: 'Ninguém', hint: 'Desliga o !sugerir' },
            { value: 'subs', label: 'Só subs', hint: 'E quem der sub na hora' },
            { value: 'all', label: 'Todo o chat', hint: 'Mais ideias, mais moderação' },
          ]}
        />
        <p className="muted foot-note">Nenhuma sugestão aparece na tela sem você aprovar. Cabem até {CHALLENGE_LIMITS.pending} esperando.</p>
      </Card>
      <Card title={`Esperando aprovação (${cfg.pending.length})`}>
        {cfg.pending.length ? (
          <ul className="ch-sugs">
            {cfg.pending.map((p) => (
              <li key={p.id}>
                <div>
                  <b>{p.text}</b>
                  <small>
                    💡 {p.name} · {new Date(p.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </small>
                </div>
                <select className="input sm" value={mins[p.id] ?? 5} aria-label="Duração" onChange={(e) => setMins((m) => ({ ...m, [p.id]: Number(e.target.value) }))}>
                  {MINUTES.map((m) => (
                    <option key={m} value={m}>
                      {minLabel(m)}
                    </option>
                  ))}
                </select>
                <button className="btn primary sm" onClick={() => act(p.id, 'approve')}>
                  Aprovar
                </button>
                <button className="btn sm" onClick={() => act(p.id, 'reject')}>
                  Recusar
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{cfg.suggestions === 'off' ? 'As sugestões estão desligadas.' : 'Nenhuma sugestão ainda. O chat usa !sugerir seguido do desafio.'}</p>
        )}
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
            <kbd>!1 !2 !3</kbd>
            <p>Vota na opção durante a votação. Dá para mudar o voto até o tempo acabar.</p>
          </div>
          <div className="cmd">
            <kbd>!sugerir jogar de olhos fechados</kbd>
            <p>Manda uma ideia de desafio para o streamer aprovar (se as sugestões estiverem ligadas).</p>
          </div>
          <div className="cmd">
            <kbd>!desafio</kbd>
            <p>O bot diz qual desafio está valendo e quanto tempo falta.</p>
          </div>
        </div>
      </Card>
      <Card title="Para você e seus mods">
        <div className="cmds">
          <div className="cmd">
            <kbd>!desafio votar</kbd>
            <p>Abre uma votação com desafios sorteados.</p>
          </div>
          <div className="cmd">
            <kbd>!desafio cumprido</kbd>
            <p>Marca o desafio como cumprido (com festa na tela).</p>
          </div>
          <div className="cmd">
            <kbd>!desafio falhou</kbd>
            <p>Marca que não rolou.</p>
          </div>
          <div className="cmd">
            <kbd>!desafio parar</kbd>
            <p>Cancela a votação ou o desafio valendo.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
