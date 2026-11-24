# 🎮 Clipei Live Games

Minigames que o público controla pelo chat da live. Primeiro jogo: **Boss coletivo** na Twitch — uma arena 2D em pixel art onde cada pessoa do chat vira um mini-herói (cavaleiro, mago ou arqueiro) atacando o boss.

## Rodando no seu computador

Pré-requisito: **Node.js 20 ou mais novo** ([nodejs.org](https://nodejs.org)).

```bash
npm install
cp .env.example .env      # no Windows: copy .env.example .env
npm run dev
```

Abra **http://localhost:5173**. Já dá para testar sem a Twitch: ligue o **Simulador de chat** e clique em **Invocar boss**.

## Ligando a Twitch

1. No arquivo `.env`, preencha `TWITCH_CLIENT_ID` e `TWITCH_CLIENT_SECRET` (console da Twitch → Aplicativos → Gerenciar).
2. `TWITCH_REDIRECT_URI` precisa ser **idêntica** à URL cadastrada no console.
3. Reinicie o `npm run dev`.
4. No painel:
   - **Conectar com Twitch**: entre com a conta do **streamer**.
   - **Conta do bot → Conectar**: entre com a conta do **bot** (ex.: ClipeiBot). A tela da Twitch deixa trocar de conta.
5. O status muda para **Ouvindo chat**. Clique em **Mandar mensagem de teste no chat** para confirmar.

> Cadastrou `https://localhost:3000/...` em vez de `http`? Instale o [mkcert](https://github.com/FiloSottile/mkcert), rode
> `mkcert -install && mkdir certs && mkcert -key-file certs/key.pem -cert-file certs/cert.pem localhost`,
> descomente `HTTPS_KEY` e `HTTPS_CERT` no `.env` e use `API_TARGET=https://localhost:3000 npm run dev`.

## Ligando a Kick

A Kick entrega chat, subs, presentes, Kicks e resgates por **webhook**, então ela precisa alcançar o seu servidor por uma URL pública com HTTPS. No PC, use um túnel:

1. **Crie a conta do bot na Kick** (ex.: ClipeiBot) e ative a verificação em duas etapas nela.
2. **Logado na conta do bot**, abra kick.com/settings/developer → criar app:
   - URL de redirecionamento: `http://localhost:3000/api/auth/kick/callback`
   - Permissões: marque todas as que aparecem em `KICK_SCOPES` (ler usuário e canal, escrever no chat, eventos, recompensas e Kicks).
   - Copie o Client ID e o Client Secret para o `.env`.
3. **Crie o túnel com o ngrok** (grátis, com domínio fixo):
   - Crie uma conta em ngrok.com, instale e rode `ngrok config add-authtoken SEU_TOKEN`.
   - No painel do ngrok, em Domains, pegue o seu domínio grátis (ex.: `clipei-g4.ngrok-free.app`).
   - Com o `npm run dev` rodando, abra outro terminal e rode: `ngrok http --url=clipei-g4.ngrok-free.app 3000`
4. **No app da Kick**, ligue **Enable Webhooks** e coloque: `https://clipei-g4.ngrok-free.app/api/webhooks/kick`
5. **No painel da Clipei**, em Conexões → Kick → Conectar, entre com a **sua** conta de streamer.
6. Mande uma mensagem no seu chat da Kick: o status muda para **"Recebendo (há Xs)"**.

Na Kick, o bot responde no chat pelo app da Clipei (`type: bot`). Kicks viram a chuva de cristais (3 de dano por Kick, mesma regra dos Bits). Subs, renovações e presentes viram raios. A recompensa "⚔️ Golpe Especial no Boss" é criada no canal quando os pontos estão ligados. A Kick não tem raid nem API de clip, então esses dois recursos são só da Twitch. Quem usa Twitch e Kick ao mesmo tempo joga a mesma luta com os dois chats.

Todo webhook é conferido pela assinatura RSA-SHA256 da Kick e entregas repetidas são ignoradas.

## Colocando no OBS

Fontes → **+** → **Navegador** → cole a URL do painel (card "Overlay para o OBS"), largura `1920`, altura `1080`.
O fundo é todo transparente: só o boss, os heróis e um HUD discreto aparecem sobre o jogo.
No painel, o streamer escolhe ao vivo (sem colar a URL de novo):

- posição: esquerda, centro ou direita;
- tamanho do minigame: de 40% a 130%, com atalhos P, M e G;
- barra de vida acima do boss ou no topo da tela;
- top 3 de dano e o círculo no chão, ligados ou desligados.

**Painel dentro do OBS:** em Docks → Docks de navegador personalizados, adicione `http://localhost:5173`. O painel funciona em telas estreitas, então dá para invocar o boss sem sair do OBS.

## Bosses disponíveis

| Boss | Tema da arena |
|---|---|
| 👁️ **Glitchador**, o Ciclope Glitch | vermelho |
| 🟢 **Gosmão**, o Rei Slime | verde |
| 🐉 **Brasa**, o Dragão Ancião | laranja |
| 💀 **Rei Ossudo**, o Monarca Esqueleto | roxo |
| 🤖 **Mecha-Z**, o Robô de Guerra | ciano |

O streamer escolhe no painel, pode dar outro nome ao boss ou usar 🎲 **Surpresa**, que sorteia um boss diferente do último.
Para criar um boss novo, desenhe a metade esquerda em `apps/web/src/arena/sprites.ts` (22 colunas, espelhada automaticamente) e registre em `BOSS_SKINS` (`packages/shared`).

## Boss automático, vida automática e sons

- **Vida automática:** a vida é calculada pelo número de pessoas que falaram no chat nos últimos 10 minutos, para a luta durar cerca de 70% do tempo limite.
- **Boss automático:** o streamer escolhe o intervalo (15 min, 30 min, 1 h, 2 h, 3 h ou de 5 a 720 min), qual boss aparece (ou surpresa), o aviso 1 minuto antes e o mínimo de pessoas ativas no chat. A contagem recomeça depois de cada luta, e o boss só aparece com a live no ar (consultado na API da Twitch a cada 90 s).
- **Sons:** sintetizados no navegador (Web Audio), sem arquivos de áudio. O volume fica no painel, e o botão "Testar som" toca na fonte do OBS. A prévia do painel fica muda.

## Bits, subs, pontos de canal, raids e clip automático

| Apoio | Efeito na arena | Padrão |
|---|---|---|
| 💎 Bits | Chuva de cristais | 3 de dano por bit (ligado) |
| ⭐ Sub / resub | Raio dourado | 250 de dano (ligado) |
| 🎁 Subs de presente | Um raio por sub presenteado | 250 por sub (ligado) |
| 🎯 Pontos de canal | Golpe especial em X | custa 500 pontos, 120 de dano (desligado) |
| 🚀 Raid | Reforços entram correndo | 5 de dano por pessoa (ligado) |

- Golpes de apoio não têm armadura nem intervalo e contam no ranking.
- A recompensa "⚔️ Golpe Especial no Boss" é criada automaticamente no canal (exige Afiliado ou Parceiro). Ela fica pausada fora da luta, e um resgate sem boss na arena tem os pontos devolvidos.
- **Clip automático (opcional):** 4 s depois da vitória a Clipei cria um clip na Twitch, posta o link no chat (opcional) e guarda a lista no painel.
- Permissões novas do streamer: `bits:read`, `channel:read:subscriptions`, `channel:manage:redemptions`, `clips:edit`. Quem conectou antes vê o aviso "Reconectar" no painel.
- Cada canal usa uma conexão EventSub própria com o token do streamer (bom para o início). Em escala, trocar por Conduits.
- No simulador do painel há botões para simular cada apoio sem cobrar nada.

## Comandos do chat

| Comando | Efeito |
|---|---|
| `!atk` (`!ataque`, `!attack`, `!bater`) | Golpe de 8 a 15. Crítico dobra o dano (10% de chance; 25% para subs). Cooldown por pessoa configurável. |
| `!ult` (`!especial`) | Golpe de 40 a 60, uma vez por luta. |
| `!boss` | Qualquer pessoa: o bot explica como jogar (no máximo 1 vez a cada 30 s). |
| `!boss iniciar [boss]` | Streamer e mods: invoca com as configurações atuais. |
| `!boss brasa` / `gosmao` / `ossudo` / `mecha` / `glitchador` / `surpresa` | Streamer e mods: invoca esse boss. |
| `!boss parar` | Streamer e mods: encerra a luta. |

Fases: **Fúria** em 50% (dano −25%) e **Desespero** em 20% (dano +50%).

## Plataforma (site + painel)

| Endereço | Página |
|---|---|
| `/` | Site público: o que é, como funciona, minigames, recursos, planos e dúvidas |
| `/entrar` | Login (Twitch; Kick e YouTube em breve) |
| `/app` | Início: primeiros passos, chat/OBS/live/boss automático, luta ao vivo, últimas lutas, clips |
| `/app/jogos` | Catálogo de minigames (Boss coletivo ativo; os outros aparecem como em breve) |
| `/app/jogos/boss` | Boss coletivo em abas: Partida, Automático, Apoios, Comandos |
| `/app/overlay` | URL do OBS, prévia, posição, tamanho, barra de vida e som |
| `/app/conexoes` | Twitch e bot; Kick e YouTube |
| `/app/testar` | Simulador de chat e de apoios |
| `/app/plano` | Planos (cobrança na próxima etapa) |
| `/app/conta` | Perfil e sair |

O painel é React (React Router) em `apps/web/src/app`. O overlay do OBS e a arena continuam em TypeScript puro (`overlay.html`, `src/arena`). O catálogo de minigames e os planos ficam em `packages/shared` (`GAMES`, `PLANS`).

## Estrutura

```
apps/
  server/   Fastify: salas, loop do jogo (100 ms), WebSocket, OAuth e EventSub da Twitch, bot, simulador
  web/      Vite: painel do streamer (index.html) e overlay do OBS (overlay.html)
            src/arena/  motor 2D em canvas: sprites pixel art, heróis, projéteis, partículas
packages/
  shared/   Tipos e protocolo (ChatEvent normalizado para Twitch, Kick e YouTube)
  games/    Lógica dos minigames, sem dependência de plataforma (com testes)
```

Fluxo: `Twitch EventSub → ChatEvent → Room → BossGame → snapshot a cada 100 ms → overlay`.
Para adicionar Kick ou YouTube, basta um adaptador que gere `ChatEvent`. Os jogos não mudam.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run build:demo` | Gera a prévia interativa em um único arquivo (`dist-demo/index.html`), sem servidor |
| `npm run dev` | Servidor (3000) + painel (5173) com recarregamento automático |
| `npm test` | Testes da lógica dos jogos |
| `npm run typecheck` | Checagem de tipos de todo o monorepo |
| `npm run build && npm start` | Produção: o servidor serve painel e overlay na porta 3000 |

## Limitações do MVP (próximos passos)

- Os dados ficam em `data/store.json` (tokens incluídos, não suba para o Git). Próximo passo: Postgres.
- O EventSub usa WebSocket (até 300 canais por conexão). Para escalar: Conduits da Twitch.
- Em produção, defina `BOT_ADMIN_LOGINS` para que só a Clipei possa trocar a conta do bot.


## Admin e conta do bot

O bot (ex.: **ClipeiBot**) é da Clipei e é o mesmo para todos os canais. Só administradores conectam ou trocam essa conta.

1. No `.env`, coloque o seu login da Twitch (pode ter vários, separados por vírgula):
   ```
   ADMIN_LOGINS=g4master
   ```
2. Entre no painel com essa conta: aparece o item **Admin** no menu (`/app/admin`).
3. Em **Conta do bot → Conectar/Trocar**, entre na Twitch **com a conta do bot**.

O streamer não vê nada disso. Em **Conexões** ele só tem o card **Bot da Clipei**:
- o status (no chat / entrando);
- a chave **Fala no chat / Silencioso** (o bot continua lendo os comandos, só para de mandar mensagens);
- a dica `/mod ClipeiBot` com botão de copiar e o botão de mensagem de teste.

Sem `ADMIN_LOGINS`: em desenvolvimento todo mundo é admin (com um aviso na página Admin); em produção, ninguém é.

## Planos e assinatura

Um plano só, com tudo liberado:

| Ciclo | Preço | Fundador (20% off) |
|---|---|---|
| Mensal | R$ 29,90/mês | R$ 23,92/mês |
| Anual | R$ 299/ano (2 meses grátis) | R$ 239,20/ano |

- **Teste de 7 dias sem cartão**, contado a partir da primeira conexão do canal. Reconectar não reinicia o teste.
- **Fundadores:** os 10 primeiros pagantes ganham o selo FUNDADOR #n para sempre e 20% de desconto em todas as renovações. Cortesias não ocupam vaga.
- **Quando o teste ou a assinatura vence:** nenhum boss novo começa (painel, `!boss` no chat e boss automático). A luta em andamento termina normalmente, e configurações, overlay e histórico ficam salvos.
- **Admin → Canais conectados → Ações:** registrar pagamento mensal ou anual (o período soma ao que já existe), dar cortesia, dar +7 dias de teste ou encerrar o acesso.
- **Mercado Pago:** entra em `apps/server/src/billing.ts`. `createCheckout()` abre o pagamento e o webhook de pagamento aprovado chama `activate(canal, ciclo, { provider: 'mercadopago' })`.

## Produção (Vercel + servidor do jogo + Supabase)

```
navegador ──► Vercel (site + painel, apps/web/dist)
               └─ /api/*  ──middleware.ts──►  Servidor do jogo (Dockerfile, ex.: Railway)
OBS overlay ──────────── WebSocket direto ───►  └─ dados ► Supabase (tabela clipei_kv)
```

Por que dois hosts: o servidor do jogo precisa ficar **sempre ligado**. Ele mantém a conexão com a Twitch (bot e EventSub), as lutas em memória e o WebSocket do OBS. Funções serverless (Vercel) desligam entre os pedidos, então o site fica na Vercel e o jogo num host contínuo. Use **uma instância só**.

**Supabase:** rode `supabase/migrations/20261124000000_clipei_kv.sql` no SQL Editor. A tabela tem RLS ligado e nenhuma política, então só a chave secreta do servidor acessa.

**Servidor do jogo** (Railway lê `railway.json` + `Dockerfile`). Variáveis:

| Variável | Exemplo |
|---|---|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | texto aleatório com 32+ caracteres |
| `WEB_URL` | `https://clipei-live-games.vercel.app` |
| `PUBLIC_WS_URL` | `wss://SEU-SERVIDOR.up.railway.app/ws` |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | do app na Twitch |
| `TWITCH_REDIRECT_URI` | `https://clipei-live-games.vercel.app/api/auth/twitch/callback` |
| `ADMIN_LOGINS` | `g4master` |
| `SUPABASE_URL` / `SUPABASE_SECRET_KEY` | do projeto no Supabase |

**Vercel:** projeto ligado ao repositório (usa `vercel.json`), com a variável `API_ORIGIN=https://SEU-SERVIDOR.up.railway.app`.

**Domínio próprio:** aponte o domínio para a Vercel. Depois atualize `WEB_URL` e `TWITCH_REDIRECT_URI` no servidor e a URL de redirecionamento no app da Twitch.

## Corrida

Circuito visto de cima, com karts em pixel art. Fica em **Minigames → Corrida** no painel ou `!corrida iniciar` no chat (mods).

1. **Inscrição** (20 a 90 s): `!correr` (ou `!entrar`) coloca a pessoa no grid. Se tiver menos de 4, entram pilotos CPU (opcional).
2. **Largada** com contagem 3-2-1. Todos andam sozinhos com ritmo sorteado (sorte) e um leve vácuo para quem ficou atrás.
3. **Janela de TURBO** a cada 8 a 11 s, por 4 s: `!turbo` dá um arranque, uma vez por janela, com 15% de chance de tropeçar.
4. **Pista viva:** cascas de banana (tropeço) e óleo (lentidão) aparecem à frente do líder.
5. **Apoios:** pontos = escudo, bits = foguete (ou banana no líder para quem não corre), sub/gift = foguete + escudo, raid = vento a favor para todos.
6. **Chegada:** pódio com tempos, anúncio do bot e clip automático (se ligado).

Só um minigame por vez: o Boss não começa durante a corrida e vice-versa (o boss automático espera).

## Modo tela cheia

Em **Overlay (OBS) → Modo de exibição → Tela cheia**, o minigame ocupa a fonte inteira com cenário completo: o Boss ganha céu, montanhas e chão no tema dele; a Corrida ganha o cenário da pista. Sem jogo rolando, aparece a tela "Aguardando o próximo jogo" com a marca. No modo **Sobreposto** (padrão), tudo continua com fundo transparente, na posição e no tamanho escolhidos.

## Duelo

X1 (ou melhor de 3) no velho oeste. **Minigames → Duelo** no painel ou `!duelo iniciar` (mods).

1. `!duelo`: os dois primeiros entram (se não aparecer o segundo no tempo escolhido, cancela).
2. Encarada com os nomes, contagem 3-2-1 e um **silêncio sorteado de 1 a 4 s** antes do **FOGO!**, para ninguém contar o tempo.
3. `!bang`: **reflexo com sorte**. O primeiro tiro sai antes, mas acerta ~60%; errou, recarrega 1,2 s e o outro tem a vez. Isso diminui a vantagem de quem tem menos atraso na live. Atirar antes do FOGO **trava a arma** (o primeiro tiro só sai 1,5 s depois).
4. **Torcida:** `!1` / `!2`. O lado com mais torcida ganha até +10% de mira.
5. **Apoios viram equipamento** (para quem duela ou para o lado que a pessoa torce): pontos = mira +15%, bits = colete (aguenta 1 tiro), sub = revólver dourado (o próximo tiro não erra). 1 de cada item por duelista.
6. 10 s sem ninguém acertar = rodada empatada. Fim: anúncio do bot, confete e clip (se ligado).

Cenários: Rua do Saloon, Pôr do sol e Cidade fantasma (completos no modo tela cheia).
