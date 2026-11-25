import { useEffect, useState } from 'react';
import type { SimulatorStatus } from '@clipei/shared';
import { api } from '../api.ts';
import { Card, Switch } from '../components/ui.tsx';
import { useApp } from '../state.tsx';

const SUPPORT = [
  { kind: 'bits', amount: 100, label: '💎 100 bits' },
  { kind: 'bits', amount: 1000, label: '💎 1.000 bits' },
  { kind: 'sub', amount: 1, label: '⭐ Sub' },
  { kind: 'gift', amount: 5, label: '🎁 5 subs de presente' },
  { kind: 'points', amount: 1, label: '🎯 Pontos' },
  { kind: 'raid', amount: 60, label: '🚀 Raid de 60' },
];

export function TestPage() {
  const { me, boss, status, toast } = useApp();
  const [sim, setSim] = useState<SimulatorStatus>(me!.simulator);
  // o servidor desliga o chat simulado sozinho quando o minigame termina
  const simulating = status?.simulating;
  useEffect(() => {
    if (simulating === undefined) return;
    setSim((s) => (s.running === simulating ? s : { ...s, running: simulating }));
  }, [simulating]);
  const running = boss?.state?.status === 'running';

  async function update(patch: Partial<SimulatorStatus>) {
    const next = { ...sim, ...patch };
    setSim(next);
    const r = await api<{ status: SimulatorStatus }>('/api/simulator', next);
    setSim(r.status);
  }

  const slider = (key: 'viewers' | 'messagesPerSecond' | 'subRatio', label: string, min: number, max: number, step: number, scale = 1, unit = '') => (
    <div className="field">
      <span className="field-label">
        <label htmlFor={`sim-${key}`}>{label}</label>
        <output>
          {Math.round(sim[key] * scale)}
          {unit}
        </output>
      </span>
      <input id={`sim-${key}`} type="range" min={min} max={max} step={step} value={Math.round(sim[key] * scale)} onChange={(e) => void update({ [key]: Number(e.target.value) / scale })} />
    </div>
  );

  return (
    <>
      <section className="hero">
        <div>
          <h1>
            Tes<span>tar</span>
          </h1>
          <p>Veja o minigame funcionando sem estar ao vivo e sem gastar nada.</p>
        </div>
        {!running && (
          <button
            className="btn primary lg"
            onClick={async () => {
              await api('/api/boss/start', { preset: 'auto' });
              if (!sim.running) await update({ running: true });
              toast('Boss de teste invocado ⚔️', 'ok');
            }}
          >
            ⚔️ Invocar boss de teste
          </button>
        )}
      </section>
      <div className="grid">
        <Card title="Chat simulado" subtitle="Espectadores falsos mandando comandos" right={<Switch label="Ligar simulador" checked={sim.running} onChange={(v) => void update({ running: v })} />}>
          {slider('viewers', 'Espectadores', 5, 1000, 5)}
          {slider('messagesPerSecond', 'Mensagens por segundo', 1, 500, 1)}
          {slider('subRatio', 'Assinantes (mais crítico)', 0, 100, 5, 100, '%')}
          <p className="muted">Com 500 mensagens por segundo você vê como a arena aguenta o chat de um streamer grande.</p>
          <p className="muted foot-note">Desliga sozinho poucos segundos depois que o minigame termina, ou após 2 minutos ligado sem nenhum jogo na tela.</p>
        </Card>
        <Card title="Simular apoio" subtitle="Bits, subs, pontos e raid de mentira">
          <div className="sim-support">
            {SUPPORT.map((s) => (
              <button
                key={s.label}
                className="btn"
                onClick={async () => {
                  const r = await api<{ applied: boolean }>('/api/simulate/support', { kind: s.kind, amount: s.amount });
                  if (!r.applied) toast(running ? 'Esse tipo de apoio está desligado.' : 'Invoque um boss para ver o efeito.');
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="muted">Os efeitos aparecem no overlay do OBS e na prévia da página Overlay.</p>
        </Card>
      </div>
    </>
  );
}
