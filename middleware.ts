/**
 * Vercel Routing Middleware: o site fica na Vercel e o servidor do jogo
 * (sempre ligado, com WebSocket e o bot da Twitch) fica em outro host.
 * Tudo em /api/* é repassado para API_ORIGIN, mantendo os cookies de login
 * no domínio do site. O WebSocket do overlay vai direto ao servidor
 * (o endereço vem de /api/config).
 */
export const config = { matcher: '/api/:path*' };

const DROP_REQUEST = ['host', 'connection', 'content-length', 'keep-alive', 'transfer-encoding', 'upgrade'];
const DROP_RESPONSE = ['content-encoding', 'content-length', 'transfer-encoding', 'connection'];

export default async function middleware(request: Request) {
  const origin = process.env.API_ORIGIN;
  if (!origin) {
    return Response.json({ error: 'O servidor do jogo ainda não foi configurado (API_ORIGIN).' }, { status: 503 });
  }
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, origin);

  const headers = new Headers(request.headers);
  for (const h of DROP_REQUEST) headers.delete(h);
  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', url.protocol.replace(':', ''));

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: 'manual', // OAuth: o navegador precisa ver o redirecionamento
    });
  } catch {
    return Response.json({ error: 'Servidor do jogo fora do ar.' }, { status: 502 });
  }

  const out = new Headers(upstream.headers);
  for (const h of DROP_RESPONSE) out.delete(h);
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}
