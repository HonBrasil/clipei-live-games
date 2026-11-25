import { parseCommand, type BossSkinId, type ChatEvent } from '@clipei/shared';

/**
 * Comandos do streamer e dos moderadores pelo chat:
 *   !boss                    → ajuda (qualquer pessoa)
 *   !boss iniciar [boss]     → invoca (mod/streamer)
 *   !boss brasa              → atalho: invoca esse boss
 *   !boss surpresa           → invoca um boss sorteado
 *   !boss parar              → encerra
 */
export type BossChatCommand =
  | { type: 'help' }
  | { type: 'start'; skin?: BossSkinId | 'random' }
  | { type: 'stop' };

const START = ['iniciar', 'comecar', 'start', 'invocar', 'chamar'];
const STOP = ['parar', 'encerrar', 'stop', 'fim', 'cancelar'];
const HELP = ['ajuda', 'help', 'comandos', '?'];
const RANDOM = ['surpresa', 'aleatorio', 'random'];

/** Apelidos aceitos para cada boss (sem acento, minúsculos). */
export const SKIN_ALIASES: Record<string, BossSkinId> = {
  glitchador: 'glitchador',
  glitch: 'glitchador',
  ciclope: 'glitchador',
  gosmao: 'gosmao',
  slime: 'gosmao',
  gosma: 'gosmao',
  brasa: 'brasa',
  dragao: 'brasa',
  dragon: 'brasa',
  ossudo: 'ossudo',
  esqueleto: 'ossudo',
  caveira: 'ossudo',
  mecha: 'mechaz',
  mechaz: 'mechaz',
  'mecha-z': 'mechaz',
  robo: 'mechaz',
  robot: 'mechaz',
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

function skinFrom(word: string | undefined): BossSkinId | 'random' | undefined {
  if (!word) return undefined;
  const w = norm(word);
  if (RANDOM.includes(w)) return 'random';
  return SKIN_ALIASES[w];
}

export function parseBossChatCommand(event: ChatEvent): BossChatCommand | null {
  const cmd = parseCommand(event.text);
  if (!cmd || cmd.name !== 'boss') return null;
  const [first, second] = cmd.args.map(norm);
  const canControl = event.user.isMod || event.user.isBroadcaster;

  if (!first || HELP.includes(first)) return { type: 'help' };
  if (!canControl) return null; // espectador comum: ignora em silêncio
  if (STOP.includes(first)) return { type: 'stop' };
  if (START.includes(first)) return { type: 'start', skin: skinFrom(second) };
  const skin = skinFrom(first);
  if (skin) return { type: 'start', skin };
  return { type: 'help' };
}

export function bossHelpText(isRunning: boolean) {
  return isRunning
    ? 'Boss na arena! Digite !atk para atacar (e !ult uma vez por luta).'
    : 'Mods: !boss iniciar · !boss brasa (ou gosmao, ossudo, mecha, glitchador, surpresa) · !boss parar. Na luta: !atk e !ult.';
}
