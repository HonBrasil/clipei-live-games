import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { BOSS_SKIN_IDS, GAMES } from '@clipei/shared';
import { BossThumb } from '../components/ui.tsx';
import { useApp } from '../state.tsx';
import { drawTrackThumb } from '../../race/race-arena.ts';

function TrackArt() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawTrackThumb(ref.current, 'neon');
  }, []);
  return <canvas ref={ref} width={320} height={180} className="g-track" aria-hidden="true" />;
}

export function Games() {
  const { status } = useApp();
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
        {GAMES.filter((g) => g.status === 'active').map((g) => {
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
                ) : g.id === 'race' ? (
                  <TrackArt />
                ) : g.id === 'penalty' ? (
                  <span className="g-duel" aria-hidden="true">
                    ⚽<i>·</i>🥅<i>·</i>🧤
                  </span>
                ) : g.id === 'kite' ? (
                  <span className="g-duel" aria-hidden="true">
                    🪁<i>·</i>✂️<i>·</i>🙌
                  </span>
                ) : g.id === 'royale' ? (
                  <span className="g-duel" aria-hidden="true">
                    🪂<i>·</i>🔫<i>·</i>🏆
                  </span>
                ) : g.id === 'duel' ? (
                  <span className="g-duel" aria-hidden="true">
                    🤠<i>x</i>🤠
                  </span>
                ) : (
                  <span className="g-soon-title">{g.name}</span>
                )}
              </div>
              <div className="g-body">
                <div className="g-top">
                  <h2>{g.name}</h2>
                  <span className={`tag ${active ? 'active' : 'soon'}`}>{active ? (status?.game === g.id ? 'Ao vivo' : 'Disponível') : 'Em breve'}</span>
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
