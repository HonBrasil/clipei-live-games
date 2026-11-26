import { randomBytes } from 'node:crypto';
import { addMonths, billingView, FOUNDER_SLOTS, offerPrice, planOffer, subscriptionStatus, type BillingCycle, type PaymentRecord } from '@clipei/shared';
import { config } from './config.ts';
import { ipConfigured, ipCreateLink, ipPaymentCheck, type IpPaymentCheck, type IpPaymentRef } from './infinitepay.ts';
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
 * Chamado pelo Admin (pagamento por fora) e pela confirmação de pagamento da InfinitePay.
 */
export function activate(channelId: string, cycle: BillingCycle, opts: { courtesy?: boolean; provider?: 'manual' | 'infinitepay' } = {}, now = Date.now()) {
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

// ─── InfinitePay ─────────────────────────────────────────────

/** Valor do pagamento de teste do admin (mínimo da InfinitePay). */
export const TEST_PRICE_CENTS = 100;

/**
 * Número do pedido (order_nsu): clipei.<canal em base64url>.<ciclo>.<centavos>.<t se teste>.<aleatório>
 * Leva tudo que é preciso para liberar o plano, conferido depois em /payment_check.
 */
export function paymentReference(channelId: string, cycle: BillingCycle, cents: number, test = false) {
  return ['clipei', Buffer.from(channelId).toString('base64url'), cycle === 'yearly' ? 'y' : 'm', String(cents), test ? 't' : 'p', randomBytes(5).toString('hex')].join('.');
}

export function parseReference(ref: string | null | undefined): { channelId: string; cycle: BillingCycle; cents: number; test: boolean } | null {
  const parts = (ref ?? '').split('.');
  if (parts.length !== 6 || parts[0] !== 'clipei') return null;
  const cycle = parts[2] === 'y' ? 'yearly' : parts[2] === 'm' ? 'monthly' : null;
  const cents = Number(parts[3]);
  let channelId = '';
  try {
    channelId = Buffer.from(parts[1]!, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!cycle || !channelId || !Number.isInteger(cents) || cents < 100) return null;
  return { channelId, cycle, cents, test: parts[4] === 't' };
}

/** Preço que o canal paga agora (Fundador tem desconto; quem ainda não assinou também, enquanto houver vaga). */
export function checkoutPrice(channelId: string, cycle: BillingCycle) {
  const sub = store.subscription(channelId);
  const founder = sub?.founderNumber != null || founderSlotsLeft() > 0;
  return offerPrice(cycle, founder);
}

/**
 * Cria o link do checkout na InfinitePay (null = não configurada).
 * `test`: pagamento real de R$ 1,00 só para o admin conferir a integração (libera 1 mês na conta dele).
 */
export async function createCheckout(channelId: string, cycle: BillingCycle, test = false): Promise<{ url: string } | null> {
  if (!ipConfigured()) return null;
  const ch = store.getChannel(channelId);
  if (!ch) return null;
  const cents = test ? TEST_PRICE_CENTS : Math.round(checkoutPrice(channelId, cycle) * 100);
  const offer = planOffer(cycle);
  const url = await ipCreateLink({
    description: test
      ? 'Clipei Live Games · teste da integração (R$ 1,00)'
      : `Clipei Live Games · Plano ${offer.name} (${offer.months === 1 ? '1 mês' : '12 meses'}) · canal ${ch.displayName}`,
    priceCents: cents,
    orderNsu: paymentReference(channelId, cycle, cents, test),
    redirectUrl: `${config.webUrl}/app/plano?pagamento=retorno`,
  });
  return { url };
}

export type PaymentOutcome =
  | { ok: true; result: 'activated' | 'already' | 'pending' | 'ignored'; channelId?: string }
  | { ok: false; error: string };

/**
 * Processa um pagamento (do webhook ou da volta do checkout). Sempre confere na InfinitePay
 * (/payment_check): só libera o período com o pagamento confirmado, no valor certo e com o
 * pedido da Clipei. O mesmo pagamento não soma duas vezes.
 * `onlyChannel`: na volta do checkout, só processa pagamento do próprio canal logado.
 */
export async function processPayment(
  ref: Partial<IpPaymentRef> & { receiptUrl?: string | null },
  onlyChannel?: string,
  check: (r: IpPaymentRef) => Promise<IpPaymentCheck> = ipPaymentCheck,
): Promise<PaymentOutcome> {
  const orderNsu = String(ref.orderNsu ?? '');
  const transactionNsu = String(ref.transactionNsu ?? '');
  const slug = String(ref.slug ?? '');
  const order = parseReference(orderNsu);
  if (!order) return { ok: true, result: 'ignored' };
  if (!/^[\w-]{1,80}$/.test(transactionNsu) || !/^[\w-]{1,80}$/.test(slug)) return { ok: false, error: 'pagamento incompleto' };
  if (onlyChannel && order.channelId !== onlyChannel) return { ok: false, error: 'pagamento de outro canal' };
  const sub = store.subscription(order.channelId);
  if (!sub) return { ok: true, result: 'ignored' };
  const payments = sub.payments ?? [];
  if (payments.some((r) => r.id === transactionNsu)) return { ok: true, result: 'already', channelId: order.channelId };

  const res = await check({ orderNsu, transactionNsu, slug });
  if (!res.success || !res.paid) return { ok: true, result: 'pending', channelId: order.channelId };
  if (Math.round(res.amount) < order.cents) return { ok: false, error: `valor ${res.amount} menor que ${order.cents} centavos` };
  // conferido: outro aviso pode ter chegado enquanto a InfinitePay respondia
  const now = store.subscription(order.channelId)!;
  if ((now.payments ?? []).some((r) => r.id === transactionNsu)) return { ok: true, result: 'already', channelId: order.channelId };

  activate(order.channelId, order.test ? 'monthly' : order.cycle, { provider: 'infinitepay' });
  const rec: PaymentRecord = {
    id: transactionNsu,
    cycle: order.test ? 'monthly' : order.cycle,
    amount: order.cents / 100,
    status: 'approved',
    method: res.capture_method ?? null,
    installments: res.installments ?? 1,
    receiptUrl: ref.receiptUrl && /^https:\/\//.test(ref.receiptUrl) ? ref.receiptUrl : null,
    at: Date.now(),
    test: order.test,
  };
  store.updateSubscription(order.channelId, { payments: [rec, ...(store.subscription(order.channelId)!.payments ?? [])].slice(0, 24) });
  return { ok: true, result: 'activated', channelId: order.channelId };
}

/** Admin devolveu um pagamento pela InfinitePay: desconta o período que ele tinha dado. */
export function markRefunded(channelId: string, paymentId: string) {
  const sub = store.subscription(channelId);
  const rec = sub?.payments?.find((r) => r.id === paymentId);
  if (!sub || !rec || rec.status !== 'approved') return false;
  const months = planOffer(rec.cycle).months;
  store.updateSubscription(channelId, {
    periodEnd: sub.periodEnd ? addMonths(sub.periodEnd, -months) : sub.periodEnd,
    payments: sub.payments!.map((r) => (r.id === paymentId ? { ...r, status: 'refunded' as const } : r)),
  });
  return true;
}

export { ipConfigured as checkoutEnabled };
