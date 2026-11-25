import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FOUNDER_SLOTS, GAMES, TRIAL_DAYS, type MeResponse } from '@clipei/shared';
import { api } from '../api.ts';
import { Icon } from '../components/icons.tsx';
import { BossThumb, Logo } from '../components/ui.tsx';
import { FounderStrip, PlanCards } from '../components/plans.tsx';

/** Só os minigames lançados aparecem no site. */
const LIVE_GAMES = GAMES.filter((g) => g.status === 'active');

const STEPS = [
  { title: 'Conecte sua Twitch ou Kick', text: 'Um clique para entrar. O bot da Clipei passa a ler e responder o chat da sua live.' },
  { title: 'Cole uma URL no OBS', text: 'Uma fonte de navegador com fundo transparente. Serve para todos os minigames.' },
  { title: 'O chat participa', text: 'Abra um minigame e o público entra digitando um comando no chat, de graça e sem cadastro.' },
];

/** O que é a plataforma, em poucas palavras (para quem chega pela primeira vez). */
const ABOUT = [
  {
    icon: '🎥',
    title: 'Ferramenta para streamers',
    text: 'Um overlay para OBS, como os de alertas e enquetes. O streamer assina a ferramenta e usa na própria transmissão.',
  },
  {
    icon: '💬',
    title: 'Interação com a comunidade',
    text: 'O público participa pelo chat da live digitando comandos. Cada pessoa aparece na tela com o próprio nome.',
  },
  {
    icon: '🤝',
    title: 'Participar é grátis',
    text: 'Ninguém do público paga nada para participar e não precisa criar conta. Basta estar no chat.',
  },
  {
    icon: '🎉',
    title: 'Só diversão, sem dinheiro',
    text: 'Nada na Clipei vale dinheiro: pontos, níveis e rankings existem só dentro da brincadeira e não podem ser trocados por nada.',
  },
];

const FEATURES = [
  { title: 'Arena por cima do jogo', text: 'Fundo transparente, tamanho e posição ajustáveis ao vivo, sem atrapalhar a gameplay.' },
  { title: 'Tela cheia ou por cima', text: 'Cada minigame pode virar a tela principal da live, com cenário completo, ou ficar numa janela por cima do jogo.' },
  { title: 'Apoio vira efeito na tela', text: 'Bits, subs, raids e pontos de canal (recursos da própria Twitch e Kick) viram golpes, turbos e efeitos especiais na tela.' },
  { title: 'Nome de cada um na tela', text: 'Todo mundo do chat aparece com o próprio nome e a cor do chat em cima do personagem.' },
  { title: 'Clip da vitória', text: 'No fim de cada partida, a Clipei cria o clip na Twitch e o bot anuncia o vencedor no chat.' },
  { title: 'Moderação pelo chat', text: '!boss iniciar, !corrida iniciar, !royale iniciar: você e seus mods controlam sem abrir o painel.' },
  { title: 'Entretenimento de verdade', text: 'Participar é grátis e nada vale dinheiro. É uma brincadeira para aproximar o streamer da comunidade.' },
];

const FAQ = [
  {
    q: 'O que é a Clipei Live?',
    a: 'Uma ferramenta para criadores de conteúdo: um overlay para o OBS com minigames interativos que o público controla pelo chat da live. É entretenimento, do mesmo jeito que os alertas de seguidor e as enquetes que aparecem na tela.',
  },
  {
    q: 'Isso é aposta ou jogo de azar?',
    a: 'Não. A Clipei não tem apostas, cassino, rifas nem sorteios valendo prêmio, e não movimenta dinheiro do público. Quem assiste participa de graça pelo chat, e pontos, níveis e rankings não têm valor fora da brincadeira nem podem ser trocados por dinheiro ou prêmios. Os Termos proíbem usar a Clipei para esse tipo de atividade.',
  },
  {
    q: 'Quem paga e pelo quê?',
    a: 'Só o streamer, que assina a ferramenta (como qualquer software para lives). O público nunca paga nada para a Clipei. Bits, subs e pontos do canal são recursos da própria Twitch e da Kick: na Clipei eles só ativam um efeito na tela.',
  },
  { q: 'Preciso instalar alguma coisa?', a: 'Não. Tudo roda no navegador: você usa o painel da Clipei e adiciona uma fonte de navegador no OBS.' },
  { q: 'Funciona com qualquer jogo?', a: 'Sim. O minigame fica numa camada transparente por cima da sua cena, com posição e tamanho que você escolhe.' },
  { q: 'Funciona na Kick e no YouTube?', a: 'Funciona na Twitch e na Kick. O YouTube está em preparação.' },
  { q: 'Meu chat precisa se cadastrar?', a: 'Não. Quem está no chat só digita os comandos, como !atk.' },
  { q: 'Preciso de cartão para testar?', a: 'Não. O teste de 7 dias começa quando você conecta sua conta, com tudo liberado. Depois, assine por mês ou por ano.' },
  { q: 'Posso cancelar quando quiser?', a: 'Sim. Não tem fidelidade: você usa até o fim do período que já pagou.' },
];

export function Landing() {
  const [me, setMe] = useState<MeResponse | null>(null);
  useEffect(() => {
    api<MeResponse>('/api/me')
      .then(setMe)
      .catch(() => {});
  }, []);
  const logged = Boolean(me?.channel);

  return (
    <div className="landing">
      <header className="l-nav">
        <Link to="/" aria-label="Clipei Live Games">
          <Logo className="l-logo" />
        </Link>
        <nav className="l-links" aria-label="Seções">
          <a href="#o-que-e">O que é</a>
          <a href="#minigames">Minigames</a>
          <a href="#como-funciona">Como funciona</a>
          <a href="#planos">Planos</a>
          <a href="#duvidas">Dúvidas</a>
        </nav>
        <Link className="btn primary" to={logged ? '/app' : '/entrar'}>
          {logged ? 'Abrir painel' : 'Entrar'}
        </Link>
      </header>

      <section className="l-hero">
        <div className="l-hero-copy">
          <span className="l-eyebrow">Ferramenta de interação para streamers</span>
          <h1>
            Seu chat vira o <span>controle da live</span>
          </h1>
          <p>
            Um overlay para o OBS com minigames interativos: o público da sua live na Twitch ou na Kick participa digitando comandos no chat, e tudo aparece na tela
            da transmissão, com o nome de cada pessoa.
          </p>
          <div className="l-cta">
            <Link className="btn twitch lg" to={logged ? '/app' : '/entrar'}>
              {logged ? 'Abrir meu painel' : 'Começar com a Twitch'}
            </Link>
            <Link className="btn lg" to="/app">
              Testar no modo demo
            </Link>
          </div>
          <ul className="l-trust" aria-label="Como funciona para o público">
            <li>Participação grátis pelo chat</li>
            <li>Sem dinheiro envolvido</li>
            <li>Feito para entretenimento</li>
          </ul>
        </div>
        <HeroStage />
      </section>

      <section className="l-band" id="o-que-e">
        <h2>O que é a Clipei Live</h2>
        <p className="l-lead">Uma ferramenta de interação para transmissões ao vivo. O streamer coloca os minigames na tela, e a comunidade participa pelo chat.</p>
        <div className="l-about">
          {ABOUT.map((a) => (
            <div key={a.title} className="l-about-item">
              <span aria-hidden="true">{a.icon}</span>
              <b>{a.title}</b>
              <p>{a.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="l-band" id="como-funciona">
        <h2>Pronto em 3 passos</h2>
        <ol className="l-steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="l-num">{i + 1}</span>
              <b>{s.title}</b>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="l-band" id="minigames">
        <h2>Minigames interativos</h2>
        <p className="l-lead">
          {LIVE_GAMES.length} dinâmicas prontas para a sua live, todas no mesmo painel e na mesma URL do OBS. O público entra com um comando no chat.
        </p>
        <div className="l-games">
          {LIVE_GAMES.map((g) => (
            <article key={g.id} className="l-game">
              <div className="l-game-shot">
                <img src={`/games/${g.id}.webp`} alt={`${g.name} rodando numa live`} width={960} height={540} loading="lazy" decoding="async" />
                <span className="l-game-badge">{g.tagline}</span>
              </div>
              <div className="l-game-body">
                <h3>{g.name}</h3>
                <p>{g.description}</p>
                <div className="l-game-cmds" aria-label="Comandos do chat">
                  {g.commands.filter((c) => !/^!\d$/.test(c)).slice(0, 3).map((c) => (
                    <kbd key={c}>{c}</kbd>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="l-band">
        <h2>Feito para a live</h2>
        <div className="l-features">
          {FEATURES.map((f) => (
            <div key={f.title} className="l-feature">
              <Icon name="bolt" />
              <b>{f.title}</b>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="l-band" id="planos">
        <h2>Planos</h2>
        <p className="l-lead">Um plano com tudo liberado. Teste {TRIAL_DAYS} dias grátis, sem cartão.</p>
        <FounderStrip left={me?.founderSlotsLeft ?? FOUNDER_SLOTS} />
        <PlanCards
          discounted={(me?.founderSlotsLeft ?? FOUNDER_SLOTS) > 0}
          action={(cycle) => (
            <Link className={`btn ${cycle === 'yearly' ? 'primary' : ''} block`} to={logged ? '/app/plano' : '/entrar'}>
              {logged ? 'Ver meu plano' : 'Começar teste grátis'}
            </Link>
          )}
        />
      </section>

      <section className="l-band" id="duvidas">
        <h2>Dúvidas</h2>
        <div className="l-faq">
          {FAQ.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="l-foot">
        <Logo className="l-foot-logo" />
        <span>
          Clipei Studio Digital · ferramenta de interação para lives na Twitch e na Kick. Participação gratuita pelo chat, sem dinheiro envolvido.
        </span>
        <nav className="l-foot-links" aria-label="Institucional">
          <Link to="/privacidade">Privacidade</Link>
          <Link to="/termos">Termos</Link>
          <Link to="/entrar">Entrar</Link>
        </nav>
      </footer>
    </div>
  );
}

const HERO_FEED: { user: string; msg: string; dmg: number }[] = [
  { user: 'PixelBR', msg: '!atk', dmg: 9 },
  { user: 'LoboGG', msg: '!atk', dmg: 11 },
  { user: 'NeoMito', msg: 'kkkk vai', dmg: 0 },
  { user: 'BraboTTV', msg: '!ult', dmg: 22 },
  { user: 'ZikaRush', msg: '!atk', dmg: 10 },
  { user: 'Lua_Plays', msg: '!atk', dmg: 12 },
  { user: 'MestreYodaBR', msg: '!ult', dmg: 24 },
];

/** Prévia do topo: uma mini-luta no ritmo de uma live real (uma mensagem a cada ~2 s). */
function HeroStage() {
  const [hp, setHp] = useState(100);
  const [feed, setFeed] = useState<{ id: number; user: string; msg: string; dmg: number }[]>([]);
  const [hit, setHit] = useState<{ id: number; dmg: number; ult: boolean } | null>(null);
  const step = useRef(0);
  const bossRef = useRef<HTMLDivElement>(null);

  // tremida do golpe sem recriar o canvas do boss
  useEffect(() => {
    if (!hit || !bossRef.current) return;
    bossRef.current.animate(
      [
        { transform: 'translateX(0)', filter: 'brightness(1.8)' },
        { transform: 'translateX(-5px)', offset: 0.3 },
        { transform: 'translateX(4px)', offset: 0.6 },
        { transform: 'none', filter: 'none' },
      ],
      { duration: hit.ult ? 450 : 320, easing: 'ease-out' },
    );
  }, [hit]);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let hpNow = 100;
    const tick = () => {
      const n = step.current++;
      const item = HERO_FEED[n % HERO_FEED.length];
      setFeed((f) => [...f.slice(-3), { id: n, ...item }]);
      if (item.dmg) {
        hpNow = Math.max(0, hpNow - item.dmg);
        setHp(hpNow);
        if (!reduce) setHit({ id: n, dmg: item.dmg * 137, ult: item.msg === '!ult' });
      }
      // boss quase derrotado: pausa e volta com a vida cheia
      if (hpNow <= 12) {
        hpNow = 100;
        setTimeout(() => setHp(100), 1600);
      }
    };
    tick();
    const t = setInterval(tick, 2100);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="l-stage" aria-hidden="true">
      <div className="l-stage-hud">
        <b>GLITCHADOR</b>
        <i>
          <em style={{ width: `${hp}%` }} />
        </i>
      </div>
      <div className="l-stage-boss">
        <div ref={bossRef} className={hit?.ult ? 'ult-glow' : ''}>
          <BossThumb skin="glitchador" width={240} height={200} />
        </div>
        {hit && (
          <span key={`d${hit.id}`} className={`l-dmg ${hit.ult ? 'ult' : ''}`}>
            -{hit.dmg.toLocaleString('pt-BR')}
          </span>
        )}
      </div>
      <div className="l-chat">
        {feed.map((m) => (
          <span key={m.id}>
            <b>{m.user}</b> {m.msg}
          </span>
        ))}
      </div>
      <div className="l-floor" />
    </div>
  );
}
