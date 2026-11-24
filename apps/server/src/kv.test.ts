import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** PostgREST de mentira: guarda as linhas num Map e confere a chave. */
const db = new Map<string, unknown>([['channel:old', { id: 'old', login: 'old', displayName: 'Old', overlayKey: 'k', connectedAt: 1 }]]);
let server: Server;
let authOk = true;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.headers.apikey !== 'sb_secret_teste') authOk = false;
    const url = new URL(req.url!, 'http://x');
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'GET') {
        const off = Number(url.searchParams.get('offset') ?? 0);
        const rows = [...db].map(([key, value]) => ({ key, value })).slice(off, off + 1000);
        res.end(JSON.stringify(rows));
      } else if (req.method === 'POST') {
        for (const r of JSON.parse(body)) db.set(r.key, r.value);
        res.statusCode = 201;
        res.end();
      } else if (req.method === 'DELETE') {
        const list = decodeURIComponent(url.searchParams.get('key')!).replace(/^in\.\(|\)$/g, '');
        for (const k of list.split(',')) db.delete(k.replace(/^"|"$/g, ''));
        res.statusCode = 204;
        res.end();
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  process.env.SUPABASE_URL = `http://127.0.0.1:${port}`;
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_teste';
});
afterAll(() => server.close());

describe('store no Supabase', () => {
  it('carrega, grava só o que mudou e apaga contas removidas', async () => {
    const { initStore, flushStore, store } = await import('./store.ts');
    await initStore();
    expect(store.getChannel('old')?.login).toBe('old');

    store.upsertChannel({ id: 'tw9', login: 'novo', displayName: 'Novo' } as never);
    store.mergeInto('old', 'tw9');
    await flushStore();

    expect(db.has('channel:tw9')).toBe(true);
    expect(db.has('channel:old')).toBe(false);
    expect((db.get('channel:tw9') as { subscription?: unknown }).subscription).toBeTruthy();
    expect(authOk).toBe(true);
  });
});
