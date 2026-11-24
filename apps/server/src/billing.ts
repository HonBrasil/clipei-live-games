import { addMonths, billingView, FOUNDER_SLOTS, planOffer, subscriptionStatus, type BillingCycle } from '@clipei/shared';
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

/**
 * Abre o pagamento. O Mercado Pago entra aqui: criar a preferência/assinatura com
 * offerPrice(cycle, founder) e devolver a URL do checkout. Até lá, null.
 */
export async function createCheckout(_channelId: string, _cycle: BillingCycle): Promise<{ url: string } | null> {
  return null;
}
