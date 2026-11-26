import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { brl, planOffer, TRIAL_DAYS, type BillingCycle, type BillingView } from '@clipei/shared';
import { api, fmtLeft } from '../api.ts';
import { Card } from '../components/ui.tsx';
import { FounderBadge, FounderStrip, PlanCards } from '../components/plans.tsx';
import { useApp, useTick } from '../state.tsx';

const fmtDate = (t: number) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
const PAY_METHOD: Record<string, string> = {
  bank_transfer: 'Pix',
  credit_card: 'cartão de crédito',
  debit_card: 'cartão de débito',
  ticket: 'boleto',
  account_money: 'saldo Mercado Pago',
};

const fmtDateTime = (t: number) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function PlanPage() {
  const { me, toast, clockOffset, refresh } = useApp();
  const [params, setParams] = useSearchParams();
  const [pending, setPending] = useState(false);

  // volta do Mercado Pago: /app/plano?pagamento=aprovado&payment_id=…
  useEffect(() => {
    const st = params.get('pagamento');
    if (!st) return;
    const pid = params.get('payment_id') || params.get('collection_id');
    setParams({}, { replace: true });
    if (st === 'recusado') {
      toast('O pagamento não foi aprovado. Dá para tentar de novo com outra forma de pagamento.', 'err');
      return;
    }
    if (!pid || pid === 'null') {
      if (st === 'pendente') setPending(true);
      return;
    }
    api<{ result: string; billing: BillingView | null }>('/api/billing/confirm', { paymentId: pid })
      .then((r) => {
        if (r.result === 'activated' || r.result === 'already') {
          toast('Pagamento aprovado! Sua assinatura está ativa 🎉', 'ok');
          setPending(false);
          void refresh();
        } else if (r.result === 'pending') setPending(true);
      })
      .catch((err) => toast((err as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useTick(60_000);
  const [busy, setBusy] = useState<BillingCycle | null>(null);
  if (!me) return null;
  const b = me.billing;
  const paying = b?.status === 'active' && !b.courtesy;
  // Fundador paga com desconto; quem ainda não assinou também, enquanto houver vaga
  const discounted = b?.founderNumber != null || (me.founderSlotsLeft > 0 && !paying);

  async function subscribe(cycle: BillingCycle) {
    if (!me?.channel) return;
    setBusy(cycle);
    try {
      const { url } = await api<{ url: string }>('/api/billing/checkout', { cycle });
      location.href = url;
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className="hero">
        <div>
          <h1>
            Pla<span>no</span>
          </h1>
          <p>Um plano só, com tudo liberado. Escolha pagar por mês ou por ano.</p>
        </div>
        {b?.founderNumber != null && <FounderBadge n={b.founderNumber} />}
      </section>

      {!b ? (
        <div className="banner">
          <div className="grow">
            <b>Teste {TRIAL_DAYS} dias grátis, sem cartão</b>
            <span>Entre com a Twitch e o teste começa na hora, com todos os minigames liberados.</span>
          </div>
          <Link className="btn twitch" to="/entrar">
            Entrar com a Twitch
          </Link>
        </div>
      ) : (
        <div className="narrow-wide">
          <Card title="Sua assinatura">
            {b.status === 'trial' && (
              <div className="sub-state">
                <div className="sub-line">
                  <b>Teste grátis</b>
                  <span className="pill">Faltam {fmtLeft(b.trialEndsAt - (Date.now() + clockOffset))}</span>
                </div>
                <div className="meter" aria-hidden>
                  {/* parte do teste já usada, pelo relógio (não pelo dia arredondado) */}
                  <i style={{ width: `${Math.max(1, Math.min(100, (1 - (b.trialEndsAt - (Date.now() + clockOffset)) / (TRIAL_DAYS * 86_400_000)) * 100))}%` }} />
                </div>
                <span className="muted">Tudo liberado até {fmtDateTime(b.trialEndsAt)}. Não pedimos cartão: quando acabar, é só assinar para continuar.</span>
              </div>
            )}
            {b.status === 'active' && (
              <div className="sub-state">
                <div className="sub-line">
                  <b>{b.courtesy ? 'Cortesia da Clipei' : `Plano ${planOffer(b.cycle ?? 'monthly').name}`}</b>
                  <span className="pill ok">Ativo</span>
                </div>
                <span className="muted">
                  {b.courtesy ? `Liberado pela equipe até ${fmtDate(b.periodEnd!)}.` : `${brl(b.price ?? 0)} ${b.cycle === 'yearly' ? 'por ano' : 'por mês'} · válido até ${fmtDate(b.periodEnd!)}.`}
                </span>
                {b.lastPayment && (
                  <span className="muted">
                    Último pagamento: {brl(b.lastPayment.amount)} em {fmtDate(b.lastPayment.at)}
                    {b.lastPayment.method ? ` (${PAY_METHOD[b.lastPayment.method] ?? b.lastPayment.method})` : ''}
                    {b.lastPayment.status !== 'approved' ? ' · devolvido' : ''}.
                  </span>
                )}
                {!b.courtesy && b.daysLeft <= 7 && <span className="muted">Faltam {b.daysLeft} dias. Renove abaixo para não pausar os minigames.</span>}
              </div>
            )}
            {b.status === 'expired' && (
              <div className="sub-state">
                <div className="sub-line">
                  <b>{b.periodEnd ? 'Assinatura vencida' : 'Teste encerrado'}</b>
                  <span className="pill err">Pausado</span>
                </div>
                <span className="muted">Os bosses estão pausados. Suas configurações, o overlay do OBS e o histórico continuam salvos: ao assinar, tudo volta como estava.</span>
              </div>
            )}
          </Card>
        </div>
      )}

      {pending && b?.status !== 'active' && (
        <div className="banner">
          <div className="grow">
            <b>Pagamento em processamento</b>
            <span>Pix e boleto podem levar alguns minutos. Assim que o Mercado Pago confirmar, a assinatura ativa sozinha: pode fechar esta página.</span>
          </div>
        </div>
      )}
      {me.checkout.test && (
        <p className="muted foot-note">🧪 Mercado Pago em modo de teste: use as contas e cartões de teste do Mercado Pago.</p>
      )}

      {!paying && <FounderStrip left={me.founderSlotsLeft} />}

      <PlanCards
        discounted={discounted}
        current={paying ? b?.cycle : null}
        action={(cycle) =>
          me.channel && !me.checkout.enabled ? (
            <button className="btn block" disabled>
              Pagamento online em breve
            </button>
          ) : me.channel ? (
            <button className={`btn ${cycle === 'yearly' ? 'primary' : ''} block`} disabled={busy !== null} onClick={() => void subscribe(cycle)}>
              {busy === cycle
                ? 'Abrindo o Mercado Pago…'
                : paying
                  ? `Renovar: +${planOffer(cycle).months === 1 ? '1 mês' : '12 meses'}`
                  : `Assinar ${planOffer(cycle).name.toLowerCase()}`}
            </button>
          ) : (
            <Link className={`btn ${cycle === 'yearly' ? 'primary' : ''} block`} to="/entrar">
              Começar teste grátis
            </Link>
          )
        }
      />
      <p className="muted foot-note">
        Pagamento por Pix, cartão ou boleto numa página segura do Mercado Pago (a Clipei não vê os dados do cartão). Cada pagamento libera 1 mês ou 1 ano, sem
        cobrança automática: para continuar depois, é só renovar aqui. Renovar antes do fim soma ao tempo que você já tem.
      </p>
    </>
  );
}
