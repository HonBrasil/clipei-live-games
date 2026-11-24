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
