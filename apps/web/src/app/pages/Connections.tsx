import { useEffect, useState } from 'react';
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
            <KickRow />
            <YoutubeRow />
          </div>
        </Card>
      </div>
    </>
  );
}

/** Kick: conectar o canal (OAuth), status do chat pelo webhook e desconectar. */
function KickRow() {
  const { me, refresh, toast } = useApp();
  const k = me?.kick;
  const waiting = Boolean(k?.connected && !k.lastEventAt);
  // conectado e ainda sem mensagem: confere a cada 5 s até o chat chegar
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [waiting, refresh]);
  if (!me || !k) return null;

  if (!k.configured) {
    return (
      <div className="conn soon">
        <div className="conn-logo kick">K</div>
        <div className="conn-info">
          <b>Kick</b>
          <span>Em preparação</span>
        </div>
        <span className="tag soon">Em breve</span>
      </div>
    );
  }

  if (!k.connected) {
    return (
      <div className="conn">
        <div className="conn-logo kick">K</div>
        <div className="conn-info">
          <b>Kick</b>
          <span>Entre na Kick com a sua conta de streamer e clique em Conectar</span>
        </div>
        <a className="btn sm kick" href="/api/auth/kick/login">
          Conectar
        </a>
      </div>
    );
  }

  const ago = k.lastEventAt ? Math.max(0, Math.round((Date.now() - k.lastEventAt) / 1000)) : null;
  const agoText = ago === null ? '' : ago < 60 ? `há ${ago}s` : ago < 3600 ? `há ${Math.round(ago / 60)} min` : `há ${Math.round(ago / 3600)} h`;
  return (
    <>
      <div className="conn">
        <div className="conn-logo kick">K</div>
        <div className="conn-info">
          <b>Kick</b>
          <span>
            {k.name ?? k.slug}
            {k.live ? ' · ao vivo' : ''}
          </span>
        </div>
        <Status tone={k.problem ? '' : ago !== null ? 'ok' : 'wait'}>{k.problem ? 'Com problema' : ago !== null ? `Recebendo (${agoText})` : 'Mande uma mensagem no chat'}</Status>
        {me.primary !== 'kick' && (
          <button
            className="btn sm"
            onClick={async () => {
              try {
                await api('/api/auth/kick/disconnect', {});
                toast('Kick desconectada.');
                await refresh();
              } catch (err) {
                toast((err as Error).message, 'err');
              }
            }}
          >
            Desconectar
          </button>
        )}
      </div>
      {k.problem && <p className="chat-error">{k.problem}</p>}
      {!k.problem && k.chatAs === 'streamer' && (
        <p className="muted foot-note">
          💬 Na Kick, as mensagens dos jogos estão saindo pela <b>sua conta</b>: a Kick ainda não libera o bot oficial para apps novos. Assim que o bot da Clipei for ligado, elas passam a sair por ele automaticamente.
        </p>
      )}
      {!k.problem && k.chatAs && k.chatAs !== 'streamer' && <p className="muted foot-note">💬 Na Kick, o bot fala como {k.chatAs === 'clipeibot' ? (k.botName ?? 'bot da Clipei') : 'bot oficial da Clipei'}.</p>}
      {k.missingScopes.length > 0 && (
        <p className="chat-error">
          Faltam permissões da Kick. <a href="/api/auth/kick/login">Reconectar</a>
        </p>
      )}
    </>
  );
}

/** YouTube: conectar o canal, achar a live, status do chat e do bot. */
function YoutubeRow() {
  const { me, refresh, toast } = useApp();
  const y = me?.youtube;
  const [checking, setChecking] = useState(false);
  // live no ar e chat ainda sem mensagem: atualiza a cada 5 s
  const waiting = Boolean(y?.connected && y.chatConnected && !y.lastEventAt);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [waiting, refresh]);
  if (!me || !y) return null;

  if (!y.configured) {
    return (
      <div className="conn soon">
        <div className="conn-logo yt">▶</div>
        <div className="conn-info">
          <b>YouTube</b>
          <span>Em preparação</span>
        </div>
        <span className="tag soon">Em breve</span>
      </div>
    );
  }
  if (!y.connected) {
    return (
      <div className="conn">
        <div className="conn-logo yt">▶</div>
        <div className="conn-info">
          <b>YouTube</b>
          <span>Entre com a conta Google do seu canal</span>
        </div>
        <a className="btn sm yt" href="/api/auth/youtube/login">
          Conectar
        </a>
      </div>
    );
  }

  const ago = y.lastEventAt ? Math.max(0, Math.round((Date.now() - y.lastEventAt) / 1000)) : null;
  const agoText = ago === null ? '' : ago < 60 ? `há ${ago}s` : ago < 3600 ? `há ${Math.round(ago / 60)} min` : `há ${Math.round(ago / 3600)} h`;
  const label = y.problem ? 'Com problema' : !y.live ? 'Fora do ar' : !y.chatConnected ? 'Conectando ao chat…' : ago !== null ? `Recebendo (${agoText})` : 'Mande uma mensagem no chat';
  return (
    <>
      <div className="conn">
        <div className="conn-logo yt">▶</div>
        <div className="conn-info">
          <b>YouTube</b>
          <span>
            {y.name}
            {y.handle ? ` · ${y.handle}` : ''}
            {y.live ? ' · ao vivo' : ''}
          </span>
        </div>
        <Status tone={y.problem ? '' : y.live && y.chatConnected ? 'ok' : 'wait'}>{label}</Status>
        <button
          className="btn sm"
          disabled={checking}
          onClick={async () => {
            setChecking(true);
            try {
              const r = await api<{ live: boolean; chatConnected: boolean; problem: string | null }>('/api/youtube/check', {});
              if (r.problem) toast(r.problem, 'err');
              else toast(r.live ? 'Live encontrada, chat conectado! ▶️' : 'Nenhuma live no ar agora neste canal.', r.live ? 'ok' : undefined);
              await refresh();
            } catch (err) {
              toast((err as Error).message, 'err');
            } finally {
              setChecking(false);
            }
          }}
        >
          {checking ? 'Procurando…' : 'Procurar live'}
        </button>
        {me.primary !== 'youtube' && (
          <button
            className="btn sm"
            onClick={async () => {
              try {
                await api('/api/auth/youtube/disconnect', {});
                toast('YouTube desconectado.');
                await refresh();
              } catch (err) {
                toast((err as Error).message, 'err');
              }
            }}
          >
            Desconectar
          </button>
        )}
      </div>
      {y.problem && <p className="chat-error">{y.problem}</p>}
      <p className="muted foot-note">
        Com o OBS aberto, a Clipei procura sua live sozinha a cada 2 minutos (ou clique em Procurar live).{' '}
        {y.botConnected
          ? `O bot fala no chat como ${y.botName}; deixe ele como moderador para não ser barrado por modo lento.`
          : 'O bot do YouTube ainda não está ativo: os jogos funcionam, só sem os anúncios no chat.'}
      </p>
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
