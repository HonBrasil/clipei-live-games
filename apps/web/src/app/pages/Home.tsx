import { Link } from 'react-router-dom';
import { BOSS_SKINS, LOOP_GAME_INFO, type BossConfig } from '@clipei/shared';
import { api, fmtCountdown, fmtDuration, nf } from '../api.ts';
import { BossThumb, Card, Status } from '../components/ui.tsx';
import { useApp, useTick } from '../state.tsx';

export function Home() {
  const { me, boss, status, loop, logs, clockOffset, toast, setBoss } = useApp();
  useTick(1000);
  if (!me) return null;
  const ch = me.channel;
  const t = me.twitch;
  const running = boss?.state?.status === 'running';
  const s = boss?.state;

  const steps = [
    { done: Boolean(ch), label: 'Conectar seu canal da Twitch', to: '/app/conexoes' },
    { done: t.chatListening, label: 'Bot da Clipei no seu chat', to: '/app/conexoes' },
    { done: Boolean(status?.overlays), label: 'Adicionar o overlay no OBS', to: '/app/overlay' },
    { done: me.history.length > 0, label: 'Fazer a primeira luta', to: '/app/jogos/boss' },
  ];
  const doneCount = steps.filter((x) => x.done).length;

  async function quickStart() {
    try {
      const r = await api<{ hpMode: 'auto' | 'fixed'; config: BossConfig }>('/api/boss/start', boss?.hpMode === 'auto' ? { preset: 'auto' } : {});
      setBoss({ hpMode: r.hpMode, config: r.config });
      toast(`${r.config.name} invocado com ${nf.format(r.config.maxHp)} de vida ⚔️`, 'ok');
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  }

  const auto = me.settings.loop;
  const nextAuto = !auto.enabled
    ? 'Desligado'
    : status?.game
      ? 'Depois deste jogo'
      : loop?.next && loop.at
        ? `${LOOP_GAME_INFO[loop.next].emoji} em ${fmtCountdown(loop.at - (Date.now() + clockOffset))}`
        : loop?.blocked
          ? 'Esperando'
          : '—';

  return (
    <>
      <section className="hero">
        <div>
          <h1>{ch ? <>Bora jogar, <span>{ch.displayName}</span></> : <>Bem-vindo ao <span>modo demo</span></>}</h1>
          <p>Tudo o que está acontecendo no seu canal agora.</p>
        </div>
        <div className="hero-actions">
          {running ? (
            <Link className="btn primary lg" to="/app/jogos/boss">
              Ver a luta
            </Link>
          ) : me.billing?.status === 'expired' ? (
            <Link className="btn primary lg" to="/app/plano">
              Assinar para jogar
            </Link>
          ) : (
            <button className="btn primary lg" onClick={quickStart}>
              ⚔️ Invocar boss
            </button>
          )}
        </div>
      </section>

      {doneCount < steps.length && (
        <section className="card onboarding">
          <div className="card-head">
            <div>
              <h2>Primeiros passos</h2>
              <p>
                {doneCount} de {steps.length} feitos
              </p>
            </div>
            <div className="right progress">
              <i style={{ width: `${(doneCount / steps.length) * 100}%` }} />
            </div>
          </div>
          <ol className="checklist">
            {steps.map((st) => (
              <li key={st.label} className={st.done ? 'done' : ''}>
                <span className="tick" aria-hidden="true">
                  {st.done ? '✓' : ''}
                </span>
                <span className="grow">{st.label}</span>
                {!st.done && (
                  <Link className="btn sm" to={st.to}>
                    Fazer agora
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="kpis">
        <div className="kpi">
          <span>Chat da Twitch</span>
          <b>{!ch ? 'Demo' : t.chatListening ? 'Conectado' : 'Conectando'}</b>
          <Status tone={!ch ? '' : t.chatListening ? 'ok' : 'wait'}>{!ch ? 'use o simulador' : t.chatListening ? 'ouvindo o chat' : 'veja Conexões'}</Status>
        </div>
        <div className="kpi">
          <span>OBS</span>
          <b>{status?.overlays ? 'Conectado' : 'Desconectado'}</b>
          <Status tone={status?.overlays ? 'ok' : 'wait'}>{status?.overlays ? `${status.overlays} fonte${status.overlays > 1 ? 's' : ''}` : 'cole a URL no OBS'}</Status>
        </div>
        <div className="kpi">
          <span>Live</span>
          <b>{status?.live ? 'No ar' : 'Offline'}</b>
          <Status tone={status?.live ? 'ok' : ''}>{nf.format(status?.activeChatters ?? 0)} ativos no chat</Status>
        </div>
        <div className="kpi">
          <span>Minigame automático</span>
          <b>{auto.enabled ? (auto.mode === 'timer' ? 'Temporizador' : 'Modo Loop') : 'Desligado'}</b>
          <Status tone={auto.enabled ? 'ok' : ''}>{nextAuto}</Status>
        </div>
      </div>

      <div className="grid">
        <div className="col">
          {running && s && (
            <Card title={`${s.name} na arena`} subtitle="Luta em andamento" icon={<BossThumb skin={s.skin} width={44} height={38} />}>
              <div className="mini-hp big">
                <i style={{ width: `${(s.hp / s.maxHp) * 100}%` }} />
              </div>
              <div className="live-stats">
                <div className="stat">
                  <b>{Math.ceil((s.hp / s.maxHp) * 100)}%</b>
                  <span>Vida</span>
                </div>
                <div className="stat">
                  <b>{nf.format(s.participants)}</b>
                  <span>Guerreiros</span>
                </div>
                <div className="stat">
                  <b>{nf.format(s.totalHits)}</b>
                  <span>Golpes</span>
                </div>
              </div>
            </Card>
          )}

          <Card title="Últimas lutas" subtitle="Histórico do Boss coletivo">
            {me.history.length ? (
              <div className="scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Boss</th>
                      <th>Resultado</th>
                      <th className="num">Duração</th>
                      <th className="num">Guerreiros</th>
                      <th>Golpe final</th>
                    </tr>
                  </thead>
                  <tbody>
                    {me.history.slice(0, 8).map((h) => (
                      <tr key={h.at}>
                        <td>
                          <b>{h.name}</b>
                          <small>{new Date(h.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small>
                        </td>
                        <td>
                          <span className={`tag ${h.result === 'victory' ? 'active' : 'soon'}`}>
                            {h.result === 'victory' ? 'Derrotado' : h.result === 'escaped' ? 'Fugiu' : 'Encerrada'}
                          </span>
                        </td>
                        <td className="num">{fmtDuration(h.durationMs)}</td>
                        <td className="num">{nf.format(h.participants)}</td>
                        <td>{h.finalBlow ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="empty">Nenhuma luta ainda. Invoque o primeiro boss!</p>
            )}
          </Card>
        </div>

        <div className="col">
          <Card title="O que o bot falou" subtitle="Mensagens desta sessão">
            {logs.length ? (
              <ul className="log">
                {logs.slice(0, 12).map((l) => (
                  <li key={l.id} className={l.tone}>
                    <time>{new Date(l.at).toLocaleTimeString('pt-BR')}</time>
                    {l.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty">Nada ainda.</p>
            )}
          </Card>
          <Card title="Clips das vitórias" subtitle="Criados pelo clip automático">
            {me.clips.length ? (
              <ul className="clips">
                {me.clips.slice(0, 6).map((c) => (
                  <li key={c.id}>
                    <a href={c.url} target="_blank" rel="noopener">
                      🎬 {c.bossName}
                    </a>
                    <time>{new Date(c.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</time>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty">
                Nenhum clip ainda. Ligue o clip automático em <Link to="/app/jogos/boss?aba=apoios">Boss coletivo → Apoios</Link>.
              </p>
            )}
          </Card>
        </div>
      </div>
      <p className="muted foot-note">Bosses disponíveis: {Object.values(BOSS_SKINS).map((b) => b.name).join(', ')}.</p>
    </>
  );
}
