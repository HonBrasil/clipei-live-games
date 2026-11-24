import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AUTO_SPAWN_INTERVALS,
  BOSS_PRESETS,
  BOSS_SKINS,
  BOSS_SKIN_IDS,
  type BossConfig,
  type BossPresetKey,
  type BossSkinId,
  type SupportSettings,
} from '@clipei/shared';
import { api, fmtCountdown, nf } from '../api.ts';
import { BossThumb, Card, Check, Options, Switch } from '../components/ui.tsx';
import { useApp, useTick } from '../state.tsx';
import { bossDef } from '../../arena/sprites.ts';

const TABS = [
  { id: 'partida', label: 'Partida' },
  { id: 'automatico', label: 'Automático' },
  { id: 'apoios', label: 'Apoios' },
  { id: 'comandos', label: 'Comandos' },
] as const;
type Tab = (typeof TABS)[number]['id'];

export function BossPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('aba')) ? params.get('aba') : 'partida') as Tab;
  const { boss } = useApp();
  const s = boss?.state;
  const running = s?.status === 'running';

  return (
    <>
      <section className="hero">
        <div>
          <p className="crumbs">
            <Link to="/app/jogos">Minigames</Link> / Boss coletivo
          </p>
          <h1>
            Boss <span>coletivo</span>
          </h1>
          <p>O chat inteiro contra um chefe. Cada pessoa vira um herói na arena.</p>
        </div>
        {running && s && (
          <div className="hero-live">
            <span className="pill live">Ao vivo</span>
            <b>{s.name}</b>
            <div className="mini-hp">
              <i style={{ width: `${(s.hp / s.maxHp) * 100}%` }} />
            </div>
            <small>
              {nf.format(s.participants)} guerreiros · {nf.format(s.totalHits)} golpes
            </small>
          </div>
        )}
      </section>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => setParams({ aba: t.id })}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'partida' && <MatchTab />}
      {tab === 'automatico' && <AutoTab />}
      {tab === 'apoios' && <SupportTab />}
      {tab === 'comandos' && <CommandsTab />}
    </>
  );
}

// ─── Partida ─────────────────────────────────────────────────

function MatchTab() {
  const { boss, status, toast, setBoss } = useApp();
  const cfg = boss!.config;
  const running = boss?.state?.status === 'running';
  const initialPreset: BossPresetKey | 'auto' =
    boss!.hpMode === 'auto' ? 'auto' : ((Object.keys(BOSS_PRESETS) as BossPresetKey[]).find((k) => BOSS_PRESETS[k].maxHp === cfg.maxHp) ?? 'medio');
  const [skin, setSkin] = useState<BossSkinId | 'random'>(cfg.skin);
  const [name, setName] = useState(cfg.name !== BOSS_SKINS[cfg.skin].name ? cfg.name : '');
  const [preset, setPreset] = useState<BossPresetKey | 'auto'>(initialPreset);
  const [duration, setDuration] = useState(cfg.durationSec);
  const [cooldown, setCooldown] = useState(cfg.cooldownMs);

  async function start() {
    try {
      const r = await api<{ hpMode: 'auto' | 'fixed'; config: BossConfig }>('/api/boss/start', {
        skin,
        name: name.trim(),
        preset,
        durationSec: duration,
        cooldownMs: cooldown,
      });
      setBoss({ hpMode: r.hpMode, config: r.config });
      toast(`${r.config.name} invocado com ${nf.format(r.config.maxHp)} de vida ⚔️`, 'ok');
    } catch (err) {
      toast((err as Error).message, 'err');
    }
  }

  return (
    <div className="grid">
      <div className="col">
        <Card title="Escolha o boss" subtitle="Só muda o visual: a dificuldade é a mesma">
          <div className="boss-picker" role="radiogroup" aria-label="Boss">
            {BOSS_SKIN_IDS.map((id) => (
              <label className="boss-opt" key={id}>
                <input type="radio" name="skin" checked={skin === id} onChange={() => setSkin(id)} />
                <span style={{ ['--sky' as string]: bossDef(id).theme.sky }}>
                  <BossThumb skin={id} />
                  <b>{BOSS_SKINS[id].name}</b>
                  <small>{BOSS_SKINS[id].title}</small>
                </span>
              </label>
            ))}
            <label className="boss-opt">
              <input type="radio" name="skin" checked={skin === 'random'} onChange={() => setSkin('random')} />
              <span style={{ ['--sky' as string]: '#2a2a30' }}>
                <i className="dice" aria-hidden="true">
                  🎲
                </i>
                <b>Surpresa</b>
                <small>Sorteia um boss na hora</small>
              </span>
            </label>
          </div>
          <div className="field" style={{ marginTop: 16 }}>
            <label htmlFor="b-name">
              Nome do boss <span className="muted">(opcional)</span>
            </label>
            <input
              className="input"
              id="b-name"
              maxLength={32}
              value={name}
              placeholder={skin === 'random' ? 'Nome do boss sorteado' : BOSS_SKINS[skin].name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </Card>
      </div>
      <div className="col">
        <Card title="Regras da luta">
          <div className="field">
            <span className="field-label">Vida do boss</span>
            <Options
              name="preset"
              value={preset}
              onChange={setPreset}
              options={[
                {
                  value: 'auto' as const,
                  label: '⚡ Automática',
                  hint: status ? `~${nf.format(status.autoHp)} HP agora · ${nf.format(status.activeChatters)} ativos` : 'calcula pelo seu chat',
                },
                ...(Object.keys(BOSS_PRESETS) as BossPresetKey[]).map((k) => ({
                  value: k,
                  label: BOSS_PRESETS[k].label,
                  hint: `${nf.format(BOSS_PRESETS[k].maxHp)} HP · ${BOSS_PRESETS[k].hint}`,
                })),
              ]}
            />
          </div>
          <div className="field">
            <span className="field-label">Tempo limite</span>
            <Options
              tight
              name="duration"
              value={duration}
              onChange={setDuration}
              options={[
                { value: 60, label: '1 min' },
                { value: 180, label: '3 min' },
                { value: 300, label: '5 min' },
                { value: 0, label: 'Sem limite' },
              ]}
            />
          </div>
          <div className="field">
            <span className="field-label">Intervalo entre ataques (por pessoa)</span>
            <Options tight name="cooldown" value={cooldown} onChange={setCooldown} options={[1000, 2000, 3000, 5000].map((v) => ({ value: v, label: `${v / 1000}s` }))} />
          </div>
          <div className="actions">
            <button className="btn primary lg" onClick={start}>
              {running ? '🔄 Reiniciar boss' : '⚔️ Invocar boss'}
            </button>
            <button
              className="btn danger lg"
              disabled={!running}
              onClick={async () => {
                await api('/api/boss/stop', {});
                toast('Boss encerrado.');
              }}
            >
              Encerrar
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── Automático ──────────────────────────────────────────────

function AutoTab() {
  const { me, status, boss, saveSettings, clockOffset } = useApp();
  useTick(1000);
  const a = me!.settings.autoSpawn;
  const preset = (AUTO_SPAWN_INTERVALS as readonly number[]).includes(a.intervalMin);
  const [custom, setCustom] = useState(!preset);
  const running = boss?.state?.status === 'running';

  let statusText = 'Desligado. Ligue para o boss aparecer sozinho durante a live.';
  let tone = '';
  if (a.enabled) {
    if (running) statusText = 'Luta em andamento. A contagem recomeça quando ela acabar.';
    else if (!status?.live) {
      statusText = 'Esperando sua live entrar no ar.';
      tone = 'wait';
    } else if (status.nextAutoAt) {
      statusText = `Próximo boss em ${fmtCountdown(status.nextAutoAt - (Date.now() + clockOffset))}`;
      tone = a.minChatters > 0 && status.activeChatters < a.minChatters ? 'wait' : 'ok';
      if (tone === 'wait') statusText += ` · precisa de ${a.minChatters} pessoas ativas (agora: ${status.activeChatters})`;
    }
  }

  return (
    <div className="narrow">
      <Card
        title="Boss automático"
        subtitle="O boss aparece sozinho de tempo em tempo"
        right={<Switch label="Ligar boss automático" checked={a.enabled} onChange={(v) => saveSettings({ autoSpawn: { enabled: v } })} />}
      >
        <div className={`auto-status ${tone}`}>{statusText}</div>
        <div className="field">
          <span className="field-label">A cada</span>
          <Options
            tight
            name="interval"
            value={custom ? -1 : a.intervalMin}
            onChange={(v) => {
              if (v === -1) setCustom(true);
              else {
                setCustom(false);
                saveSettings({ autoSpawn: { intervalMin: v } });
              }
            }}
            options={[...AUTO_SPAWN_INTERVALS.map((m) => ({ value: m as number, label: m < 60 ? `${m} min` : `${m / 60} h` })), { value: -1, label: 'Outro' }]}
          />
          {custom && (
            <div className="inline-input">
              <input
                className="input"
                type="number"
                min={5}
                max={720}
                step={5}
                defaultValue={a.intervalMin}
                onBlur={(e) => saveSettings({ autoSpawn: { intervalMin: Math.min(720, Math.max(5, Number(e.target.value) || 60)) } })}
              />
              <span>minutos (de 5 a 720)</span>
            </div>
          )}
        </div>
        <div className="field">
          <label htmlFor="auto-skin">Qual boss</label>
          <select id="auto-skin" className="input" value={a.skin} onChange={(e) => saveSettings({ autoSpawn: { skin: e.target.value } })}>
            <option value="random">🎲 Surpresa (um diferente a cada vez)</option>
            {BOSS_SKIN_IDS.map((id) => (
              <option key={id} value={id}>
                {BOSS_SKINS[id].name}: {BOSS_SKINS[id].title}
              </option>
            ))}
          </select>
        </div>
        <Check checked={a.warn} onChange={(v) => saveSettings({ autoSpawn: { warn: v } })}>
          Avisar no chat e no overlay 1 minuto antes
        </Check>
        <Check checked={a.minChatters > 0} onChange={(v) => saveSettings({ autoSpawn: { minChatters: v ? 3 : 0 } })}>
          Só invocar com pelo menos{' '}
          <input
            className="input mini"
            type="number"
            min={1}
            max={1000}
            defaultValue={Math.max(1, a.minChatters)}
            onBlur={(e) => saveSettings({ autoSpawn: { minChatters: Number(e.target.value) || 1 } })}
            aria-label="Mínimo de pessoas ativas"
          />{' '}
          pessoas ativas no chat
        </Check>
        <p className="muted">Usa as regras da aba Partida. A contagem recomeça depois de cada luta, e o boss só aparece com a live no ar.</p>
      </Card>
    </div>
  );
}

// ─── Apoios ──────────────────────────────────────────────────

function SupportTab() {
  const { me, saveSettings } = useApp();
  const sup = me!.settings.support;
  const set = (patch: Partial<{ [K in keyof SupportSettings]: Partial<SupportSettings[K]> }>) => saveSettings({ support: patch });
  const num = (v: string) => Number(v) || 0;

  return (
    <div className="grid">
      <div className="col">
        <Card title="Bits, subs e pontos" subtitle="Quem apoia a live dá golpes especiais no boss">
          <div className="support-list">
            <SupRow icon="💎" title="Bits" effect="Chuva de cristais" enabled={sup.bits.enabled} onToggle={(v) => set({ bits: { enabled: v } })} hint={`100 bits = ${nf.format(100 * sup.bits.damagePerBit)} de dano`}>
              <input className="input mini" type="number" min={1} max={50} defaultValue={sup.bits.damagePerBit} onBlur={(e) => set({ bits: { damagePerBit: num(e.target.value) } })} aria-label="Dano por bit" /> de dano por bit
            </SupRow>
            <SupRow icon="⭐" title="Subs e presentes" effect="Raio dourado por sub" enabled={sup.subs.enabled} onToggle={(v) => set({ subs: { enabled: v } })} hint="5 subs de presente = 5 raios">
              <input className="input mini" type="number" min={10} max={10000} step={10} defaultValue={sup.subs.damagePerSub} onBlur={(e) => set({ subs: { damagePerSub: num(e.target.value) } })} aria-label="Dano por sub" /> de dano por sub
            </SupRow>
            <SupRow
              icon="🎯"
              title="Pontos de canal"
              effect='Recompensa "⚔️ Golpe Especial no Boss"'
              enabled={sup.points.enabled}
              onToggle={(v) => set({ points: { enabled: v } })}
              hint={me!.pointsReward?.message ?? 'Criada no seu canal. Só abre durante a luta; sem boss, os pontos voltam.'}
              warn={me!.pointsReward ? !me!.pointsReward.ok : false}
            >
              custa <input className="input mini" type="number" min={1} step={50} defaultValue={sup.points.cost} onBlur={(e) => set({ points: { cost: num(e.target.value) } })} aria-label="Custo em pontos" /> pontos e causa{' '}
              <input className="input mini" type="number" min={1} step={10} defaultValue={sup.points.damage} onBlur={(e) => set({ points: { damage: num(e.target.value) } })} aria-label="Dano" /> de dano
            </SupRow>
            <SupRow icon="🚀" title="Raids" effect="Reforços entram correndo" enabled={sup.raid.enabled} onToggle={(v) => set({ raid: { enabled: v } })}>
              <input className="input mini" type="number" min={1} max={100} defaultValue={sup.raid.damagePerViewer} onBlur={(e) => set({ raid: { damagePerViewer: num(e.target.value) } })} aria-label="Dano por pessoa" /> de dano por pessoa do raid
            </SupRow>
          </div>
          <p className="muted">Golpes de apoio não têm armadura nem intervalo e contam no ranking. Sem boss na arena, nada é gasto.</p>
        </Card>
      </div>
      <div className="col">
        <Card
          title="Clip automático"
          subtitle="Cria um clip na Twitch quando o boss é derrotado"
          right={<Switch label="Clip automático" checked={me!.settings.clip.enabled} onChange={(v) => saveSettings({ clip: { enabled: v } })} />}
        >
          <Check checked={me!.settings.clip.postInChat} onChange={(v) => saveSettings({ clip: { postInChat: v } })}>
            Postar o link do clip no chat
          </Check>
          <p className="muted">O clip pega a explosão e a vitória. Só funciona com a live no ar.</p>
        </Card>
        <p className="muted">
          Para testar sem gastar nada, use os botões de apoio em <Link to="/app/testar">Testar</Link>.
        </p>
      </div>
    </div>
  );
}

function SupRow(props: { icon: string; title: string; effect: string; enabled: boolean; onToggle: (v: boolean) => void; hint?: string; warn?: boolean; children: React.ReactNode }) {
  return (
    <div className="sup-row">
      <div className="sup-ico" aria-hidden="true">
        {props.icon}
      </div>
      <div className="sup-body">
        <div className="sup-title">
          <b>{props.title}</b>
          <span>{props.effect}</span>
        </div>
        <div className="sup-ctrl">{props.children}</div>
        {props.hint && <div className={`sup-hint ${props.warn ? 'warn' : ''}`}>{props.hint}</div>}
      </div>
      <Switch label={props.title} checked={props.enabled} onChange={props.onToggle} />
    </div>
  );
}

// ─── Comandos ────────────────────────────────────────────────

function CommandsTab() {
  return (
    <div className="grid">
      <Card title="Para o chat" subtitle="Mostre isso para o seu público">
        <div className="cmds">
          <div className="cmd">
            <kbd>!atk</kbd>
            <p>
              <b>Ataque normal.</b> Dano de 8 a 15, com chance de crítico (dobro). Subs têm mais chance de crítico.
            </p>
          </div>
          <div className="cmd">
            <kbd>!ult</kbd>
            <p>
              <b>Golpe especial</b>, uma vez por luta: 40 a 60 de dano.
            </p>
          </div>
          <div className="cmd">
            <kbd>!boss</kbd>
            <p>O bot explica como jogar.</p>
          </div>
          <div className="cmd">
            <kbd>50%</kbd>
            <p>
              <b>Fúria:</b> o boss fica blindado e o dano cai 25%.
            </p>
          </div>
          <div className="cmd">
            <kbd>20%</kbd>
            <p>
              <b>Desespero:</b> o dano sobe 50%. Hora do hype.
            </p>
          </div>
        </div>
      </Card>
      <Card title="Para você e seus mods" subtitle="Controle sem abrir o painel">
        <div className="cmds">
          <div className="cmd">
            <kbd>!boss iniciar</kbd>
            <p>
              <b>Invoca</b> com as regras atuais.
            </p>
          </div>
          <div className="cmd">
            <kbd>!boss brasa</kbd>
            <p>
              Invoca um boss específico: <code>gosmao</code>, <code>ossudo</code>, <code>mecha</code>, <code>glitchador</code> ou <code>surpresa</code>.
            </p>
          </div>
          <div className="cmd">
            <kbd>!boss parar</kbd>
            <p>
              <b>Encerra</b> a luta atual.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
