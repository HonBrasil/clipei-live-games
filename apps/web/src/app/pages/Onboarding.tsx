import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LOOP_GAME_INFO } from '@clipei/shared';
import { api } from '../api.ts';
import { ObsTest } from '../components/ObsTest.tsx';
import { OverlayPreview } from '../components/ui.tsx';
import { useApp } from '../state.tsx';

/** As 4 etapas da configuração guiada e se cada uma já foi feita. */
export function useOnboarding() {
  const { me } = useApp();
  if (!me) return null;
  const ob = me.settings.onboarding;
  const platform = Boolean(me.channel) && (me.twitch.chatListening || me.kick.connected || me.youtube.connected);
  const steps = [
    { id: 'plataforma', title: 'Conectar sua plataforma', short: 'Plataforma', done: platform },
    { id: 'obs', title: 'Colocar no OBS', short: 'OBS', done: Boolean(ob.obsOkAt) },
    { id: 'teste', title: 'Testar com chat simulado', short: 'Teste', done: Boolean(ob.testOkAt) || me.history.length > 0 },
    { id: 'automatico', title: 'Ligar o Automático', short: 'Automático', done: me.settings.loop.enabled },
  ] as const;
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, doneCount, complete: doneCount === steps.length, dismissed: ob.dismissed };
}

export function OnboardingPage() {
  const ob = useOnboarding();
  const { saveSettings } = useApp();
  const navigate = useNavigate();
  const firstOpen = ob ? Math.max(0, ob.steps.findIndex((s) => !s.done)) : 0;
  const [step, setStep] = useState(firstOpen);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);
  if (!ob) return null;
  const cur = ob.steps[step];
  const next = () => setStep((s) => Math.min(ob.steps.length - 1, s + 1));
  const pct = Math.round((ob.doneCount / ob.steps.length) * 100);

  return (
    <>
      <section className="hero">
        <div>
          <p className="crumbs">
            <Link to="/app">Início</Link> / Primeiros passos
          </p>
          <h1>
            Configure em <span>3 minutos</span>
          </h1>
          <p>Quatro passos e o seu chat já pode jogar. Dá para parar e continuar depois: o progresso fica salvo.</p>
        </div>
        <div className="ob-ring" style={{ ['--p' as string]: pct }} aria-label={`${ob.doneCount} de ${ob.steps.length} passos feitos`}>
          <b>
            {ob.doneCount}/{ob.steps.length}
          </b>
          <small>feitos</small>
        </div>
      </section>

      {ob.complete && (
        <section className="card ob-finish">
          <span className="ob-finish-ico">🎉</span>
          <div>
            <h2>Tudo pronto!</h2>
            <p>O Automático vai colocar minigames na sua live sozinho. Quando quiser, chame um jogo na hora pela página Minigames.</p>
          </div>
          <div className="ob-finish-act">
            <Link className="btn primary" to="/app/jogos">
              Ver os minigames
            </Link>
            <Link className="btn" to="/app">
              Ir para o início
            </Link>
          </div>
        </section>
      )}

      <div className="ob">
        <ol className="ob-steps" aria-label="Passos">
          {ob.steps.map((s, i) => (
            <li key={s.id}>
              <button className={`ob-step ${i === step ? 'is-cur' : ''} ${s.done ? 'is-done' : ''}`} onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined}>
                <span className="ob-num">{s.done ? '✓' : i + 1}</span>
                <span className="ob-label">
                  <b>{s.title}</b>
                  <small>{s.done ? 'Feito' : i === step ? 'Agora' : 'Pendente'}</small>
                </span>
                <span className="ob-short">{s.short}</span>
              </button>
            </li>
          ))}
        </ol>

        <section className="card ob-body">
          <header className="ob-body-head">
            <span className="ob-kicker">
              Passo {step + 1} de {ob.steps.length}
            </span>
            <h2>{cur.title}</h2>
          </header>
          {cur.id === 'plataforma' && <PlatformStep />}
          {cur.id === 'obs' && <ObsStep onDone={next} />}
          {cur.id === 'teste' && <TestStep />}
          {cur.id === 'automatico' && <AutoStep />}
          <footer className="ob-nav">
            {step > 0 ? (
              <button className="btn" onClick={() => setStep(step - 1)}>
                ← Voltar
              </button>
            ) : (
              <span />
            )}
            {step < ob.steps.length - 1 ? (
              <button className={`btn ${cur.done ? 'primary' : ''}`} onClick={next}>
                {cur.done ? 'Próximo passo →' : 'Pular por agora →'}
              </button>
            ) : (
              <button className={`btn ${ob.complete ? 'primary' : ''}`} onClick={() => navigate('/app')}>
                {ob.complete ? 'Concluir' : 'Terminar depois'}
              </button>
            )}
          </footer>
        </section>
      </div>

      {!ob.complete && (
        <p className="ob-hide">
          Já sabe usar?{' '}
          <button
            className="link-btn"
            onClick={async () => {
              await saveSettings({ onboarding: { dismissed: true } });
              navigate('/app');
            }}
          >
            Esconder a configuração guiada
          </button>
        </p>
      )}
    </>
  );
}

// ─── Passo 1: plataforma ────────────────────────────────────

function PlatformStep() {
  const { me } = useApp();
  if (!me) return null;
  const t = me.twitch;
  const k = me.kick;
  const rows = [
    {
      key: 'twitch',
      logo: 'T',
      name: 'Twitch',
      show: t.configured,
      connected: t.streamerConnected,
      detail: t.streamerConnected ? (t.chatListening ? 'Bot da Clipei ouvindo o seu chat' : 'Conectando o bot ao seu chat…') : 'Entre com a sua conta da Twitch',
      ok: t.streamerConnected && t.chatListening,
      href: '/api/auth/twitch/login',
    },
    {
      key: 'kick',
      logo: 'K',
      name: 'Kick',
      show: k.configured,
      connected: k.connected,
      detail: k.connected ? `Conectada como ${k.name ?? k.slug}` : 'Entre com a sua conta da Kick',
      ok: k.connected,
      href: '/api/auth/kick/login',
    },
  ].filter((r) => r.show);
  if (!me.channel || !rows.length)
    return (
      <>
        <p className="ob-lead">Entre com a conta onde você faz live. A conta da Clipei é criada na hora, com 7 dias grátis.</p>
        <div className="ob-actions">
          <a className="btn twitch lg" href="/api/auth/twitch/login">
            Entrar com a Twitch
          </a>
          <a className="btn kick lg" href="/api/auth/kick/login">
            Entrar com a Kick
          </a>
        </div>
        <p className="muted foot-note">A Clipei só lê o chat e fala pelo bot. Não publica nada no seu nome.</p>
      </>
    );
  return (
    <>
      <p className="ob-lead">Conecte onde você faz live. Dá para usar Twitch e Kick ao mesmo tempo: o chat das duas joga junto.</p>
      <div className="conn-list">
        {rows.map((r) => (
          <div className="conn" key={r.key}>
            <div className={`conn-logo ${r.key}`}>{r.logo}</div>
            <div className="conn-info">
              <b>{r.name}</b>
              <span>{r.detail}</span>
            </div>
            {r.connected ? (
              <span className={`pill ${r.ok ? 'ok' : ''}`}>{r.ok ? '✓ Pronto' : 'Quase'}</span>
            ) : (
              <a className={`btn sm ${r.key}`} href={r.href}>
                Conectar
              </a>
            )}
          </div>
        ))}
      </div>
      <p className="muted foot-note">A Clipei só lê o chat e fala pelo bot. Não publica nada no seu nome e você pode desconectar quando quiser em Conexões.</p>
    </>
  );
}

// ─── Passo 2: OBS ───────────────────────────────────────────

function ObsStep({ onDone }: { onDone: () => void }) {
  const { me, toast, status } = useApp();
  if (!me) return null;
  const url = `${location.origin}/overlay.html?key=${me.overlayKey}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* o campo fica selecionável */
    }
    toast('URL copiada! Agora cole no OBS.', 'ok');
  }
  return (
    <>
      <p className="ob-lead">Uma URL só serve para todos os minigames. Você coloca uma vez e esquece.</p>
      <div className="copy-row">
        <input className="input" readOnly value={url} aria-label="URL do overlay" onFocus={(e) => e.target.select()} />
        <button className="btn primary" onClick={copy}>
          Copiar URL
        </button>
      </div>
      <ol className="ob-howto">
        <li>
          <b>No OBS, em Fontes, clique em + → Navegador</b>
          <span>Dê um nome, como "Clipei".</span>
        </li>
        <li>
          <b>Cole a URL e use 1920 × 1080</b>
          <span>Largura 1920, altura 1080. Pode marcar "Controlar áudio via OBS".</span>
        </li>
        <li>
          <b>Deixe a fonte no topo da lista</b>
          <span>Por cima da câmera e do jogo. O fundo é transparente.</span>
        </li>
      </ol>
      <div className={`ob-obs-status ${status?.overlays ? 'on' : ''}`}>
        <i className="dot" />
        {status?.overlays ? `OBS conectado (${status.overlays} ${status.overlays === 1 ? 'fonte' : 'fontes'}). Agora teste:` : 'Esperando o OBS conectar…'}
      </div>
      <ObsTest onConfirmed={onDone} />
    </>
  );
}

// ─── Passo 3: teste ─────────────────────────────────────────

function TestStep() {
  const { me, boss, saveSettings, toast } = useApp();
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const running = boss?.state?.status === 'running';
  async function start() {
    setBusy(true);
    try {
      await api('/api/boss/start', { preset: 'auto' });
      await api('/api/simulator', { running: true, viewers: 40, messagesPerSecond: 6 });
      await saveSettings({ onboarding: { testOkAt: Date.now() } });
      toast('Teste no ar! Veja na prévia e no OBS ⚔️', 'ok');
    } catch (err) {
      toast((err as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    await api('/api/boss/stop', {});
    await api('/api/simulator', { running: false });
  }
  return (
    <>
      <p className="ob-lead">Veja um minigame de verdade sem estar ao vivo: 40 espectadores falsos atacam um boss. Nada aparece no seu chat.</p>
      <OverlayPreview overlayKey={me.overlayKey} />
      <div className="ob-actions">
        {running ? (
          <button className="btn" onClick={() => void stop()}>
            ⏹ Parar o teste
          </button>
        ) : (
          <button className="btn primary lg" onClick={() => void start()} disabled={busy}>
            {busy ? 'Começando…' : '⚔️ Rodar o teste'}
          </button>
        )}
        <Link className="btn" to="/app/testar">
          Mais opções de teste
        </Link>
      </div>
      <p className="muted foot-note">O chat simulado desliga sozinho quando o boss morre. No ao vivo, quem ataca é o seu chat com !atk.</p>
    </>
  );
}

// ─── Passo 4: Automático ────────────────────────────────────

const INTERVALS = [10, 15, 20, 30];

function AutoStep() {
  const { me, saveSettings, toast } = useApp();
  const loop = me?.settings.loop;
  const [every, setEvery] = useState(loop && INTERVALS.includes(loop.intervalMin) ? loop.intervalMin : 15);
  if (!me || !loop) return null;
  async function enable() {
    await saveSettings({ loop: { enabled: true, mode: 'timer', intervalMin: every } });
    toast(`Automático ligado: um minigame a cada ${every} min 🔁`, 'ok');
  }
  return (
    <>
      <p className="ob-lead">Com o Automático, a Clipei coloca um minigame na sua live de tempos em tempos. O bot avisa no chat 1 minuto antes.</p>
      {loop.enabled ? (
        <div className="ob-auto-on">
          <span>🔁</span>
          <div>
            <b>Automático ligado</b>
            <small>{loop.mode === 'timer' ? `Um minigame a cada ${loop.intervalMin} min` : 'Modo Loop: um jogo atrás do outro'}</small>
          </div>
          <Link className="btn sm" to="/app/automatico">
            Ajustar
          </Link>
        </div>
      ) : (
        <>
          <span className="field-label">De quanto em quanto tempo?</span>
          <div className="ob-chips" role="radiogroup">
            {INTERVALS.map((m) => (
              <button key={m} role="radio" aria-checked={every === m} className={`ob-chip ${every === m ? 'on' : ''}`} onClick={() => setEvery(m)}>
                <b>{m}</b>
                <small>min</small>
              </button>
            ))}
          </div>
          <div className="ob-games">
            {loop.games.map((g) => (
              <span key={g} className="pill">
                {LOOP_GAME_INFO[g].emoji} {LOOP_GAME_INFO[g].name}
              </span>
            ))}
          </div>
          <div className="ob-actions">
            <button className="btn primary lg" onClick={() => void enable()}>
              🔁 Ligar o Automático
            </button>
            <Link className="btn" to="/app/automatico">
              Escolher os jogos
            </Link>
          </div>
        </>
      )}
      <p className="muted foot-note">Só roda com você ao vivo. Se tiver um jogo rolando, espera ele acabar. Dá para desligar a qualquer hora.</p>
    </>
  );
}
