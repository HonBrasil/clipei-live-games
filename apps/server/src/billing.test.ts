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

describe('Mercado Pago', () => {
  const pay = (over: Record<string, unknown>) => async () =>
    ({ id: 111, status: 'approved', status_detail: 'accredited', external_reference: null, transaction_amount: 0, currency_id: 'BRL', date_approved: '2026-11-25T12:00:00Z', live_mode: true, payment_type_id: 'bank_transfer', ...over }) as never;

  it('pagamento aprovado libera o período uma vez só, no valor certo e do canal certo', async () => {
    mk('mp1');
    const price = billing.checkoutPrice('mp1', 'monthly');
    const ref = billing.paymentReference('mp1', 'monthly', price);
    expect(billing.parseReference(ref)).toMatchObject({ channelId: 'mp1', cycle: 'monthly', price });
    // valor menor que o cobrado: não libera
    expect(await billing.processPayment('111', undefined, pay({ external_reference: ref, transaction_amount: price - 1 }))).toMatchObject({ ok: false });
    expect(billing.view('mp1')!.status).toBe('trial');
    // outro canal logado tentando confirmar: recusa
    expect(await billing.processPayment('111', 'outro', pay({ external_reference: ref, transaction_amount: price }))).toMatchObject({ ok: false });
    const out = await billing.processPayment('111', 'mp1', pay({ external_reference: ref, transaction_amount: price }));
    expect(out).toMatchObject({ ok: true, result: 'activated', channelId: 'mp1' });
    const v = billing.view('mp1')!;
    expect(v.status).toBe('active');
    expect(v.lastPayment).toMatchObject({ id: '111', amount: price, method: 'bank_transfer', status: 'approved' });
    const end = v.periodEnd!;
    // webhook repetido não soma de novo
    expect(await billing.processPayment('111', undefined, pay({ external_reference: ref, transaction_amount: price }))).toMatchObject({ result: 'already' });
    expect(billing.view('mp1')!.periodEnd).toBe(end);
    // estorno desconta o mês
    expect(await billing.processPayment('111', undefined, pay({ external_reference: ref, transaction_amount: price, status: 'refunded' }))).toMatchObject({ result: 'refunded' });
    expect(billing.view('mp1')!.periodEnd).toBe(addMonths(end, -1));
    expect(billing.view('mp1')!.lastPayment?.status).toBe('refunded');
  });

  it('pendente e pagamentos de fora da Clipei são ignorados', async () => {
    mk('mp2');
    const ref = billing.paymentReference('mp2', 'yearly', billing.checkoutPrice('mp2', 'yearly'));
    expect(await billing.processPayment('222', undefined, pay({ id: 222, external_reference: ref, status: 'pending' }))).toMatchObject({ result: 'pending' });
    expect(await billing.processPayment('333', undefined, pay({ id: 333, external_reference: 'pedido-123' }))).toMatchObject({ result: 'ignored' });
    expect(billing.view('mp2')!.status).toBe('trial');
  });

  it('assinatura do webhook (x-signature)', async () => {
    const { mpValidSignature } = await import('./mercadopago.ts');
    const { createHmac } = await import('node:crypto');
    const secret = 'segredo-teste';
    const v1 = createHmac('sha256', secret).update('id:123456;request-id:abc-1;ts:1704908010;').digest('hex');
    expect(mpValidSignature(`ts=1704908010,v1=${v1}`, 'abc-1', '123456', secret)).toBe(true);
    expect(mpValidSignature(`ts=1704908010,v1=${v1}`, 'abc-2', '123456', secret)).toBe(false);
    expect(mpValidSignature(undefined, 'abc-1', '123456', secret)).toBe(false);
    expect(mpValidSignature(undefined, undefined, '1', '')).toBe(true);
  });
});
