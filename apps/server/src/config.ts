import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import dotenv from 'dotenv';

export const ROOT_DIR = resolve(import.meta.dirname, '../../..');
dotenv.config({ path: resolve(ROOT_DIR, '.env') });

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  isProd: env.NODE_ENV === 'production',
  webUrl: (env.WEB_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  /** Endereço público do WebSocket (ex.: wss://api.seudominio.com/ws) quando o site fica em outro host. */
  publicWsUrl: env.PUBLIC_WS_URL ?? '',
  sessionSecret: env.SESSION_SECRET || 'dev-secret-troque-no-env-0123456789abcdef',
  dataDir: env.DATA_DIR ? resolve(env.DATA_DIR) : resolve(ROOT_DIR, 'data'),
  webDist: resolve(ROOT_DIR, 'apps/web/dist'),
  /** Supabase (produção). Sem isso, os dados ficam em data/store.json. */
  supabase: {
    url: env.SUPABASE_URL ?? '',
    secret: env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  },
  twitch: {
    clientId: env.TWITCH_CLIENT_ID ?? '',
    clientSecret: env.TWITCH_CLIENT_SECRET ?? '',
    redirectUri: env.TWITCH_REDIRECT_URI ?? 'http://localhost:3000/api/auth/twitch/callback',
    /** Logins da Twitch dos administradores da Clipei (painel /app/admin e conta do bot). */
    botAdmins: (env.ADMIN_LOGINS ?? env.BOT_ADMIN_LOGINS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  },
  kick: {
    clientId: env.KICK_CLIENT_ID ?? '',
    clientSecret: env.KICK_CLIENT_SECRET ?? '',
    redirectUri: env.KICK_REDIRECT_URI ?? 'http://localhost:3000/api/auth/kick/callback',
  },
  https:
    env.HTTPS_KEY && env.HTTPS_CERT
      ? {
          key: readIfExists(resolve(ROOT_DIR, env.HTTPS_KEY)),
          cert: readIfExists(resolve(ROOT_DIR, env.HTTPS_CERT)),
        }
      : null,
};

export const twitchConfigured = () => Boolean(config.twitch.clientId && config.twitch.clientSecret);

function readIfExists(path: string) {
  if (!existsSync(path)) throw new Error(`Arquivo de certificado não encontrado: ${path}`);
  return readFileSync(path);
}

// Em produção, nunca assinar cookies com o segredo de exemplo. Sem um SESSION_SECRET
// forte, usa um aleatório só deste processo (os logins caem a cada reinício) e avisa.
if (config.isProd && (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32 || /troque/i.test(env.SESSION_SECRET))) {
  config.sessionSecret = randomBytes(48).toString('base64url');
  console.warn('[config] SESSION_SECRET ausente ou fraco: usando um segredo temporário. Defina um texto aleatório com 32+ caracteres.');
}
if (config.isProd && !(config.supabase.url && config.supabase.secret)) {
  console.warn('[config] Supabase não configurado: os dados ficam num arquivo que SOME a cada deploy. Defina SUPABASE_URL e SUPABASE_SECRET_KEY.');
}
