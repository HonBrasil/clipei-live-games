import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { GAME_SUPPORT, SUPPORT_MIN, type SupportGameId, type SupportParamDef, type SupportRuleKind } from '@clipei/shared';
import { nf } from '../api.ts';
import { useApp } from '../state.tsx';
import { Card, Switch } from './ui.tsx';

const KINDS: { kind: SupportRuleKind; icon: string; title: string }[] = [
  { kind: 'bits', icon: '💎', title: 'Bits' },
  { kind: 'sub', icon: '⭐', title: 'Subs e presentes' },
  { kind: 'points', icon: '🎯', title: 'Pontos de canal' },
  { kind: 'raid', icon: '🚀', title: 'Raids' },
];

/** Campo numérico que só salva ao sair do campo (ou Enter), para não pular enquanto digita. */
function NumField({ value, def, onCommit, label }: { value: number; def: SupportParamDef | { min: number; max: number; step: number }; onCommit: (v: number) => void; label: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text.replace(',', '.'));
    if (!Number.isFinite(n)) return setText(String(value));
    const v = Math.min(def.max, Math.max(def.min, n));
    setText(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <input
      className="input mini"
      type="number"
      inputMode="decimal"
      min={def.min}
      max={def.max}
      step={def.step}
      value={text}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/**
 * O que bits, subs, pontos e raids fazem neste minigame, tudo ajustável.
 * Mudanças valem na hora, até no meio da partida.
 */
export function GameSupportCard({ game }: { game: SupportGameId }) {
  const { me, saveSettings } = useApp();
  const cfg = me!.settings.gameSupport[game];
  const points = me!.settings.support.points;
  const set = (kind: SupportRuleKind, patch: Record<string, unknown>) => saveSettings({ gameSupport: { [game]: { [kind]: patch } } });

  return (
    <Card title="Apoios" subtitle="Vantagem, não vitória garantida. Ajuste o quanto cada apoio ajuda: vale na hora, até no meio da partida.">
      <div className="support-list">
        {KINDS.map(({ kind, icon, title }) => {
          const def = GAME_SUPPORT[game][kind];
          const rule = cfg[kind];
          if (!def) {
            return (
              <div key={kind} className="sup-row is-off">
                <div className="sup-ico" aria-hidden="true">
                  {icon}
                </div>
                <div className="sup-body">
                  <div className="sup-title">
                    <b>{title}</b>
                    <span>Sem efeito neste jogo</span>
                  </div>
                </div>
              </div>
            );
          }
          const min = SUPPORT_MIN[kind];
          return (
            <div key={kind} className={`sup-row ${rule.enabled ? '' : 'is-off'}`}>
              <div className="sup-ico" aria-hidden="true">
                {icon}
              </div>
              <div className="sup-body">
                <div className="sup-title">
                  <b>{title}</b>
                  <span>{def.effect}</span>
                </div>
                <div className="sup-hint">{def.detail}</div>
                {rule.enabled && (
                  <div className="sup-ctrl">
                    {min && (
                      <span className="sup-field">
                        {min.label} <NumField value={rule.min} def={{ min: 1, max: min.max, step: min.step }} onCommit={(v) => set(kind, { min: v })} label={`${title}: mínimo`} /> {min.suffix}
                      </span>
                    )}
                    {def.params.map((p) => (
                      <span key={p.key} className="sup-field">
                        {p.label}{' '}
                        {p.options ? (
                          <select className="input mini sel" value={rule.p[p.key]} aria-label={`${title}: ${p.label}`} onChange={(e) => set(kind, { p: { [p.key]: Number(e.target.value) } })}>
                            {p.options.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <NumField value={rule.p[p.key]} def={p} onCommit={(v) => set(kind, { p: { [p.key]: v } })} label={`${title}: ${p.label} ${p.suffix ?? ''}`} />
                        )}{' '}
                        {p.suffix}
                      </span>
                    ))}
                    {kind === 'points' && (
                      <span className="sup-field">
                        Recompensa custa{' '}
                        <NumField value={points.cost} def={{ min: 1, max: 1_000_000, step: 50 }} onCommit={(v) => saveSettings({ support: { points: { cost: v } } })} label="Custo da recompensa em pontos" /> pontos
                      </span>
                    )}
                  </div>
                )}
                {kind === 'points' && rule.enabled && !points.enabled && (
                  <div className="sup-hint warn">
                    A recompensa de pontos está desligada no seu canal.{' '}
                    <button type="button" className="link-btn" onClick={() => saveSettings({ support: { points: { enabled: true } } })}>
                      Ligar agora
                    </button>
                  </div>
                )}
                {kind === 'points' && rule.enabled && points.enabled && (
                  <div className="sup-hint">
                    Recompensa "⚡ Apoio no Minigame", a mesma em todos os jogos ({nf.format(points.cost)} pontos). Sem jogo rolando, os pontos voltam.
                  </div>
                )}
              </div>
              <Switch label={`${title} no jogo`} checked={rule.enabled} onChange={(v) => set(kind, { enabled: v })} />
            </div>
          );
        })}
      </div>
      <p className="muted">
        Apoiou nas inscrições? Já entra no jogo com o item. Para testar sem gastar nada, use os apoios em <Link to="/app/testar">Testar</Link>.
      </p>
    </Card>
  );
}
