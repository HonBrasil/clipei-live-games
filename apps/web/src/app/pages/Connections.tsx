import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.ts';
import { Card, Status, Switch } from '../components/ui.tsx';
import { useApp } from '../state.tsx';

export function Connections() {
  const { me, refresh, toast } = useApp();

  // enquanto o chat conecta, confere de novo a cada 4 s
  useEffect(() => {
    if (!me?.channel || !me.twitch.botConnected || me.twitch.chatListening) return;
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [me?.channel, me?.twitch.botConnected, me?.twitch.chatListening, refresh]);

  if (!me) return null;
  const t = me.twitch;
  const ch = me.primary === 'twitch' ? me.channel : null;

  return (
    <>
      <section className="hero">
        <div>
          <h1>
            Cone<span>xões</span>
          </h1>
          <p>Seu canal e o bot da Clipei, que lê e fala no seu chat.</p>
        </div>
      </section>

      {me.missingScopes.length > 0 && (
        <div className="banner warn">
          <div className="grow">
            <b>Libere as novas permissões da Twitch</b>
            <span>Para bits, subs, pontos de canal e clip automático, reconecte seu canal e aceite as permissões.</span>
          </div>
          <a className="btn twitch" href="/api/auth/twitch/login">
            Reconectar
          </a>
        </div>
      )}

      <div className="grid">
        <Card title="Twitch" subtitle="Ativa">
          <div className="conn-list">
            <div className="conn">
              <div className="conn-logo twitch">T</div>
              <div className="conn-info">
                <b>Seu canal</b>
                <span>{ch ? ch.login : 'Não conectado'}</span>
              </div>
              {ch ? (
                <Status tone={t.chatListening ? 'ok' : 'wait'}>{t.chatListening ? 'Ouvindo chat' : t.botConnected ? 'Conectando…' : 'Bot indisponível'}</Status>
              ) : (
                <a className={`btn sm twitch ${t.configured ? '' : 'disabled'}`} href="/api/auth/twitch/login">
                  Conectar
                </a>
              )}
            </div>
            {ch && !t.chatListening && t.chatError && <p className="chat-error">{t.chatError}</p>}
          </div>
        </Card>

        <BotCard />
      </div>

      <div className="grid" style={{ marginTop: 20 }}>
        <Card title="Outras plataformas">
          <div className="conn-list">
            <div className="conn soon">
              <div className="conn-logo kick">K</div>
              <div className="conn-info">
                <b>Kick</b>
                <span>Integração pronta, liberada depois do lançamento</span>
              </div>
              <span className="tag soon">Em breve</span>
            </div>
            <div className="conn soon">
              <div className="conn-logo yt">▶</div>
              <div className="conn-info">
                <b>YouTube</b>
                <span>Em preparação</span>
              </div>
              <span className="tag soon">Em breve</span>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

/** O bot é da Clipei: o streamer só decide se ele fala no chat. Quem conecta a conta é o admin. */
function BotCard() {
  const { me, toast, saveSettings } = useApp();
  if (!me) return null;
  const t = me.twitch;
  const ch = me.primary === 'twitch' ? me.channel : null;
  const botLogin = t.botName ?? 'ClipeiBot';
  const speak = me.settings.bot.speak;

  return (
    <Card
      title="Bot da Clipei"
      subtitle="Lê o chat para os jogos e anuncia boss, fases e vitórias"
      right={
        t.botConnected ? (
          <span className="switch-label">
            {speak ? 'Fala no chat' : 'Silencioso'}
            <Switch label="Bot fala no chat" checked={speak} onChange={(v) => saveSettings({ bot: { speak: v } })} />
          </span>
        ) : undefined
      }
    >
      <div className="conn">
        <div className="conn-logo bot">🤖</div>
        <div className="conn-info">
          <b>{t.botConnected ? botLogin : 'Bot indisponível'}</b>
          <span>
            {!t.botConnected
              ? 'Em manutenção: a equipe da Clipei está ajustando o bot.'
              : !ch
                ? 'Entra no chat assim que você conectar a Twitch.'
                : speak
                  ? 'Ativo no seu chat'
                  : 'Lendo o chat em silêncio (sem mensagens)'}
          </span>
        </div>
        {ch && t.botConnected && <Status tone={t.chatListening ? 'ok' : 'wait'}>{t.chatListening ? 'No chat' : 'Entrando…'}</Status>}
      </div>

      {ch && t.botConnected && (
        <>
          <div className="tip">
            <b>Dica:</b> dê mod ao bot para ele não cair em modo lento nem no filtro de links (o link do clip). No seu chat, digite:
            <div className="copy-row" style={{ marginTop: 8 }}>
              <code className="cmd-line">/mod {botLogin}</code>
              <button
                className="btn sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(`/mod ${botLogin}`);
                    toast('Comando copiado!', 'ok');
                  } catch {
                    toast(`Digite /mod ${botLogin} no seu chat`);
                  }
                }}
              >
                Copiar
              </button>
            </div>
          </div>
          <button
            className="btn block"
            style={{ marginTop: 12 }}
            disabled={!speak}
            onClick={async () => {
              try {
                await api('/api/chat/test', {});
                toast('Mensagem enviada! Confira o chat.', 'ok');
              } catch (err) {
                toast((err as Error).message, 'err');
              }
            }}
          >
            Mandar mensagem de teste no chat
          </button>
        </>
      )}
      {me.admin && (
        <p className="muted" style={{ marginTop: 12 }}>
          Você é admin: a conta do bot é gerenciada em <Link to="/app/admin">Admin</Link>.
        </p>
      )}
    </Card>
  );
}
