import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { addMonths, billingView, newTrial, offerPrice, subscriptionStatus } from '@clipei/shared';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'clipei-billing-'));
let billing: typeof import('./billing.ts');
let store: typeof import('./store.ts')['store'];
const DAY = 86_400_000;

beforeAll(async () => {
  ({ store } = await import('./store.ts'));
  billing = await import('./billing.ts');
});

const mk = (id: string) => store.upsertChannel({ id, login: id, displayName: id } as never);

describe('planos', () => {
  it('preços com e sem desconto de Fundador', () => {
    expect(offerPrice('monthly')).toBe(29.9);
    expect(offerPrice('monthly', true)).toBe(23.92);
    expect(offerPrice('yearly', true)).toBe(239.2);
  });

  it('teste de 7 dias: liberado e depois expira', () => {
    const now = Date.UTC(2026, 10, 24);
    const t = newTrial(now);
    expect(subscriptionStatus(t, now + 6 * DAY)).toBe('trial');
    expect(billingView(t, now + 6.5 * DAY).daysLeft).toBe(1);
    expect(subscriptionStatus(t, now + 7 * DAY + 1)).toBe('expired');
  });

  it('31 de janeiro + 1 mês cai no fim de fevereiro', () => {
    expect(new Date(addMonths(new Date(2027, 0, 31).getTime(), 1)).getDate()).toBe(28);
  });

  it('só os 10 primeiros pagantes viram Fundador; cortesia não ocupa vaga', () => {
    mk('vip');
    billing.activate('vip', 'monthly', { courtesy: true });
    expect(store.subscription('vip')!.founderNumber).toBeNull();
    for (let i = 1; i <= 11; i++) {
      mk(`c${i}`);
      billing.activate(`c${i}`, i % 2 ? 'monthly' : 'yearly');
    }
    expect(store.subscription('c1')!.founderNumber).toBe(1);
    expect(store.subscription('c10')!.founderNumber).toBe(10);
    expect(store.subscription('c11')!.founderNumber).toBeNull();
    expect(billing.founderSlotsLeft()).toBe(0);
    expect(billing.view('c3')!.price).toBe(23.92);
    expect(billing.view('c11')!.price).toBe(29.9);
  });

  it('renovar antes do fim soma ao período; expirar bloqueia mas mantém o selo', () => {
    const before = store.subscription('c1')!.periodEnd!;
    billing.activate('c1', 'monthly');
    expect(store.subscription('c1')!.periodEnd!).toBe(addMonths(before, 1));
    billing.expire('c1');
    expect(billing.entitled('c1')).toBe(false);
    expect(store.subscription('c1')!.founderNumber).toBe(1);
    billing.extendTrial('c1', 7);
    expect(billing.entitled('c1')).toBe(true);
  });
});

describe('InfinitePay', () => {
  const paid = (over: Record<string, unknown> = {}) => async () => ({ success: true, paid: true, amount: 0, paid_amount: 0, installments: 1, capture_method: 'pix', ...over }) as never;
  const ids = (orderNsu: string, t = 'tx-1') => ({ orderNsu, transactionNsu: t, slug: 'fatura1', receiptUrl: 'https://comprovante.exemplo/1' });

  it('pagamento confirmado libera o período uma vez só, no valor certo e do canal certo', async () => {
    mk('ip1');
    const cents = Math.round(billing.checkoutPrice('ip1', 'monthly') * 100);
    const ref = billing.paymentReference('ip1', 'monthly', cents);
    expect(billing.parseReference(ref)).toMatchObject({ channelId: 'ip1', cycle: 'monthly', cents, test: false });
    // valor menor que o cobrado: não libera
    expect(await billing.processPayment(ids(ref), undefined, paid({ amount: cents - 100 }))).toMatchObject({ ok: false });
    expect(billing.view('ip1')!.status).toBe('trial');
    // outro canal logado tentando confirmar: recusa
    expect(await billing.processPayment(ids(ref), 'outro', paid({ amount: cents }))).toMatchObject({ ok: false });
    // a InfinitePay diz que não foi pago: fica pendente
    expect(await billing.processPayment(ids(ref), 'ip1', paid({ amount: cents, paid: false }))).toMatchObject({ result: 'pending' });
    const out = await billing.processPayment(ids(ref), 'ip1', paid({ amount: cents, paid_amount: cents + 50, installments: 3, capture_method: 'credit_card' }));
    expect(out).toMatchObject({ ok: true, result: 'activated', channelId: 'ip1' });
    const v = billing.view('ip1')!;
    expect(v.status).toBe('active');
    expect(v.lastPayment).toMatchObject({ id: 'tx-1', amount: cents / 100, method: 'credit_card', installments: 3, status: 'approved', test: false });
    const end = v.periodEnd!;
    // webhook repetido não soma de novo (nem consulta a InfinitePay)
    expect(await billing.processPayment(ids(ref), undefined, async () => { throw new Error('não deveria consultar'); })).toMatchObject({ result: 'already' });
    expect(billing.view('ip1')!.periodEnd).toBe(end);
    // devolução feita pelo admin desconta o mês
    expect(billing.markRefunded('ip1', 'tx-1')).toBe(true);
    expect(billing.view('ip1')!.periodEnd).toBe(addMonths(end, -1));
    expect(billing.view('ip1')!.lastPayment?.status).toBe('refunded');
  });

  it('teste do admin (R$ 1,00) libera 1 mês e fica marcado; pedidos de fora são ignorados', async () => {
    mk('ip2');
    const ref = billing.paymentReference('ip2', 'yearly', billing.TEST_PRICE_CENTS, true);
    expect(await billing.processPayment(ids(ref, 'tx-2'), 'ip2', paid({ amount: 100 }))).toMatchObject({ result: 'activated' });
    expect(billing.view('ip2')!.lastPayment).toMatchObject({ test: true, cycle: 'monthly', amount: 1 });
    expect(await billing.processPayment({ orderNsu: 'pedido-123', transactionNsu: 'x', slug: 'y' })).toMatchObject({ result: 'ignored' });
    expect(await billing.processPayment({ orderNsu: ref, transactionNsu: 'a b', slug: 'y' })).toMatchObject({ ok: false });
  });

  it('acha a URL do link nos formatos de resposta conhecidos', async () => {
    const { pickUrl } = await import('./infinitepay.ts');
    expect(pickUrl({ url: 'https://checkout.infinitepay.io/x' })).toBe('https://checkout.infinitepay.io/x');
    expect(pickUrl({ data: { link: 'https://checkout.infinitepay.io/y' } })).toBe('https://checkout.infinitepay.io/y');
    expect(pickUrl({ ok: true })).toBeNull();
  });
});
