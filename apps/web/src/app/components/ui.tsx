import { useEffect, useRef, type ReactNode } from 'react';
import type { BossSkinId } from '@clipei/shared';
import { bossSprite } from '../../arena/sprites.ts';
import { useApp } from '../state.tsx';

export function Card({
  icon,
  title,
  subtitle,
  right,
  children,
  id,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  children?: ReactNode;
  id?: string;
}) {
  return (
    <section className="card" aria-labelledby={id}>
      <div className="card-head">
        {icon && <div className="card-icon">{icon}</div>}
        <div>
          <h2 id={id}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {right && <div className="right">{right}</div>}
      </div>
      {children}
    </section>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch" title={label}>
      <input type="checkbox" checked={checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export function Options<T extends string | number>({
  name,
  value,
  options,
  onChange,
  tight,
}: {
  name: string;
  value: T;
  options: { value: T; label: ReactNode; hint?: ReactNode }[];
  onChange: (v: T) => void;
  tight?: boolean;
}) {
  return (
    <div className={`options${tight ? ' tight' : ''}`} role="radiogroup">
      {options.map((o) => (
        <label className="opt" key={String(o.value)}>
          <input type="radio" name={name} checked={o.value === value} onChange={() => onChange(o.value)} />
          <span>
            {o.label}
            {o.hint && <small>{o.hint}</small>}
          </span>
        </label>
      ))}
    </div>
  );
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

export function Status({ tone, children }: { tone: 'ok' | 'wait' | ''; children: ReactNode }) {
  return (
    <span className={`status ${tone}`}>
      <i className="dot" />
      {children}
    </span>
  );
}

export function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toasts" role="status">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** Miniatura do boss em pixel art (mesmo sprite da arena). */
export function BossThumb({ skin, width = 132, height = 108 }: { skin: BossSkinId; width?: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const sp = bossSprite(skin, 1);
    const fit = Math.min((c.width - 4) / sp.width, (c.height - 4) / sp.height);
    // pixel perfeito quando cabe (escala inteira); em miniaturas pequenas, escala fracionária
    const sc = fit >= 1 ? Math.floor(fit) : fit;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(sp, Math.round((c.width - sp.width * sc) / 2), c.height - sp.height * sc - 2, sp.width * sc, sp.height * sc);
  }, [skin]);
  return <canvas ref={ref} width={width} height={height} aria-hidden="true" className="boss-thumb" />;
}

export function OverlayPreview({ overlayKey }: { overlayKey: string }) {
  return (
    <div className="preview">
      <iframe title="Prévia do overlay" src={`/overlay.html?key=${encodeURIComponent(overlayKey)}&preview=1`} />
    </div>
  );
}

export function Logo({ className = 'logo' }: { className?: string }) {
  return <img className={className} src="/logo.png" alt="Clipei Live Games" />;
}
