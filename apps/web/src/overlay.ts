import './styles/overlay.css';
import { mountOverlay } from './overlay-view.ts';
import { connectRoom } from './ws.ts';

// ─── Parâmetros da URL ───────────────────────────────────────
// ?key=xxxx      chave do canal
// &preview=1     prévia do painel: mostra "aguardando" e fica muda
// Posição, tamanho e visual vêm das configurações (mudam ao vivo).
const params = new URLSearchParams(location.search);

const view = mountOverlay(document.getElementById('stage')!, {
  preview: params.get('preview') === '1',
  // na prévia do painel o som fica mudo para não tocar junto com o OBS
  muted: params.get('preview') === '1',
});

connectRoom(
  params.get('key') ?? 'demo',
  (msg) => {
    if (msg.type === 'boss') view.render(msg.state);
    if (msg.type === 'race') view.renderRace(msg.state);
    if (msg.type === 'duel') view.renderDuel(msg.state);
    if (msg.type === 'royale') view.renderRoyale(msg.state);
    if (msg.type === 'kite') view.renderKite(msg.state);
    if (msg.type === 'penalty') view.renderPenalty(msg.state);
    if (msg.type === 'settings') view.setSettings(msg.settings);
    if (msg.type === 'incoming') view.incoming(msg.at, msg.serverNow);
    if (msg.type === 'sfx-test') view.testSound();
  },
  (online) => view.setOnline(online),
);
