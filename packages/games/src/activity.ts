/**
 * Conta quantas pessoas diferentes falaram no chat numa janela de tempo.
 * Base da vida automática do boss e da regra "só invocar com chat ativo".
 */
export class ChatActivity {
  private lastSeen = new Map<string, number>();

  constructor(
    private windowMs = 10 * 60_000,
    private now: () => number = Date.now,
  ) {}

  record(userKey: string, ts = this.now()) {
    this.lastSeen.set(userKey, ts);
    // limpeza ocasional para não crescer sem limite em lives longas
    if (this.lastSeen.size > 20_000) this.prune();
  }

  /** Pessoas diferentes que falaram nos últimos `windowMs`. */
  count(windowMs = this.windowMs) {
    const since = this.now() - windowMs;
    let n = 0;
    for (const ts of this.lastSeen.values()) if (ts >= since) n++;
    return n;
  }

  prune() {
    const since = this.now() - this.windowMs;
    for (const [k, ts] of this.lastSeen) if (ts < since) this.lastSeen.delete(k);
  }
}
