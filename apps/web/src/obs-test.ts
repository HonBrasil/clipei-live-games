/**
 * "Testar no OBS": aviso grande no meio da fonte por alguns segundos e
 * informações para o painel conferir (está no OBS? tamanho? cena no ar?).
 */

interface ObsStudio {
  pluginVersion?: string;
}
declare global {
  interface Window {
    obsstudio?: ObsStudio;
  }
}

// o OBS avisa quando a cena com a fonte entra ou sai do ar
let active: boolean | null = null;
window.addEventListener('obsSourceActiveChanged', (e) => {
  active = Boolean((e as CustomEvent<{ active?: boolean }>).detail?.active);
});

export function obsInfo() {
  return { obs: Boolean(window.obsstudio), width: window.innerWidth, height: window.innerHeight, active };
}

let timer = 0;
export function showObsTest() {
  document.querySelector('.obs-test')?.remove();
  window.clearTimeout(timer);
  const { obs, width, height } = obsInfo();
  const el = document.createElement('div');
  el.className = 'obs-test';
  el.innerHTML = `<div class="obs-test-card">
    <span class="obs-test-ico">✓</span>
    <b>Clipei conectada!</b>
    <p>Os minigames vão aparecer aqui.</p>
    <small>${obs ? 'Fonte do OBS' : 'Navegador'} · ${width}×${height} · some em 8 s</small>
  </div>`;
  document.body.append(el);
  timer = window.setTimeout(() => {
    el.classList.add('is-out');
    window.setTimeout(() => el.remove(), 400);
  }, 8000);
}
