import { Link } from 'react-router-dom';
import { api, fmtLeft } from '../api.ts';
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
                <span>{me.primary === 'kick' ? `kick.com/${ch.login}` : me.primary === 'youtube' ? `YouTube · ${ch.displayName}` : `twitch.tv/${ch.login}`}</span>
              </div>
            </div>
            <dl className="facts">
              <dt>Plataforma de login</dt>
              <dd>{me.primary === 'kick' ? 'Kick' : me.primary === 'youtube' ? 'YouTube' : 'Twitch'}</dd>
              <dt>Plano</dt>
              <dd>
                {me.billing?.status === 'active'
                  ? me.billing.courtesy
                    ? 'Cortesia'
                    : me.billing.cycle === 'yearly'
                      ? 'Anual'
                      : 'Mensal'
                  : me.billing?.status === 'trial'
                    ? `Teste grátis (faltam ${fmtLeft(me.billing.trialEndsAt - Date.now())})`
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
        {ch && (
          <Card title="Seus dados" subtitle="Privacidade e exclusão">
            <p className="muted">
              Veja o que guardamos na <Link to="/privacidade">Política de Privacidade</Link>. Para tirar o acesso da Clipei a uma plataforma, desconecte em{' '}
              <Link to="/app/conexoes">Conexões</Link>.
            </p>
            <button
              className="btn danger"
              style={{ marginTop: 12 }}
              onClick={async () => {
                const typed = window.prompt('Isso apaga sua conta na Clipei: conexões, configurações, clips, histórico e assinatura. Não dá para desfazer.\n\nDigite EXCLUIR para confirmar:');
                if (typed?.trim().toUpperCase() !== 'EXCLUIR') return;
                await api('/api/account/delete', { confirm: 'EXCLUIR' });
                location.href = '/';
              }}
            >
              Excluir minha conta
            </button>
          </Card>
        )}
      </div>
    </>
  );
}
