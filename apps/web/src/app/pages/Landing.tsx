import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BOSS_SKIN_IDS, FOUNDER_SLOTS, GAMES, TRIAL_DAYS, type MeResponse } from '@clipei/shared';
import { api } from '../api.ts';
import { Icon } from '../components/icons.tsx';
import { BossThumb, Logo } from '../components/ui.tsx';
import { FounderStrip, PlanCards } from '../components/plans.tsx';

const STEPS = [
  { title: 'Conecte sua Twitch', text: 'Um clique para entrar. O bot da Clipei passa a ler e responder o seu chat.' },
  { title: 'Cole uma URL no OBS', text: 'Uma fonte de navegador, fundo transparente. Serve para todos os minigames.' },
  { title: 'O chat joga', text: 'Invoque um boss e o chat ataca com !atk. Bits, subs e pontos viram golpes especiais.' },
];

const FEATURES = [
  { title: 'Arena por cima do jogo', text: 'Fundo transparente, tamanho e posição ajustáveis ao vivo, sem atrapalhar a gameplay.' },
  { title: 'Apoio vira dano', text: 'Bits viram chuva de cristais, subs viram raios, raids trazem reforços e pontos de canal soltam golpes especiais.' },
  { title: 'Boss automático', text: 'Um boss aparece sozinho a cada 15 min, 1 h ou 3 h, com aviso no chat 1 minuto antes.' },
  { title: 'Clip da vitória', text: 'Quando o boss cai, a Clipei cria o clip na Twitch e manda o link no chat.' },
  { title: 'Moderação pelo chat', text: '!boss iniciar, !boss brasa, !boss parar: você e seus mods controlam sem abrir o painel.' },
  { title: 'Sem apostas', text: 'Nada de dinheiro em jogo nem roleta de prêmios. É diversão para a comunidade.' },
];

const FAQ = [
  { q: 'Preciso instalar alguma coisa?', a: 'Não. Tudo roda no navegador: você usa o painel da Clipei e adiciona uma fonte de navegador no OBS.' },
  { q: 'Funciona com qualquer jogo?', a: 'Sim. O minigame fica numa camada transparente por cima da sua cena, com posição e tamanho que você escolhe.' },
  { q: 'E na Kick e no YouTube?', a: 'Hoje a Clipei funciona na Twitch. Kick e YouTube estão em preparação.' },
  { q: 'Meu chat precisa se cadastrar?', a: 'Não. Quem está no chat só digita os comandos, como !atk.' },
  { q: 'Preciso de cartão para testar?', a: 'Não. O teste de 7 dias começa quando você conecta a Twitch, com tudo liberado. Depois, assine por mês ou por ano.' },
  { q: 'Posso cancelar quando quiser?', a: 'Sim. Não tem fidelidade: você usa até o fim do período que já pagou.' },
  { q: 'Tem aposta ou prêmio em dinheiro?', a: 'Não. Os minigames não envolvem apostas nem dinheiro.' },
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
          <h1>
            Seu chat vira o <span>controle do jogo</span>
          </h1>
          <p>
            Minigames na sua live, controlados pelo chat. Cada pessoa vira um herói na arena, e quem apoia o canal solta os golpes mais fortes.
          </p>
          <div className="l-cta">
            <Link className="btn twitch lg" to={logged ? '/app' : '/entrar'}>
              {logged ? 'Abrir meu painel' : 'Começar com a Twitch'}
            </Link>
            <Link className="btn lg" to="/app">
              Testar no modo demo
            </Link>
          </div>
        </div>
        <div className="l-stage" aria-hidden="true">
          <div className="l-stage-hud">
            <b>GLITCHADOR</b>
            <i>
              <em />
            </i>
          </div>
          <div className="l-stage-boss">
            <BossThumb skin="glitchador" width={240} height={200} />
          </div>
          <div className="l-chat">
            {['!atk', '!atk', 'kkkk vai', '!ult', '!atk'].map((m, i) => (
              <span key={i} style={{ animationDelay: `${i * 0.6}s` }}>
                <b>{['PixelBR', 'LoboGG', 'NeoMito', 'BraboTTV', 'ZikaRush'][i]}</b> {m}
              </span>
            ))}
          </div>
          <div className="l-floor" />
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
        <h2>Minigames</h2>
        <p className="l-lead">O Boss coletivo já está no ar. Os próximos chegam no mesmo painel e na mesma URL do OBS.</p>
        <div className="l-games">
          {GAMES.map((g) => (
            <article key={g.id} className={`l-game ${g.status}`}>
              {g.id === 'boss' ? (
                <div className="l-game-art bosses">
                  {BOSS_SKIN_IDS.slice(0, 3).map((s) => (
                    <BossThumb key={s} skin={s} width={84} height={70} />
                  ))}
                </div>
              ) : (
                <div className="l-game-art soon-art">{g.name.split(' ')[0]}</div>
              )}
              <div className="l-game-body">
                <span className={`tag ${g.status}`}>{g.status === 'active' ? 'Disponível' : 'Em breve'}</span>
                <h3>{g.name}</h3>
                <p>{g.description}</p>
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
        <span>Clipei Live Games · minigames para lives</span>
        <Link to="/entrar">Entrar</Link>
      </footer>
    </div>
  );
}
