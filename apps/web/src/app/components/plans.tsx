import type { ReactNode } from 'react';
import { brl, FOUNDER_DISCOUNT, FOUNDER_SLOTS, offerPrice, PLAN_FEATURES, PLAN_OFFERS, type BillingCycle } from '@clipei/shared';

/** Selo dos 10 primeiros assinantes. */
export function FounderBadge({ n, small }: { n?: number | null; small?: boolean }) {
  return (
    <span className={`founder-badge ${small ? 'sm' : ''}`} title="Um dos 10 primeiros assinantes da Clipei">
      ★ Fundador{n ? ` #${n}` : ''}
    </span>
  );
}

/** Faixa com as vagas de Fundador que restam (some quando acabam). */
export function FounderStrip({ left }: { left: number }) {
  if (left <= 0) return null;
  const used = FOUNDER_SLOTS - left;
  return (
    <div className="founder-strip">
      <FounderBadge />
      <div className="grow">
        <b>
          {left === 1 ? 'Última vaga' : `Restam ${left} de ${FOUNDER_SLOTS} vagas`} de Fundador
        </b>
        <span>
          Os {FOUNDER_SLOTS} primeiros assinantes ganham o selo para sempre e {Math.round(FOUNDER_DISCOUNT * 100)}% de desconto em todas as renovações.
        </span>
      </div>
      <div className="slots" aria-label={`${used} de ${FOUNDER_SLOTS} vagas ocupadas`}>
        {Array.from({ length: FOUNDER_SLOTS }, (_, i) => (
          <i key={i} className={i < used ? 'taken' : ''} />
        ))}
      </div>
    </div>
  );
}

/** Os dois ciclos lado a lado. O botão de cada card vem de quem usa. */
export function PlanCards({ discounted, current, action }: { discounted: boolean; current?: BillingCycle | null; action: (cycle: BillingCycle) => ReactNode }) {
  return (
    <div className="l-plans two">
      {PLAN_OFFERS.map((o) => {
        const price = offerPrice(o.id, discounted);
        const perMonth = price / o.months;
        return (
          <article key={o.id} className={`l-plan ${o.highlight ? 'hl' : ''} ${current === o.id ? 'current' : ''}`}>
            <div className="plan-top">
              <h3>{o.name}</h3>
              <span className={`tag ${o.highlight ? 'active' : ''}`}>{current === o.id ? 'Seu plano' : o.note}</span>
            </div>
            <div className="l-price">
              {discounted && <s>{brl(o.price)}</s>}
              {brl(price)}
              <small>{o.months === 1 ? '/mês' : '/ano'}</small>
            </div>
            <p className="plan-sub">
              {o.months > 1 ? `Equivale a ${brl(perMonth)} por mês` : 'Renova todo mês'}
              {discounted && ` · ${Math.round(FOUNDER_DISCOUNT * 100)}% off de Fundador`}
            </p>
            <ul>
              {PLAN_FEATURES.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            {action(o.id)}
          </article>
        );
      })}
    </div>
  );
}
