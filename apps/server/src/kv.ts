/**
 * Banco de produção: tabela clipei_kv no Supabase (Postgres), via API REST.
 * Cada conta é uma linha "channel:<id>" e o bot é a linha "bot".
 * Usa a chave secreta (service_role) — só o servidor fala com o banco.
 */
export interface KvRow {
  key: string;
  value: unknown;
}

export class SupabaseKv {
  private base: string;
  constructor(
    url: string,
    private secret: string,
    private table = 'clipei_kv',
  ) {
    this.base = `${url.replace(/\/$/, '')}/rest/v1/${table}`;
  }

  private headers(extra: Record<string, string> = {}) {
    const h: Record<string, string> = { apikey: this.secret, 'Content-Type': 'application/json', ...extra };
    // chaves antigas (JWT) também vão no Authorization; as novas (sb_secret_...) só no apikey
    if (this.secret.startsWith('eyJ')) h.Authorization = `Bearer ${this.secret}`;
    return h;
  }

  private async check(res: Response, what: string) {
    if (res.ok) return;
    const body = await res.text().catch(() => '');
    throw new Error(`[supabase] ${what}: ${res.status} ${body.slice(0, 300)}`);
  }

  async all(): Promise<KvRow[]> {
    const rows: KvRow[] = [];
    for (let offset = 0; ; offset += 1000) {
      const res = await fetch(`${this.base}?select=key,value&order=key&limit=1000&offset=${offset}`, { headers: this.headers() });
      await this.check(res, 'ler');
      const page = (await res.json()) as KvRow[];
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
  }

  /** Grava várias linhas; `json` já vem serializado para não serializar duas vezes. */
  async upsert(rows: { key: string; json: string }[]) {
    if (!rows.length) return;
    const body = `[${rows.map((r) => `{"key":${JSON.stringify(r.key)},"value":${r.json}}`).join(',')}]`;
    const res = await fetch(`${this.base}?on_conflict=key`, {
      method: 'POST',
      headers: this.headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body,
    });
    await this.check(res, 'gravar');
  }

  async remove(keys: string[]) {
    if (!keys.length) return;
    const list = keys.map((k) => `"${k.replace(/"/g, '\\"')}"`).join(',');
    const res = await fetch(`${this.base}?key=in.(${encodeURIComponent(list)})`, { method: 'DELETE', headers: this.headers({ Prefer: 'return=minimal' }) });
    await this.check(res, 'apagar');
  }
}
