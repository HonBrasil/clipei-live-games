import { randomBytes } from 'node:crypto';
import { addMonths, billingView, FOUNDER_SLOTS, offerPrice, planOffer, subscriptionStatus, type BillingCycle, type PaymentRecord } from '@clipei/shared';
import { config } from './config.ts';
import { mpConfigured, mpCreatePreference, mpGetPayment, mpTestMode, type MpPayment } from './mercadopago.ts';
import { store } from './store.ts';

const DAY = 86_400_000;

/** O canal pode invocar bosses? (teste ativo ou assinatura em dia) */
export function entitled(channelId: string, now = Date.now()) {
  const sub = store.subscription(channelId);
  return !!sub && subscriptionStatus(sub, now) !== 'expired';
}

export function view(channelId: string, now = Date.now()) {
  const sub = store.subscription(channelId);
  return sub ? billingView(sub, now) : null;
}

export const founderSlotsLeft = () => Math.max(0, FOUNDER_SLOTS - store.foundersUsed());

/**
 * Registra um pagamento aprovado: soma o ciclo ao período (renovar antes do fim
 * não perde dias) e entrega o selo de Fundador aos 10 primeiros pagantes.
 * Hoje é chamado pelo Admin; com o Mercado Pago, o webhook de pagamento aprovado chama aqui.
 */
export function activate(channelId: string, cycle: BillingCycle, opts: { courtesy?: boolean; provider?: 'manual' | 'mercadopago' } = {}, now = Date.now()) {
  const sub = store.subscription(channelId);
  if (!sub) return null;
  const courtesy = Boolean(opts.courtesy);
  let founderNumber = sub.founderNumber;
  if (!courtesy && founderNumber == null && founderSlotsLeft() > 0) founderNumber = store.foundersUsed() + 1;
  const base = sub.periodEnd && sub.periodEnd > now ? sub.periodEnd : now;
  return store.updateSubscription(channelId, {
    cycle,
    periodEnd: addMonths(base, planOffer(cycle).months),
    founderNumber,
    courtesy,
    provider: opts.provider ?? 'manual',
    since: sub.since ?? (courtesy ? null : now),
  });
}

/** Dá mais dias de teste (suporte, parcerias). */
export function extendTrial(channelId: string, days: number, now = Date.now()) {
  const sub = store.subscription(channelId);
  if (!sub) return null;
  return store.updateSubscription(channelId, { trialEndsAt: Math.max(sub.trialEndsAt, now) + days * DAY, periodEnd: sub.periodEnd && sub.periodEnd > now ? sub.periodEnd : null });
}

/** Encerra o acesso agora (estorno, abuso). O selo de Fundador continua. */
export function expire(channelId: string, now = Date.now()) {
  const sub = store.subscription(channelId);
  if (!sub) return null;
  return store.updateSubscription(channelId, {
    trialEndsAt: Math.min(sub.trialEndsAt, now - 1),
    periodEnd: sub.periodEnd ? Math.min(sub.periodEnd, now - 1) : sub.periodEnd,
  });
}

// ─── Mercado Pago ────────────────────────────────────────────

/** Referência do pagamento: clipei|<canal>|<ciclo>|<preço>|<aleatório>. */
export function paymentReference(channelId: string, cycle: BillingCycle, price: number) {
  return ['clipei', channelId, cycle, price.toFixed(2), randomBytes(6).toString('hex')].join('|');
}

export function parseReference(ref: string | null | undefined): { channelId: string; cycle: BillingCycle; price: number } | null {
  const parts = (ref ?? '').split('|');
  if (parts.length !== 5 || parts[0] !== 'clipei') return null;
  const cycle = parts[2] === 'yearly' ? 'yearly' : parts[2] === 'monthly' ? 'monthly' : null;
  const price = Number(parts[3]);
  if (!cycle || !parts[1] || !Number.isFinite(price)) return null;
  return { channelId: parts[1], cycle, price };
}

/** Preço que o canal paga agora (Fundador tem desconto; quem ainda não assinou também, enquanto houver vaga). */
export function checkoutPrice(channelId: string, cycle: BillingCycle) {
  const sub = store.subscription(channelId);
  const founder = sub?.founderNumber != null || founderSlotsLeft() > 0;
  return offerPrice(cycle, founder);
}

/** Abre o pagamento no Mercado Pago e devolve o link do checkout (null = Mercado Pago não configurado). */
export async function createCheckout(channelId: string, cycle: BillingCycle): Promise<{ url: string; test: boolean } | null> {
  if (!mpConfigured()) return null;
  const ch = store.getChannel(channelId);
  if (!ch) return null;
  const price = checkoutPrice(channelId, cycle);
  const offer = planOffer(cycle);
  const pref = await mpCreatePreference({
    title: `Clipei Live Games · Plano ${offer.name}`,
    description: `Assinatura da ferramenta Clipei Live Games (${offer.months === 1 ? '1 mês' : '12 meses'}) para o canal ${ch.displayName}`,
    price,
    externalReference: paymentReference(channelId, cycle, price),
    backUrl: `${config.webUrl}/app/plano`,
    maxInstallments: cycle === 'yearly' ? 12 : 1,
    idempotencyKey: `${channelId}-${cycle}-${Date.now()}`,
  });
  return { url: pref.init_point, test: mpTestMode() };
}

export type PaymentOutcome =
  | { ok: true; result: 'activated' | 'already' | 'refunded' | 'pending' | 'ignored'; channelId?: string; status?: string }
  | { ok: false; error: string };

/**
 * Processa um pagamento (vindo do webhook ou da volta do checkout). Sempre consulta o
 * Mercado Pago: só libera o período com o pagamento aprovado, no valor certo e com a
 * referência da Clipei. Pagamento repetido não soma duas vezes.
 * `onlyChannel`: na volta do checkout, só processa pagamento do próprio canal logado.
 */
export async function processPayment(paymentId: string, onlyChannel?: string, fetchPayment: (id: string) => Promise<MpPayment> = mpGetPayment): Promise<PaymentOutcome> {
  if (!/^[0-9a-zA-Z-]{1,40}$/.test(paymentId)) return { ok: false, error: 'pagamento inválido' };
  const p = await fetchPayment(paymentId);
  const ref = parseReference(p.external_reference);
  if (!ref) return { ok: true, result: 'ignored', status: p.status };
  if (onlyChannel && ref.channelId !== onlyChannel) return { ok: false, error: 'pagamento de outro canal' };
  const sub = store.subscription(ref.channelId);
  if (!sub) return { ok: true, result: 'ignored', status: p.status };
  const id = String(p.id);
  const payments = sub.payments ?? [];
  const known = payments.find((r) => r.id === id);

  if (p.status === 'approved') {
    if (known) return { ok: true, result: 'already', channelId: ref.channelId };
    if (p.currency_id !== 'BRL' || p.transaction_amount + 0.009 < ref.price) {
      return { ok: false, error: `valor ${p.transaction_amount} ${p.currency_id} menor que ${ref.price} BRL` };
    }
    activate(ref.channelId, ref.cycle, { provider: 'mercadopago' });
    const rec: PaymentRecord = {
      id,
      cycle: ref.cycle,
      amount: p.transaction_amount,
      status: 'approved',
      method: p.payment_type_id ?? null,
      at: p.date_approved ? Date.parse(p.date_approved) : Date.now(),
      test: p.live_mode === false,
    };
    store.updateSubscription(ref.channelId, { payments: [rec, ...payments].slice(0, 24) });
    return { ok: true, result: 'activated', channelId: ref.channelId };
  }

  if ((p.status === 'refunded' || p.status === 'charged_back') && known && known.status === 'approved') {
    // devolvido: desconta o período que esse pagamento tinha dado
    const months = planOffer(known.cycle).months;
    const cur = store.subscription(ref.channelId)!;
    store.updateSubscription(ref.channelId, {
      periodEnd: cur.periodEnd ? addMonths(cur.periodEnd, -months) : cur.periodEnd,
      payments: payments.map((r) => (r.id === id ? { ...r, status: p.status as 'refunded' | 'charged_back' } : r)),
    });
    return { ok: true, result: 'refunded', channelId: ref.channelId };
  }

  return { ok: true, result: p.status === 'pending' || p.status === 'in_process' ? 'pending' : 'ignored', channelId: ref.channelId, status: p.status };
}
