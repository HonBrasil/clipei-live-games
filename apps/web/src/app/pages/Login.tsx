import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../components/ui.tsx';

export function Login() {
  // Kick aparece assim que o servidor tiver o app da Kick configurado
  const [kick, setKick] = useState(false);
  const [youtube, setYoutube] = useState(false);
  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((c: { platforms?: { kick?: boolean; youtube?: boolean } }) => {
        setKick(Boolean(c.platforms?.kick));
        setYoutube(Boolean(c.platforms?.youtube));
      })
      .catch(() => {});
  }, []);
  return (
    <div className="login">
      <div className="login-card">
        <Link to="/" aria-label="Voltar ao site">
          <Logo className="login-logo" />
        </Link>
        <h1>Entrar na Clipei</h1>
        <p>Use a conta do seu canal. Sem senha nova: o login é feito pela própria plataforma.</p>
        <a className="btn twitch lg block" href="/api/auth/twitch/login">
          Entrar com Twitch
        </a>
        {kick ? (
          <a className="btn kick lg block" href="/api/auth/kick/login">
            Entrar com Kick
          </a>
        ) : (
          <button className="btn lg block" disabled>
            Kick · em breve
          </button>
        )}
        {youtube ? (
          <a className="btn yt lg block" href="/api/auth/youtube/login">
            Entrar com YouTube
          </a>
        ) : (
          <button className="btn lg block" disabled>
            YouTube · em breve
          </button>
        )}
        <p className="login-alt">
          Quer só conhecer? <Link to="/app">Abrir o modo demo</Link>
        </p>
      </div>
    </div>
  );
}
