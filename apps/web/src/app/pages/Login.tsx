import { Link } from 'react-router-dom';
import { Logo } from '../components/ui.tsx';

export function Login() {
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
        <button className="btn lg block" disabled>
          Kick · em breve
        </button>
        <button className="btn lg block" disabled>
          YouTube · em breve
        </button>
        <p className="login-alt">
          Quer só conhecer? <Link to="/app">Abrir o modo demo</Link>
        </p>
      </div>
    </div>
  );
}
