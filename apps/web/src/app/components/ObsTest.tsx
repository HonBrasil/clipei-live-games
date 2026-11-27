import { useState } from 'react';
import type { ObsTestResult } from '@clipei/shared';
import { api } from '../api.ts';
import { useApp } from '../state.tsx';

type Phase = { kind: 'idle' } | { kind: 'testing' } | { kind: 'result'; r: ObsTestResult } | { kind: 'error'; msg: string };

/**
 * "Testar no OBS": manda um aviso verde para as fontes do OBS e confere o que
 * voltou (está mesmo no OBS? tamanho certo? cena no ar?). O streamer confirma
 * se o aviso apareceu e, se não, recebe as soluções mais comuns.
 */
export function ObsTest({ onConfirmed }: { onConfirmed?: () => void }) {
  const { me, saveSettings, toast } = useApp();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(null);
  const confirmedAt = me?.settings.onboarding.obsOkAt;

  async function run() {
    setPhase({ kind: 'testing' });
    setAnswer(null);
    try {
      const r = await api<ObsTestResult>('/api/overlay/test', {});
      setPhase({ kind: 'result', r });
    } catch (err) {
      setPhase({ kind: 'error', msg: (err as Error).message });
    }
  }

  async function confirm(ok: boolean) {
    setAnswer(ok ? 'yes' : 'no');
    if (ok) {
      await saveSettings({ onboarding: { obsOkAt: Date.now() } });
      toast('OBS pronto! ✅', 'ok');
      onConfirmed?.();
    }
  }

  const r = phase.kind === 'result' ? phase.r : null;
  const inObs = r?.replies.filter((x) => x.obs) ?? [];
  const best = inObs[0] ?? r?.replies[0];
  const warnings: string[] = [];
  if (r && r.replies.length) {
    if (!inObs.length) warnings.push('A URL está aberta numa aba do navegador, não no OBS. Cole a URL numa fonte de Navegador dentro do OBS.');
    if (best && best.obs && (best.width !== 1920 || best.height !== 1080) && best.width > 0)
      warnings.push(`A fonte está com ${best.width}×${best.height}. Nas propriedades da fonte, use largura 1920 e altura 1080 para os jogos ficarem no tamanho certo.`);
    if (inObs.length && inObs.every((x) => x.active === false)) warnings.push('A cena com a fonte não está no ar agora. O aviso aparece quando você trocar para essa cena.');
  }

  return (
    <div className="obs-test-box">
      <div className="obs-test-head">
        <div>
          <b>Testar no OBS</b>
          <span>Mostra um aviso verde por 8 segundos na fonte do OBS.</span>
        </div>
        <button className="btn primary" onClick={run} disabled={phase.kind === 'testing'}>
          {phase.kind === 'testing' ? 'Testando…' : phase.kind === 'idle' ? '📡 Testar no OBS' : 'Testar de novo'}
        </button>
      </div>

      {confirmedAt && phase.kind === 'idle' && <p className="obs-test-msg ok">✅ Você já confirmou que o overlay aparece no OBS.</p>}

      {phase.kind === 'error' && <p className="obs-test-msg bad">{phase.msg}</p>}

      {r && r.sources === 0 && (
        <div className="obs-test-msg bad">
          <b>Nenhuma fonte do OBS conectada.</b>
          <ul>
            <li>Confira se colou a URL inteira numa fonte de <b>Navegador</b>.</li>
            <li>Veja se a fonte está visível (o ícone de olho ao lado dela).</li>
            <li>
              Se marcou <i>"Desligar fonte quando não visível"</i>, deixe no ar a cena que tem a fonte.
            </li>
            <li>O OBS precisa estar aberto e com internet.</li>
          </ul>
        </div>
      )}

      {r && r.sources > 0 && r.replies.length === 0 && (
        <div className="obs-test-msg warn">
          <b>A fonte está conectada, mas não respondeu.</b>
          <p>
            Ela deve estar com uma versão antiga da página. No OBS, clique com o botão direito na fonte → <b>Propriedades</b> → <b>Atualizar cache da página atual</b>, e teste de novo.
          </p>
        </div>
      )}

      {r && r.replies.length > 0 && (
        <>
          <p className="obs-test-msg ok">
            ✅ {r.replies.length === 1 ? 'Fonte encontrada' : `${r.replies.length} fontes encontradas`}
            {best ? ` · ${best.obs ? 'OBS' : 'navegador'} · ${best.width}×${best.height}` : ''}
          </p>
          {warnings.map((w) => (
            <p key={w} className="obs-test-msg warn">
              ⚠️ {w}
            </p>
          ))}
          {answer === null && (
            <div className="obs-test-ask">
              <span>O aviso verde "Clipei conectada!" apareceu na tela do OBS?</span>
              <div>
                <button className="btn primary sm" onClick={() => void confirm(true)}>
                  Sim, apareceu
                </button>
                <button className="btn sm" onClick={() => void confirm(false)}>
                  Não apareceu
                </button>
              </div>
            </div>
          )}
          {answer === 'yes' && <p className="obs-test-msg ok">Perfeito! Os minigames vão aparecer nesse lugar. 🎉</p>}
          {answer === 'no' && (
            <div className="obs-test-msg warn">
              <b>Quase lá. O que costuma resolver:</b>
              <ul>
                <li>
                  A fonte está <b>embaixo</b> da cena do jogo: arraste a fonte para o <b>topo</b> da lista de Fontes.
                </li>
                <li>
                  A fonte está fora do quadro: clique com o botão direito nela → Transformar → <b>Ajustar à tela</b> (Ctrl+F).
                </li>
                <li>A fonte está oculta: clique no ícone de olho ao lado dela.</li>
                <li>Você colou a URL em outra cena: confira se a cena no ar é a que tem a fonte.</li>
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
