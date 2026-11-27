import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ERRORS, SUCCESS, api, fmtLeft } from './api.ts';
import { Icon } from './components/icons.tsx';
import { FounderBadge } from './components/plans.tsx';
import { Logo, Toasts } from './components/ui.tsx';
import { useApp } from './state.tsx';
import { useOnboarding } from './pages/Onboarding.tsx';

const NAV = [
  { to: '/app', label: 'Início', icon: 'home', end: true },
  { to: '/app/jogos', label: 'Minigames', icon: 'games' },
  { to: '/app/loop', label: 'Automático', icon: 'loop' },
  { to: '/app/overlay', label: 'Overlay (OBS)', icon: 'overlay' },
  { to: '/app/conexoes', label: 'Conexões', icon: 'link' },
  { to: '/app/testar', label: 'Testar', icon: 'test' },
  { to: '/app/plano', label: 'Plano', icon: 'plan' },
  { to: '/app/conta', label: 'Conta', icon: 'user' },
] as const;

/** Moldura da área do streamer: menu lateral (desktop) / menu inferior (celular). */
export function AppShell() {
  const { me, boss, loadError, toast, refresh, status } = useApp();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const ob = useOnboarding();
  const guided = Boolean(me?.channel && ob && !ob.complete && !ob.dismissed);

  // mensagens de retorno do login (?conectado=... / ?erro=...)
  const loaded = Boolean(me);
  useEffect(() => {
    if (!loaded) return;
    const ok = params.get('conectado');
    const err = params.get('erro');
    if (ok && SUCCESS[ok]) toast(SUCCESS[ok], 'ok');
    if (err) toast(ERRORS[err] ?? 'Algo deu errado.', 'err');
    if (ok || err) setParams({}, { replace: true });
    // conta nova acabou de entrar: vai direto para a configuração guiada
    if (ok && ['streamer', 'kick', 'twitch', 'youtube'].includes(ok) && guided && !me?.history.length) navigate('/app/comecar', { replace: true });
  }, [params, setParams, toast, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  if (loadError) {
    return (
      <div className="page">
        <div className="banner error">
          <div className="grow">
            <b>Servidor fora do ar</b>
            <span>
              Rode <code>npm run dev</code> na pasta do projeto e recarregue.
            </span>
          </div>
          <button className="btn" onClick={() => void refresh()}>
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }
  if (!me) return <div className="loading">Carregando…</div>;

  const running = boss?.state?.status === 'running';
  const ch = me.channel;

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/" className="side-brand" aria-label="Clipei Live Games — site">
          <Logo className="side-logo" />
        </Link>
        <nav className="side-nav" aria-label="Menu principal">
          {guided && ob && (
            <NavLink to="/app/comecar" className="nav-item nav-setup">
              <span className="nav-setup-num">
                {ob.doneCount}/{ob.steps.length}
              </span>
              <span>Primeiros passos</span>
            </NavLink>
          )}
          {[...NAV, ...(me.admin ? ([{ to: '/app/admin', label: 'Admin', icon: 'bolt' }] as const) : [])].map((n) => (
            <NavLink key={n.to} to={n.to} end={'end' in n ? n.end : false} className="nav-item">
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className={`obs-pill ${status?.overlays ? 'on' : ''}`}>
            <i className="dot" />
            {status?.overlays ? 'OBS conectado' : 'OBS desconectado'}
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <Link to="/" className="top-brand" aria-label="Clipei Live Games — site">
            <Logo className="top-logo" />
          </Link>
          <div className="spacer" />
          {running && (
            <button className="pill live" onClick={() => navigate('/app/jogos/boss')}>
              Boss ao vivo
            </button>
          )}
          {me.billing?.status === 'trial' && (
            <Link className="pill trial-pill" to="/app/plano">
              Teste grátis · faltam {fmtLeft(me.billing.trialEndsAt - Date.now())}
            </Link>
          )}
          {ch ? (
            <div className="user-pill">
              {ch.avatar && <img src={ch.avatar} alt="" />}
              <span className="name">{ch.displayName}</span>
              {me.billing?.founderNumber != null && <FounderBadge n={me.billing.founderNumber} small />}
              <button
                className="btn sm"
                onClick={async () => {
                  await api('/api/auth/logout', {});
                  location.href = '/';
                }}
              >
                Sair
              </button>
            </div>
          ) : (
            <>
              <span className="pill">Modo demo</span>
              <Link className="btn sm twitch" to="/entrar">
                Entrar
              </Link>
            </>
          )}
        </header>
        <main className="page">
          {me.billing?.status === 'expired' && pathname !== '/app/plano' && (
            <div className="banner error">
              <div className="grow">
                <b>{me.billing.periodEnd ? 'Sua assinatura venceu' : 'Seu teste grátis acabou'}</b>
                <span>Os bosses estão pausados. Suas configurações e o overlay continuam salvos.</span>
              </div>
              <Link className="btn primary" to="/app/plano">
                Ver planos
              </Link>
            </div>
          )}
          {me.billing?.status === 'active' && !me.billing.courtesy && me.billing.daysLeft <= 3 && pathname !== '/app/plano' && (
            <div className="banner warn">
              <div className="grow">
                <b>{me.billing.daysLeft <= 1 ? 'Sua assinatura vence amanhã' : `Sua assinatura vence em ${me.billing.daysLeft} dias`}</b>
                <span>O pagamento não é automático: renove para os minigames não pausarem. Renovar antes soma ao tempo que você já tem.</span>
              </div>
              <Link className="btn primary" to="/app/plano">
                Renovar
              </Link>
            </div>
          )}
          {me.billing?.status === 'trial' && me.billing.daysLeft <= 2 && pathname !== '/app/plano' && (
            <div className="banner warn">
              <div className="grow">
                <b>{me.billing.daysLeft === 1 ? 'Último dia de teste' : 'Faltam 2 dias de teste'}</b>
                <span>Assine para o boss não parar no meio da semana{me.founderSlotsLeft > 0 ? ` (ainda há ${me.founderSlotsLeft} vagas de Fundador com 20% off)` : ''}.</span>
              </div>
              <Link className="btn primary" to="/app/plano">
                Assinar
              </Link>
            </div>
          )}
          <Outlet />
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Menu">
        {NAV.filter((n) => ['/app', '/app/jogos', '/app/overlay', '/app/testar', '/app/conta'].includes(n.to)).map((n) => (
          <NavLink key={n.to} to={n.to} end={'end' in n ? n.end : false} className="bn-item">
            <Icon name={n.icon} size={22} />
            <span>{n.label.replace(' (OBS)', '')}</span>
          </NavLink>
        ))}
      </nav>
      <Toasts />
    </div>
  );
}
