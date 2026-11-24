import { BOSS_SKINS } from '@clipei/shared';
import { formatNumber, type BossEvent } from './boss.ts';

/** Textos que o bot manda no chat a cada evento do Boss. */
export function bossAnnouncement(event: BossEvent, bossName: string): string | null {
  switch (event.type) {
    case 'started': {
      const limit = event.config.durationSec ? ` Vocês têm ${formatDuration(event.config.durationSec * 1000)}.` : '';
      const skin = BOSS_SKINS[event.config.skin] ?? BOSS_SKINS.glitchador;
      return `${skin.emoji} ${bossName} ${skin.intro} com ${formatNumber(event.config.maxHp)} de vida!${limit} Digite !atk para atacar — e !ult uma vez por luta. Bora, chat!`;
    }
    case 'phase':
      return event.phase === 2
        ? `😡 ${bossName} entrou em FÚRIA! A armadura subiu, o dano caiu — não parem de atacar!`
        : `💥 ${bossName} está em DESESPERO! Dano +50% — é AGORA, chat! !atk !atk !atk`;
    case 'victory': {
      const top = event.top.map((p, i) => `${i + 1}) ${p.name} (${formatNumber(p.damage)})`).join('  ');
      return `🏆 ${bossName} foi derrotado em ${formatDuration(event.durationMs)} por ${event.participants} guerreiros! Golpe final: ${event.finalBlow}. Top dano: ${top}`;
    }
    case 'escaped':
      return `💨 ${bossName} fugiu com ${formatNumber(event.hpLeft)} de vida… ${event.participants} pessoas lutaram. Revanche na próxima!`;
    default:
      return null;
  }
}

export function formatDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? `${m}min${s ? ` ${String(s).padStart(2, '0')}s` : ''}` : `${s}s`;
}

export function incomingAnnouncement(skinName: string | null) {
  return skinName
    ? `⚠️ ${skinName} vai invadir a live em 1 minuto! Preparem os dedos: !atk`
    : '⚠️ Um boss misterioso vai invadir a live em 1 minuto! Preparem os dedos: !atk';
}
