import { Link } from 'react-router-dom';
import { api } from '../api.ts';
import { Card } from '../components/ui.tsx';
import { FounderBadge } from '../components/plans.tsx';
import { useApp } from '../state.tsx';

export function Account() {
  const { me } = useApp();
  if (!me) return null;
  const ch = me.channel;
  return (
    <>
      <section className="hero">
        <div>
          <h1>
            Con<span>ta</span>
          </h1>
          <p>Seus dados na Clipei.</p>
        </div>
      </section>
      <div className="narrow">
        {ch ? (
          <Card title="Perfil">
            <div className="profile">
              {ch.avatar && <img src={ch.avatar} alt="" />}
              <div>
                <b>{ch.displayName}</b>
                <span>twitch.tv/{ch.login}</span>
              </div>
            </div>
            <dl className="facts">
              <dt>Plataforma de login</dt>
              <dd>{me.primary === 'kick' ? 'Kick' : 'Twitch'}</dd>
              <dt>Plano</dt>
              <dd>
                {me.billing?.status === 'active'
                  ? me.billing.courtesy
                    ? 'Cortesia'
                    : me.billing.cycle === 'yearly'
                      ? 'Anual'
                      : 'Mensal'
                  : me.billing?.status === 'trial'
                    ? `Teste grátis (${me.billing.daysLeft} ${me.billing.daysLeft === 1 ? 'dia' : 'dias'})`
                    : 'Pausado'}{' '}
                · <Link to="/app/plano">gerenciar</Link>
              </dd>
              {me.billing?.founderNumber != null && (
                <>
                  <dt>Selo</dt>
                  <dd>
                    <FounderBadge n={me.billing.founderNumber} small />
                  </dd>
                </>
              )}
              <dt>Lutas jogadas</dt>
              <dd>{me.history.length}</dd>
            </dl>
            <div className="divider" />
            <button
              className="btn danger"
              onClick={async () => {
                await api('/api/auth/logout', {});
                location.href = '/';
              }}
            >
              Sair da conta
            </button>
          </Card>
        ) : (
          <Card title="Você está no modo demo">
            <p className="muted">Entre com a Twitch para salvar suas configurações e jogar com o seu chat.</p>
            <Link className="btn twitch" to="/entrar">
              Entrar
            </Link>
          </Card>
        )}
      </div>
    </>
  );
}
