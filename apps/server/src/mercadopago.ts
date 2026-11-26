import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.ts';

/**
 * Mercado Pago (Checkout Pro): o streamer paga 1 mês ou 1 ano por Pix, cartão ou boleto
 * numa página do Mercado Pago. Nada de cartão passa pela Clipei.
 *
 * Variáveis no servidor (Railway):
 *  - MP_ACCESS_TOKEN    Access Token da aplicação (produção: APP_USR-…; teste: TEST-…)
 *  - MP_WEBHOOK_SECRET  "Assinatura secreta" de Webhooks da aplicação (valida a origem dos avisos)
 *  - MP_NOTIFICATION_URL (opcional) endereço público do webhook; padrão: WEB_URL/api/webhooks/mercadopago
 */

const API = 'https://api.mercadopago.com';

export const mpConfigured = () => Boolean(config.mercadopago.accessToken);
export const mpTestMode = () => config.mercadopago.accessToken.startsWith('TEST-');
export const mpNotificationUrl = () => config.mercadopago.notificationUrl || `${config.webUrl}/api/webhooks/mercadopago`;

async function mpApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.mercadopago.accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = new Error(`Mercado Pago ${init.method ?? 'GET'} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export interface MpPreferenceInput {
  title: string;
  description: string;
  price: number;
  externalReference: string;
  /** Página de volta no painel (o Mercado Pago acrescenta payment_id, status etc.). */
  backUrl: string;
  /** Parcelas máximas no cartão. */
  maxInstallments: number;
  payerEmail?: string | null;
  idempotencyKey: string;
}

export async function mpCreatePreference(p: MpPreferenceInput) {
  const notificationUrl = mpNotificationUrl();
  return mpApi<{ id: string; init_point: string; sandbox_init_point?: string }>('/checkout/preferences', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': p.idempotencyKey },
    body: JSON.stringify({
      items: [{ id: 'clipei-live', title: p.title, description: p.description, quantity: 1, currency_id: 'BRL', unit_price: p.price, category_id: 'services' }],
      external_reference: p.externalReference,
      back_urls: {
        success: `${p.backUrl}${p.backUrl.includes('?') ? '&' : '?'}pagamento=aprovado`,
        pending: `${p.backUrl}${p.backUrl.includes('?') ? '&' : '?'}pagamento=pendente`,
        failure: `${p.backUrl}${p.backUrl.includes('?') ? '&' : '?'}pagamento=recusado`,
      },
      auto_return: 'approved',
      // o Mercado Pago só aceita notification_url pública (https)
      ...(notificationUrl.startsWith('https://') ? { notification_url: notificationUrl } : {}),
      statement_descriptor: 'CLIPEI LIVE',
      payment_methods: { installments: p.maxInstallments },
      ...(p.payerEmail ? { payer: { email: p.payerEmail } } : {}),
      // o link vale por 1 dia (o preço pode mudar, ex.: vagas de Fundador)
      expires: true,
      expiration_date_to: new Date(Date.now() + 86_400_000).toISOString(),
    }),
  });
}

export interface MpPayment {
  id: number;
  status: 'pending' | 'approved' | 'authorized' | 'in_process' | 'in_mediation' | 'rejected' | 'cancelled' | 'refunded' | 'charged_back';
  status_detail: string;
  external_reference: string | null;
  transaction_amount: number;
  currency_id: string;
  date_approved: string | null;
  live_mode?: boolean;
  payment_type_id?: string;
}

export const mpGetPayment = (id: string) => mpApi<MpPayment>(`/v1/payments/${encodeURIComponent(id)}`);

/**
 * Confere o header x-signature do webhook: HMAC-SHA256 do manifesto
 * "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" com a assinatura secreta.
 * Sem MP_WEBHOOK_SECRET, aceita (o pagamento é sempre conferido na API do Mercado Pago).
 */
export function mpValidSignature(xSignature: string | undefined, xRequestId: string | undefined, dataId: string, secret = config.mercadopago.webhookSecret) {
  if (!secret) return true;
  if (!xSignature) return false;
  let ts = '';
  let v1 = '';
  for (const part of xSignature.split(',')) {
    const [k, v] = part.split('=', 2).map((x) => x?.trim() ?? '');
    if (k === 'ts') ts = v!;
    if (k === 'v1') v1 = v!;
  }
  if (!ts || !v1) return false;
  // ids alfanuméricos vão em minúsculas no manifesto
  const id = /^[0-9]+$/.test(dataId) ? dataId : dataId.toLowerCase();
  let manifest = '';
  if (id) manifest += `id:${id};`;
  if (xRequestId) manifest += `request-id:${xRequestId};`;
  manifest += `ts:${ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}
