/**
 * Arte do boss "Glitchador" — personagem original da Clipei, desenhado em SVG
 * para escalar sem perder qualidade no OBS (1080p, 1440p, 4K).
 */
export const BOSS_SVG = /* html */ `
<svg viewBox="0 0 320 320" xmlns="http://www.w3.org/2000/svg" class="boss-svg" aria-hidden="true">
  <defs>
    <radialGradient id="g-core" cx="50%" cy="45%" r="60%">
      <stop offset="0%" stop-color="#3a1d6e"/>
      <stop offset="70%" stop-color="#170b2e"/>
      <stop offset="100%" stop-color="#0b0618"/>
    </radialGradient>
    <linearGradient id="g-edge" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="var(--boss-a, #b46bff)"/>
      <stop offset="100%" stop-color="var(--boss-b, #2de2ff)"/>
    </linearGradient>
    <radialGradient id="g-eye" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fff"/>
      <stop offset="35%" stop-color="var(--boss-eye, #ff3d9a)"/>
      <stop offset="100%" stop-color="#3b0020"/>
    </radialGradient>
    <filter id="f-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- estilhaços orbitando -->
  <g class="boss-shards" fill="url(#g-edge)" filter="url(#f-glow)">
    <polygon points="40,70 58,62 52,84"/>
    <polygon points="272,88 290,98 274,110"/>
    <polygon points="36,214 54,222 40,238"/>
    <polygon points="278,220 296,212 290,236"/>
  </g>

  <!-- chifres -->
  <g fill="url(#g-edge)" filter="url(#f-glow)">
    <polygon points="98,92 70,28 120,78"/>
    <polygon points="222,92 250,28 200,78"/>
  </g>

  <!-- corpo hexagonal -->
  <g class="boss-body">
    <polygon points="160,52 262,110 262,214 160,272 58,214 58,110"
             fill="url(#g-core)" stroke="url(#g-edge)" stroke-width="6" stroke-linejoin="round" filter="url(#f-glow)"/>
    <!-- fatias de glitch -->
    <rect class="glitch-a" x="66" y="132" width="70" height="6" fill="var(--boss-b, #2de2ff)" opacity=".55"/>
    <rect class="glitch-b" x="190" y="196" width="58" height="5" fill="var(--boss-a, #b46bff)" opacity=".6"/>
    <rect class="glitch-c" x="96" y="226" width="40" height="4" fill="var(--boss-eye, #ff3d9a)" opacity=".6"/>

    <!-- olho -->
    <g class="boss-eye">
      <ellipse cx="160" cy="150" rx="50" ry="38" fill="#0b0618" stroke="url(#g-edge)" stroke-width="4"/>
      <circle cx="160" cy="150" r="26" fill="url(#g-eye)" filter="url(#f-glow)"/>
      <rect x="156" y="134" width="8" height="32" rx="4" fill="#0b0618"/>
    </g>

    <!-- boca de pixels -->
    <g class="boss-mouth" fill="var(--boss-b, #2de2ff)" filter="url(#f-glow)">
      <rect x="118" y="214" width="12" height="12"/>
      <rect x="136" y="220" width="12" height="12"/>
      <rect x="154" y="214" width="12" height="12"/>
      <rect x="172" y="220" width="12" height="12"/>
      <rect x="190" y="214" width="12" height="12"/>
    </g>
  </g>
</svg>`;
