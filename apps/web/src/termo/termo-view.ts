import type { TermoSnapshot } from '@clipei/shared';
import type { Sfx } from '../arena/sfx.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ROWS = 6;
const KEYS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const MEDALS = ['🥇', '🥈', '🥉', '4º', '5º'];

/**
 * Termo do Chat no OBS: cartão com a grade dos últimos chutes (nome de quem chutou),
 * o que já se sabe da palavra, o teclado colorido, o tempo e o placar da partida.
 */
export class TermoView {
  private s: TermoSnapshot | null = null;
  private offset = 0;
  private seen = new Set<number>();
  private resultTimer: number | undefined;
  private el: Record<string, HTMLElement> = {};
  private boardKey = '';

  constructor(
    private zone: HTMLElement,
    private sfx: Sfx | null,
    private hooks: { onShow: () => void; confetti: (box: HTMLElement) => void },
  ) {
    zone.innerHTML = `
      <div class="tm-card">
        <header class="tm-head">
          <b>🔤 Termo do Chat</b>
          <span data-k="round"></span>
          <em data-k="time"></em>
        </header>
        <div class="tm-main">
          <div class="tm-left">
            <div class="tm-known" data-k="known"></div>
            <div class="tm-board" data-k="board"></div>
            <div class="tm-toast" data-k="toast" hidden></div>
            <div class="tm-keys" data-k="keys"></div>
          </div>
          <aside class="tm-side">
            <div class="tm-how"><span>Chute com <kbd>!t</kbd> e a palavra</span><small>ex.: <b>!t casal</b> · acentos não importam</small></div>
            <div class="tm-legend"><span class="g">A</span> lugar certo <span class="y">B</span> outro lugar <span class="b">C</span> não tem</div>
            <ol class="tm-scores" data-k="scores"></ol>
          </aside>
        </div>
        <div class="tm-result" data-k="result" hidden></div>
        <div class="confetti" data-k="confetti"></div>
      </div>`;
    zone.querySelectorAll<HTMLElement>('[data-k]').forEach((n) => (this.el[n.dataset.k!] = n));
    window.setInterval(() => this.tick(), 250);
  }

  setState(next: TermoSnapshot) {
    const prev = this.s;
    this.s = next;
    this.offset = next.serverNow - Date.now();
    const active = next.status === 'playing' || next.status === 'between';
    if (active || next.status === 'finished') {
      window.clearTimeout(this.resultTimer);
      if (this.zone.classList.contains('is-hidden')) {
        this.zone.classList.remove('is-hidden');
        this.hooks.onShow();
      }
    }
    if (next.status === 'stopped' || next.status === 'idle') this.zone.classList.add('is-hidden');
    if (next.status === 'finished' && prev?.status !== 'finished') {
      this.resultTimer = window.setTimeout(() => this.zone.classList.add('is-hidden'), 12_000);
    }
    if (prev && prev.round !== next.round) this.seen.clear();

    this.el.round!.textContent = next.status === 'finished' ? 'fim da partida' : `palavra ${next.round}/${next.rounds}`;

    // o que já se sabe (verdes e dicas)
    this.el.known!.innerHTML = next.known
      .map((c, i) => `<i class="${c ? (next.hinted[i] ? 'hint' : 'g') : ''}">${c ? c.toUpperCase() : ''}</i>`)
      .join('');

    // grade: últimos chutes (o mais novo embaixo), linhas vazias completam.
    // Só redesenha quando chega chute novo, para não cortar a animação.
    const rows = next.guesses.slice(-ROWS);
    const key = `${next.round}|${rows.map((g) => g.id).join(',')}`;
    if (key !== this.boardKey) this.drawBoard(rows, key);

    this.drawRest(next, prev);
  }

  private drawBoard(rows: TermoSnapshot['guesses'], key: string) {
    this.boardKey = key;
    let html = '';
    for (const g of rows) {
      const fresh = !this.seen.has(g.id);
      this.seen.add(g.id);
      html += `<div class="tm-row ${fresh ? 'is-new' : ''}">
        <span class="tm-who"><i style="background:${esc(g.color)}"></i>${esc(g.name)}</span>
        ${[...g.word].map((c, i) => `<b class="${g.marks[i]}" style="--d:${i * 90}ms">${c.toUpperCase()}</b>`).join('')}
      </div>`;
      if (fresh) this.sfx?.play(g.marks === 'ggggg' ? 'victory' : 'hit');
    }
    for (let i = rows.length; i < ROWS; i++) html += `<div class="tm-row empty"><span class="tm-who"></span>${'<b></b>'.repeat(5)}</div>`;
    this.el.board!.innerHTML = html;
  }

  private drawRest(next: TermoSnapshot, prev: TermoSnapshot | null) {
    // teclado
    this.el.keys!.innerHTML = KEYS.map(
      (r) => `<div>${[...r].map((c) => `<span class="${next.letters[c] ?? ''}">${c.toUpperCase()}</span>`).join('')}</div>`,
    ).join('');

    // placar
    this.el.scores!.innerHTML = next.scores.length
      ? next.scores
          .map(
            (r, i) =>
              `<li><em>${MEDALS[i]}</em><i style="background:${esc(r.color)}"></i><span>${esc(r.name)}</span><b>${r.points}</b></li>`,
          )
          .join('')
      : `<li class="muted">${next.totalGuesses ? 'Ninguém pontuou ainda' : 'Seja o primeiro a chutar!'}</li>`;

    // avisos
    for (const f of next.fx) {
      if (f.kind === 'invalid') this.toast(`"${f.word.toUpperCase()}" não está no dicionário`);
      else if (f.kind === 'hint') {
        this.toast(`💡 Dica${f.by ? ` de ${f.by}` : ''}: a ${f.pos + 1}ª letra é ${f.letter.toUpperCase()}`);
        this.sfx?.play('bits');
      } else if (f.kind === 'time') this.toast(`⏱️ +${f.seconds} s (${f.by})`);
      else if (f.kind === 'win') this.confetti();
    }

    // resultado da palavra / da partida
    const r = this.el.result!;
    if (next.status === 'between' && next.solution) {
      r.hidden = false;
      r.className = `tm-result ${next.winner ? 'win' : 'lose'}`;
      r.innerHTML = next.winner
        ? `<small>🎉 Acertou!</small><b style="color:${esc(next.winner.color)}">${esc(next.winner.name)}</b><strong>${esc(next.solution.toUpperCase())}</strong><span>+${next.winner.points} pontos</span><em data-k="next"></em>`
        : `<small>⏰ Ninguém acertou</small><span>A palavra era</span><strong>${esc(next.solution.toUpperCase())}</strong><em data-k="next"></em>`;
      this.el.next = r.querySelector<HTMLElement>('[data-k="next"]')!;
    } else if (next.status === 'finished') {
      r.hidden = false;
      r.className = 'tm-result final';
      r.innerHTML = `<small>🏆 Fim da partida</small>${
        next.scores.length
          ? `<div class="tm-podium">${next.scores
              .slice(0, 3)
              .map((s, i) => `<span><i>${MEDALS[i]}</i><b style="color:${esc(s.color)}">${esc(s.name)}</b><em>${s.points} pts · ${s.wins} ${s.wins === 1 ? 'palavra' : 'palavras'}</em></span>`)
              .join('')}</div>`
          : '<span>Ninguém pontuou dessa vez.</span>'
      }${next.solution ? `<span>Última palavra: <b>${esc(next.solution.toUpperCase())}</b></span>` : ''}`;
      if (prev?.status !== 'finished' && next.scores.length) this.confetti();
    } else r.hidden = true;
    this.tick();
  }

  private toast(text: string) {
    const t = this.el.toast!;
    t.textContent = text;
    t.hidden = false;
    t.classList.remove('is-in');
    void t.offsetWidth;
    t.classList.add('is-in');
    window.clearTimeout(Number(t.dataset.timer));
    t.dataset.timer = String(window.setTimeout(() => (t.hidden = true), 2600));
  }

  private confetti() {
    this.hooks.confetti(this.el.confetti!);
  }

  private tick() {
    const s = this.s;
    if (!s) return;
    const now = Date.now() + this.offset;
    const time = this.el.time!;
    if (s.status === 'playing' && s.endsAt) {
      const left = Math.max(0, Math.ceil((s.endsAt - now) / 1000));
      time.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      time.classList.toggle('is-low', left <= 20);
    } else time.textContent = '';
    if (s.status === 'between' && s.nextAt && this.el.next) {
      const left = Math.max(0, Math.ceil((s.nextAt - now) / 1000));
      this.el.next.textContent = s.round < s.rounds ? `próxima palavra em ${left}s` : `resultado em ${left}s`;
    }
  }
}
