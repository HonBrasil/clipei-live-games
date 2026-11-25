import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { brl, offerPrice, type AdminOverview, type BillingView } from '@clipei/shared';
import { api, nf } from '../api.ts';
import { Card, Status } from '../components/ui.tsx';
import { FounderBadge } from '../components/plans.tsx';
import { useApp } from '../state.tsx';

/** Painel de administração da Clipei (só logins em ADMIN_LOGINS). Começa pelo bot e pelos canais. */
export function Admin() {
  const { me, toast } = useApp();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<AdminOverview>('/api/admin/overview'));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!me?.admin) return;
    void load();
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [me?.admin, load]);

  if (me && !me.admin) return <Navigate to="/app" replace />;

  const chans = data?.channels ?? [];
  const paying = chans.filter((c) => c.billing.status === 'active' && !c.billing.courtesy);
  const trials = chans.filter((c) => c.billing.status === 'trial').length;
  // receita recorrente mensal: anual conta 1/12
  const mrr = paying.reduce((a, c) => a + (c.billing.cycle === 'yearly' ? offerPrice('yearly', c.billing.founderNumber != null) / 12 : offerPrice('monthly', c.billing.founderNumber != null)), 0);

  async function act(channelId: string, action: string) {
    try {
      await api('/api/admin/subscription', { channelId, action });
      toast('Assinatura atualizada', 'ok');
      void load();
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  }

  return (
    <>
      <section className="hero">
        <div>
          <h1>
            Ad<span>min</span>
          </h1>
          <p>Área interna da Clipei. Os streamers não veem esta página.</p>
        </div>
      </section>

      {data?.openAdmin && (
        <div className="banner warn">
          <div className="grow">
            <b>Qualquer conta está entrando como admin</b>
            <span>
              Defina <code>ADMIN_LOGINS</code> no <code>.env</code> com o seu login da Twitch antes de publicar. Em produção, sem essa linha, ninguém é admin.
            </span>
          </div>
        </div>
      )}
      {error && (
        <div className="banner error">
          <div className="grow">
            <b>Não deu para carregar</b>
            <span>{error}</span>
          </div>
        </div>
      )}

      <div className="kpis">
        <div className="kpi">
          <span>Canais</span>
          <b>{nf.format(chans.length)}</b>
          <small>{nf.format(chans.filter((c) => c.overlays > 0).length)} com OBS aberto agora</small>
        </div>
        <div className="kpi">
          <span>Em teste</span>
          <b>{nf.format(trials)}</b>
          <small>7 dias, sem cartão</small>
        </div>
        <div className="kpi">
          <span>Assinantes</span>
          <b>{nf.format(paying.length)}</b>
          <small>
            Fundadores: {data?.founders.used ?? 0} de {data?.founders.total ?? 10}
          </small>
        </div>
        <div className="kpi">
          <span>Receita mensal</span>
          <b>{brl(mrr)}</b>
          <small>Anual conta como 1/12</small>
        </div>
      </div>

      <div className="grid">
        <Card title="Conta do bot" subtitle="A mesma para todos os canais">
          <div className="conn">
            <div className="conn-logo bot">🤖</div>
            <div className="conn-info">
              <b>{data?.bot.name ?? 'Nenhuma conta conectada'}</b>
              <span>{data?.bot.connected ? `twitch.tv/${data.bot.login}` : 'Conecte a conta do bot (ex.: ClipeiBot)'}</span>
            </div>
            <a className="btn sm" href="/api/auth/twitch/login?as=bot">
              {data?.bot.connected ? 'Trocar' : 'Conectar'}
            </a>
          </div>
          {data?.bot.connected && data.bot.missingScopes.length > 0 && <p className="chat-error">Faltam permissões no bot: {data.bot.missingScopes.join(', ')}. Clique em Trocar e autorize de novo.</p>}
          <p className="muted" style={{ marginTop: 12 }}>
            Na tela da Twitch, entre com a <b>conta do bot</b>, não a sua. Depois de trocar, o bot volta a entrar nos chats de todos os canais sozinho.
          </p>
        </Card>
        <Card title="Plataformas" subtitle="Chaves configuradas no servidor">
          <div className="conn-list">
            <div className="conn">
              <div className="conn-logo twitch">T</div>
              <div className="conn-info">
                <b>Twitch</b>
                <span>TWITCH_CLIENT_ID / SECRET</span>
              </div>
              <Status tone={data?.platforms.twitch ? 'ok' : 'wait'}>{data?.platforms.twitch ? 'Configurada' : 'Faltando'}</Status>
            </div>
            <div className="conn">
              <div className="conn-logo kick">K</div>
              <div className="conn-info">
                <b>Kick</b>
                <span>KICK_CLIENT_ID / SECRET · o bot é o dono do app</span>
              </div>
              <Status tone={data?.platforms.kick ? 'ok' : ''}>{data?.platforms.kick ? 'Configurada' : 'Desligada'}</Status>
            </div>
            <div className="conn">
              <div className="conn-logo yt">▶</div>
              <div className="conn-info">
                <b>YouTube</b>
                <span>{me?.youtube.botConnected ? `Bot: ${me.youtube.botName}` : 'GOOGLE_CLIENT_ID / SECRET · conecte o canal do bot'}</span>
              </div>
              {data?.platforms.youtube ? (
                <a className="btn sm" href="/api/auth/youtube/login?as=bot">
                  {me?.youtube.botConnected ? 'Trocar bot' : 'Conectar bot'}
                </a>
              ) : (
                <Status tone="">Desligado</Status>
              )}
            </div>
          </div>
        </Card>
      </div>

      <div style={{ marginTop: 20 }}>
        <Card title="Canais conectados" subtitle="Atualiza a cada 10 segundos">
          {data?.channels.length ? (
            <div className="scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Canal</th>
                    <th>Plano</th>
                    <th>Plataformas</th>
                    <th>Chat</th>
                    <th>OBS</th>
                    <th className="num">Lutas</th>
                    <th>Última luta</th>
                    <th>Desde</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {data.channels.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <b>{c.displayName}</b>
                        <small>{c.login}</small>
                      </td>
                      <td>
                        <PlanCell b={c.billing} />
                      </td>
                      <td>{c.platforms.map((p) => (p === 'twitch' ? 'Twitch' : 'Kick')).join(' + ') || '—'}</td>
                      <td>
                        <Status tone={c.chatListening ? 'ok' : 'wait'}>{c.chatListening ? 'Ouvindo' : 'Fora'}</Status>
                      </td>
                      <td>
                        <Status tone={c.overlays ? 'ok' : ''}>{c.overlays ? 'Aberto' : 'Fechado'}</Status>
                      </td>
                      <td className="num">{nf.format(c.fights)}</td>
                      <td>{c.lastFightAt ? new Date(c.lastFightAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
                      <td>{new Date(c.connectedAt).toLocaleDateString('pt-BR')}</td>
                      <td>
                        <select
                          className="row-select"
                          value=""
                          aria-label={`Ações para ${c.displayName}`}
                          onChange={(e) => {
                            if (e.target.value) void act(c.id, e.target.value);
                          }}
                        >
                          <option value="">Ações…</option>
                          <option value="monthly">Registrar pagamento mensal</option>
                          <option value="yearly">Registrar pagamento anual</option>
                          <option value="courtesy">Cortesia (1 mês)</option>
                          <option value="trial7">+7 dias de teste</option>
                          <option value="expire">Encerrar acesso agora</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">Nenhum canal conectado ainda.</p>
          )}
        </Card>
      </div>
      <p className="muted foot-note">Até o Mercado Pago entrar, registre aqui os pagamentos recebidos: o período soma ao que já existe e os 10 primeiros pagantes viram Fundadores automaticamente.</p>
    </>
  );
}

function PlanCell({ b }: { b: BillingView }) {
  const until = b.status === 'active' ? b.periodEnd : b.trialEndsAt;
  const label = b.status === 'active' ? (b.courtesy ? 'Cortesia' : b.cycle === 'yearly' ? 'Anual' : 'Mensal') : b.status === 'trial' ? 'Teste' : 'Pausado';
  return (
    <div className="plan-cell">
      <span className={`plan-chip ${b.status}`}>{label}</span>
      {b.founderNumber != null && <FounderBadge n={b.founderNumber} small />}
      <small>{b.status === 'expired' ? 'sem acesso' : `até ${new Date(until!).toLocaleDateString('pt-BR')}`}</small>
    </div>
  );
}
