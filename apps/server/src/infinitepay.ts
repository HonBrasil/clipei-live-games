import { config } from './config.ts';

/**
 * InfinitePay (Checkout Integrado): o streamer paga 1 mês ou 1 ano por Pix ou cartão
 * (até 12x) numa página da InfinitePay. Nada de cartão passa pela Clipei.
 *
 * Variáveis no servidor (Railway):
 *  - INFINITEPAY_HANDLE       sua InfiniteTag, sem o "$" (obrigatória)
 *  - INFINITEPAY_API_KEY      chave "inchk_…" das Configurações do Checkout (recomendada:
 *                             link de pagamento único, validade de 1 dia e juros do parcelamento por conta do comprador)
 *  - INFINITEPAY_WEBHOOK_URL  (opcional) endereço público do webhook; padrão: WEB_URL/api/webhooks/infinitepay
 *
 * No painel da InfinitePay, em Configurações do Checkout, ligue "Habilitar checkout integrado".
 * A InfinitePay não tem ambiente de teste: o teste é um pagamento real de R$ 1,00 (botão do admin no Plano).
 * O webhook não tem assinatura: todo aviso é conferido em /payment_check antes de liberar o plano.
 */

const API = 'https://api.checkout.infinitepay.io';

export const ipConfigured = () => Boolean(config.infinitepay.handle);
export const ipWebhookUrl = () => config.infinitepay.webhookUrl || `${config.webUrl}/api/webhooks/infinitepay`;

async function ipPost<T>(path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (config.infinitepay.apiKey) headers['X-Api-Key'] = config.infinitepay.apiKey;
  const res = await fetch(`${API}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`InfinitePay POST ${path} → ${res.status}: ${text.slice(0, 300)}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`InfinitePay POST ${path}: resposta inesperada: ${text.slice(0, 200)}`);
  }
}

export interface IpLinkInput {
  description: string;
  /** em centavos (mínimo 100) */
  priceCents: number;
  orderNsu: string;
  redirectUrl: string;
}

/** Cria o link do checkout e devolve a URL para onde o streamer vai. */
export async function ipCreateLink(p: IpLinkInput): Promise<string> {
  const webhook = ipWebhookUrl();
  const res = await ipPost<Record<string, unknown>>('/links', {
    handle: config.infinitepay.handle,
    items: [{ description: p.description, quantity: 1, price: p.priceCents }],
    order_nsu: p.orderNsu,
    redirect_url: p.redirectUrl,
    ...(webhook.startsWith('https://') ? { webhook_url: webhook } : {}),
    ...(config.infinitepay.apiKey
      ? {
          options: {
            single_payment: true,
            // o preço pode mudar (vagas de Fundador): o link vale 1 dia
            valid_until: new Date(Date.now() + 86_400_000).toISOString(),
            // à vista sem juros para o comprador; parcelado com juros por conta de quem parcela
            assured_installments: 1,
          },
        }
      : {}),
  });
  const url = pickUrl(res);
  if (!url) throw new Error(`InfinitePay POST /links: resposta sem URL: ${JSON.stringify(res).slice(0, 200)}`);
  return url;
}

/** A documentação não fixa o nome do campo da URL: aceita os formatos conhecidos. */
export function pickUrl(res: unknown): string | null {
  if (!res || typeof res !== 'object') return null;
  const r = res as Record<string, unknown>;
  for (const k of ['url', 'link', 'checkout_url', 'payment_url', 'checkout_link']) {
    if (typeof r[k] === 'string' && /^https:\/\//.test(r[k] as string)) return r[k] as string;
  }
  for (const k of ['data', 'link', 'result']) if (r[k] && typeof r[k] === 'object') return pickUrl(r[k]);
  return null;
}

export interface IpPaymentRef {
  orderNsu: string;
  transactionNsu: string;
  slug: string;
}

export interface IpPaymentCheck {
  success: boolean;
  paid: boolean;
  /** valor original, em centavos */
  amount: number;
  /** valor pago (pode ser maior: juros do parcelamento) */
  paid_amount: number;
  installments: number;
  capture_method: 'pix' | 'credit_card' | string;
}

/** Confere um pagamento na InfinitePay (é a única fonte confiável: o webhook não tem assinatura). */
export function ipPaymentCheck(p: IpPaymentRef) {
  return ipPost<IpPaymentCheck>('/payment_check', {
    handle: config.infinitepay.handle,
    order_nsu: p.orderNsu,
    transaction_nsu: p.transactionNsu,
    slug: p.slug,
  });
}
