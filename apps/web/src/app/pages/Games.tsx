import { Link } from 'react-router-dom';
import { BOSS_SKIN_IDS, GAMES } from '@clipei/shared';
import { BossThumb } from '../components/ui.tsx';
import { useApp } from '../state.tsx';

export function Games() {
  const { boss } = useApp();
  const running = boss?.state?.status === 'running';
  return (
    <>
      <section className="hero">
        <div>
          <h1>
            Mini<span>games</span>
          </h1>
          <p>Todos usam a mesma URL no OBS. Quando um jogo novo chegar, ele aparece aqui pronto para usar.</p>
        </div>
      </section>
      <div className="games-grid">
        {GAMES.map((g) => {
          const active = g.status === 'active';
          const inner = (
            <>
              <div className="g-art">
                {g.id === 'boss' ? (
                  <div className="g-bosses">
                    {BOSS_SKIN_IDS.map((s) => (
                      <BossThumb key={s} skin={s} width={58} height={52} />
                    ))}
                  </div>
                ) : (
                  <span className="g-soon-title">{g.name}</span>
                )}
              </div>
              <div className="g-body">
                <div className="g-top">
                  <h2>{g.name}</h2>
                  <span className={`tag ${active ? 'active' : 'soon'}`}>{active ? (running && g.id === 'boss' ? 'Ao vivo' : 'Disponível') : 'Em breve'}</span>
                </div>
                <p className="g-tag">{g.tagline}</p>
                <p>{g.description}</p>
                {g.commands.length > 0 && (
                  <div className="g-cmds">
                    {g.commands.map((c) => (
                      <kbd key={c}>{c}</kbd>
                    ))}
                  </div>
                )}
              </div>
            </>
          );
          return active ? (
            <Link key={g.id} to={`/app/jogos/${g.id}`} className="g-card active">
              {inner}
              <span className="g-open">Abrir →</span>
            </Link>
          ) : (
            <article key={g.id} className="g-card soon" aria-disabled="true">
              {inner}
            </article>
          );
        })}
      </div>
    </>
  );
}
