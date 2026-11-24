import { ARENA_SIZE, type ArenaPosition } from '@clipei/shared';
import { api } from '../api.ts';
import { Card, Check, Options, OverlayPreview, Status } from '../components/ui.tsx';
import { useApp } from '../state.tsx';

export function OverlayPage() {
  const { me, status, saveSettings, toast, refresh } = useApp();
  if (!me) return null;
  const l = me.settings.layout;
  const url = `${location.origin}/overlay.html?key=${me.overlayKey}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* navegador sem permissão: o campo fica selecionável */
    }
    toast('URL copiada! Cole no OBS.', 'ok');
  }

  return (
    <>
      <section className="hero">
        <div>
          <h1>
            Overlay <span>(OBS)</span>
          </h1>
          <p>Uma URL só para todos os minigames. O que você muda aqui aparece na hora no OBS.</p>
        </div>
        <Status tone={status?.overlays ? 'ok' : 'wait'}>{status?.overlays ? `OBS conectado (${status.overlays})` : 'OBS ainda não conectado'}</Status>
      </section>

      <div className="grid wide-left">
        <div className="col">
          <Card title="Prévia" subtitle="O minigame aparece aqui quando começar">
            <OverlayPreview overlayKey={me.overlayKey} />
          </Card>
          <Card title="Como adicionar no OBS">
            <div className="field">
              <label htmlFor="ovl-url">URL da fonte de navegador</label>
              <div className="copy-row">
                <input className="input" id="ovl-url" readOnly value={url} onFocus={(e) => e.target.select()} />
                <button className="btn" onClick={copy}>
                  Copiar
                </button>
              </div>
            </div>
            <ol className="steps">
              <li>
                <span>
                  No OBS, clique em <code>+</code> em Fontes → <b>Navegador</b>.
                </span>
              </li>
              <li>
                <span>
                  Cole a URL acima, largura <code>1920</code> e altura <code>1080</code>.
                </span>
              </li>
              <li>
                <span>Deixe a fonte por cima da cena do jogo. O fundo é todo transparente.</span>
              </li>
              <li>
                <span>Marque "Controlar áudio via OBS" para ajustar o som no mixer.</span>
              </li>
            </ol>
            {me.channel && (
              <>
                <div className="divider" />
                <button
                  className="btn sm"
                  onClick={async () => {
                    await api('/api/overlay/regenerate', {});
                    toast('URL nova gerada. Cole a nova no OBS.', 'ok');
                    await refresh();
                  }}
                >
                  Gerar nova URL (se vazou)
                </button>
              </>
            )}
          </Card>
        </div>
        <div className="col">
          <Card title="Visual na live">
            <div className="field">
              <span className="field-label">Modo de exibição</span>
              <Options
                name="display"
                value={l.display}
                onChange={(v) => saveSettings({ layout: { display: v } })}
                options={[
                  { value: 'overlay' as const, label: 'Sobreposto', hint: 'Fundo transparente, por cima do seu jogo' },
                  { value: 'fullscreen' as const, label: 'Tela cheia', hint: 'O minigame vira a tela da live, com cenário' },
                ]}
              />
            </div>
            {l.display === 'fullscreen' && (
              <p className="muted" style={{ marginTop: -4 }}>
                Em tela cheia o minigame ocupa a fonte inteira do OBS. Sem jogo rolando, aparece a tela "Aguardando o próximo jogo". Dica: use numa cena só para os minigames.
              </p>
            )}
            <fieldset className="plain" disabled={l.display === 'fullscreen'}>
            <div className="field">
              <span className="field-label">Posição na tela</span>
              <Options<ArenaPosition>
                tight
                name="pos"
                value={l.position}
                onChange={(v) => saveSettings({ layout: { position: v } })}
                options={[
                  { value: 'left', label: 'Esquerda' },
                  { value: 'center', label: 'Centro' },
                  { value: 'right', label: 'Direita' },
                ]}
              />
            </div>
            <div className="field">
              <span className="field-label">
                <label htmlFor="size">Tamanho do minigame</label>
                <output>{l.size}%</output>
              </span>
              <div className="size-row">
                <input
                  id="size"
                  type="range"
                  min={ARENA_SIZE.min}
                  max={ARENA_SIZE.max}
                  step={5}
                  value={l.size}
                  onChange={(e) => saveSettings({ layout: { size: Number(e.target.value) } })}
                />
                {ARENA_SIZE.presets.map((p) => (
                  <button key={p.label} className="btn sm size-preset" onClick={() => saveSettings({ layout: { size: p.value } })}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            </fieldset>
            <div className="field">
              <span className="field-label">Barra de vida</span>
              <Options
                tight
                name="hpbar"
                value={l.hpBar}
                onChange={(v) => saveSettings({ layout: { hpBar: v } })}
                options={[
                  { value: 'boss' as const, label: 'Acima do boss' },
                  { value: 'top' as const, label: 'Topo da tela' },
                ]}
              />
            </div>
            <Check checked={l.showRanking} onChange={(v) => saveSettings({ layout: { showRanking: v } })}>
              Mostrar o ranking (top dano no boss, posições na corrida)
            </Check>
            <Check checked={l.showFloor} onChange={(v) => saveSettings({ layout: { showFloor: v } })}>
              Círculo discreto no chão sob os personagens
            </Check>
          </Card>
          <Card title="Som">
            <div className="field">
              <span className="field-label">
                <label htmlFor="vol">Volume dos sons no OBS</label>
                <output>{me.settings.volume}%</output>
              </span>
              <div className="copy-row">
                <input id="vol" type="range" min={0} max={100} step={5} value={me.settings.volume} onChange={(e) => saveSettings({ volume: Number(e.target.value) })} />
                <button
                  className="btn"
                  onClick={async () => {
                    await api('/api/sound/test', {});
                    toast('Som enviado para o OBS 🔊');
                  }}
                >
                  🔊 Testar som
                </button>
              </div>
              <p className="muted">A prévia daqui fica muda para não tocar junto com o OBS.</p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
