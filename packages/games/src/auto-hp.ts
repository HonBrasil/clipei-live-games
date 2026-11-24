/**
 * Vida automática do boss: calculada pelo tamanho do chat ativo para que a luta
 * dure por volta de 70% do tempo limite (sobra tensão no fim, sem virar fuga certa).
 *
 * Premissas (ajustáveis com dados reais de lives):
 *  - 60% das pessoas ativas no chat entram na luta;
 *  - cada uma ataca em ~45% do ritmo máximo permitido pelo cooldown;
 *  - dano médio ≈ 14 por golpe (8–15 + críticos), fúria e desespero se compensam.
 */
export const AUTO_HP = {
  participation: 0.6,
  pace: 0.45,
  avgDamage: 14.4,
  targetShare: 0.7,
  noLimitTargetSec: 180,
  min: 800,
  max: 5_000_000,
};

export interface AutoHpInput {
  activeChatters: number;
  cooldownMs: number;
  durationSec: number;
}

export function autoBossHp({ activeChatters, cooldownMs, durationSec }: AutoHpInput) {
  const people = Math.max(3, activeChatters);
  const attacksPerSec = Math.min(1, 1000 / Math.max(500, cooldownMs)) * AUTO_HP.pace;
  const dps = people * AUTO_HP.participation * attacksPerSec * AUTO_HP.avgDamage;
  const seconds = (durationSec || AUTO_HP.noLimitTargetSec) * AUTO_HP.targetShare;
  return niceRound(Math.min(AUTO_HP.max, Math.max(AUTO_HP.min, dps * seconds)));
}

/** Arredonda para 2 algarismos significativos: 9.837 → 9.800; 123.456 → 120.000. */
export function niceRound(n: number) {
  if (n <= 0) return 0;
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(n)) - 1));
  return Math.round(n / mag) * mag;
}
