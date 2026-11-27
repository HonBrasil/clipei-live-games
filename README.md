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

Na Kick, o bot responde no chat pelo app da Clipei (`type: bot`). Kicks viram a chuva de cristais (3 de dano por Kick, mesma regra dos Bits). Subs, renovações e presentes viram raios. A recompensa "⚡ Apoio no Minigame" é criada no canal quando os pontos estão ligados. A Kick não tem raid nem API de clip, então esses dois recursos são só da Twitch. Quem usa Twitch e Kick ao mesmo tempo joga a mesma luta com os dois chats.

Todo webhook é conferido pela assinatura RSA-SHA256 da Kick e entregas repetidas são ignoradas.

**Em produção:** no app da Kick (criado logado na conta do bot), a URL de redirecionamento é `https://clipei-live-games.vercel.app/api/auth/kick/callback` e o webhook vai direto para o servidor do jogo: `https://servidor-do-jogo-production.up.railway.app/api/webhooks/kick`. Na Railway: `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET` e `KICK_REDIRECT_URI`. Com o app configurado, o botão "Entrar com Kick" aparece sozinho na tela de login.

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
- **InfinitePay (Checkout Integrado):** `apps/server/src/infinitepay.ts` + `billing.ts`. Cada pagamento (Pix ou cartão até 12x) libera 1 ou 12 meses, sem cobrança automática; renovar antes soma ao período. Fluxo: `POST /api/billing/checkout` cria o link em `api.checkout.infinitepay.io/links` (preço com desconto de Fundador; `order_nsu` = `clipei.<canal base64url>.<m|y>.<centavos>.<p|t>.<aleatório>`, com `webhook_url` e `redirect_url`) → o streamer paga → volta em `/app/plano?order_nsu=…&transaction_nsu=…&slug=…`, que chama `POST /api/billing/confirm` → e o webhook `POST /api/webhooks/infinitepay` também confirma. O webhook não tem assinatura: os dois conferem em `/payment_check` (pago, valor, canal) e não somam duas vezes. Sem ambiente de teste: o admin tem um botão de pagamento real de R$ 1,00 no Plano. Devolução é feita no app da InfinitePay; no Admin, "Último pagamento devolvido" desconta o período. Variáveis: `INFINITEPAY_HANDLE` (obrigatória), `INFINITEPAY_API_KEY` (recomendada), `INFINITEPAY_WEBHOOK_URL` (opcional). Sem o handle, o botão mostra "Pagamento online em breve".

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
2. Encarada com os nomes e **tempo de torcida** (10 a 30 s, escolhido no painel), depois contagem 3-2-1 e um **silêncio sorteado de 1 a 4 s** antes do **FOGO!**, para ninguém contar o tempo.
3. `!bang`: **reflexo com sorte**. O primeiro tiro sai antes, mas acerta ~60%; errou, recarrega 1,2 s e o outro tem a vez. Isso diminui a vantagem de quem tem menos atraso na live. Atirar antes do FOGO **trava a arma** (o primeiro tiro só sai 1,5 s depois).
4. **Torcida:** `!1` / `!2`. O lado com mais torcida ganha até +10% de mira.
5. **Apoios viram equipamento** (para quem duela ou para o lado que a pessoa torce): pontos = mira +15%, bits = colete (aguenta 1 tiro), sub = revólver dourado (o próximo tiro não erra). 1 de cada item por duelista.
6. 10 s sem ninguém acertar = rodada empatada. Fim: anúncio do bot, confete e clip (se ligado).

Cenários: Rua do Saloon, Pôr do sol e Cidade fantasma (completos no modo tela cheia).

## Publicação

- **Site (Vercel)** e **servidor do jogo (Railway)** publicam sozinhos a cada envio para a branch `main` do GitHub.
- A Railway precisa do **Railway App** instalado no GitHub com acesso ao repositório `clipei-live-games` (instalado em 24/11/2026).

## Battle Royale

Mapa visto de cima (cidade, porto, fazenda, floresta e rio). **Minigames → Battle Royale** ou `!royale iniciar` (mods; também `!br`).

1. **Embarque** (30 a 120 s): `!entrar` ou `!cair cidade|floresta|porto|fazenda`. A cidade tem mais caixas, mas atrai mais gente. Menos de 10? Entram soldados CPU (opcional).
2. **Salto:** o avião cruza o mapa e cada um abre o paraquedas na cor do chat sobre o ponto de pouso.
3. **Valendo:** 10 s de pouso sem tiros (saque). Depois cada soldado anda, saqueia e atira sozinho (o atraso da live não deixa pilotar). Armas por raridade: pistola, escopeta, fuzil, sniper e lendária.
4. **Tempestade** em fases, cada vez menor e mais forte. **Caixa lendária** a cada ~25 s, no lugar votado por quem já morreu ou só assiste (`!caixa <lugar>`). Vivos usam `!curar`.
5. **Último de pé** vence: zoom nos últimos vivos, anúncio do bot, pódio de abates e clip.

Apoios: pontos = curativo extra, bits = colete nível 3, sub = caixa de suprimentos do lado de quem apoiou, raid = bombardeio.
Exibição: **tela cheia (recomendado)** mesmo com o overlay no modo sobreposto, ou **janela** no tamanho/posição do overlay. Partidas de ~2 a 3 min depois do salto, de 10 a 100 jogadores.

## Pipa Combate

Céu de fim de tarde visto de lado, sobre um morro com lajes. **Minigames → Pipa Combate** ou `!pipa iniciar` (mods).

1. **Inscrições** (30 a 120 s): `!pipa` (modelo sorteado) ou `!pipa raia|capucheta|arraia|peixinho`. Cada pessoa vira um bonequinho numa laje. Menos de 6? Entram pipas CPU (opcional).
2. **No céu:** as pipas voam sozinhas com o vento. O chat escolhe a tática:
   - `!puxar`: sobe (altura pesa no relo), recarga 5 s;
   - `!dibicar`: mergulha atrás da pipa mais perto e puxa um relo (+10%), recarga 6 s;
   - `!descarregar`: no relo, +40% de força para cortar, mas a pipa perde altura. Vale até 4 s antes do relo abrir (atraso da live).
3. **Relo:** linhas cruzando perto das pipas abrem um relo de 6 s. Pesa a linha (Comum, Neon, Diamante, Dourada), a altura, a tática e a sorte. A **rabiola** é escudo: o primeiro corte leva só ela.
4. **Pipa voada:** a cortada cai balançando; **qualquer pessoa do chat** apara com `!aparar` (o primeiro leva, ranking de aparadores).
5. **Fim:** última pipa no céu ou, quando o tempo acaba (2 a 5 min), quem cortou mais. Anúncio do bot com o Rei do Céu e o rei da aparada, e clip.

Eventos: ventania de tempos em tempos e pipa enroscada no fio (fica vulnerável).
Apoios: pontos = rabiola extra, bits = Linha Diamante, sub = Raia Dourada (linha dourada + rabiola), raid = ventania e chuva de pipas para aparar.
Exibição: tela cheia (recomendado) ou janela, como no Battle Royale.

## Apoios editáveis por jogo

Cada minigame tem a aba **Apoios** no painel: liga/desliga bits, subs (e presentes), pontos e raids, define mínimo de bits e de pessoas no raid e ajusta a força de cada efeito (segundos de foguete, % de mira, tamanho do colete, bombas, linha da pipa…). Vale na hora, até no meio da partida. O esquema fica em `GAME_SUPPORT` (`packages/shared`), e o painel desenha os campos a partir dele. O Boss continua com a aba Apoios própria (dano por bit, por sub, por pessoa do raid).
A recompensa de pontos virou **"⚡ Apoio no Minigame"** (uma só para todos os jogos; o custo é editável em qualquer aba Apoios).


## YouTube

Google Cloud: projeto com a **YouTube Data API v3** ativada, tela de consentimento (Externo; em modo Teste só entram os e-mails cadastrados como usuários de teste) e um **ID do cliente OAuth (Aplicativo da Web)** com os retornos `https://clipei-live-games.vercel.app/api/auth/youtube/callback` e `http://localhost:3000/api/auth/youtube/callback`. Na Railway: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GOOGLE_REDIRECT_URI`. **Fica desligado ("Em breve" no painel) até `YOUTUBE_ENABLED=true`**, a ligar depois que o Google aprovar o app.

- **Streamer:** Conexões → YouTube → Conectar (permissão `youtube.readonly`). Também dá para entrar só com o YouTube (conta `yt:<canal>`).
- **Bot:** o admin conecta o canal do bot em Admin → Plataformas → YouTube → Conectar bot (permissão `youtube.force-ssl`).
- **Live e chat:** com o OBS aberto (ou jogo rolando), o servidor procura a live ativa a cada 2 min (`liveBroadcasts.list`, 1 de cota) e abre o chat por conexão contínua gRPC (`liveChatMessages.streamList`, 5 de cota por conexão; proto em `apps/server/src/youtube/stream_list.proto`). O histórico que vem na conexão é ignorado.
- **Apoios:** Super Chat e Super Sticker viram "bits" pelo valor (1 bit ≈ US$ 0,01, câmbio aproximado em `youtube/events.ts`); membro novo e marco de meses viram sub; presentes de assinatura viram gift. Sem pontos de canal, raid e clip no YouTube.
- **Cota:** 10.000 unidades/dia no projeto todo. Mensagens do bot custam 20: limite de 350 por dia e 1 a cada 6 s por canal (`YT_SEND_DAILY`, `YT_SEND_GAP_MS`). Cota esgotada aparece no card do YouTube em Conexões.

## Disputa de Pênaltis

Estádio visto de trás do cobrador. **Minigames → Pênaltis** ou `!penaltis iniciar` (mods).

1. **Times:** o streamer define nome e cor dos dois times. O chat entra com `!a` ou `!b` (ou `!entrar`, que cai no time com menos gente). Quem votar sem time entra no menor. Time vazio vira CPU (opcional).
2. **Cobranças:** a cada pênalti, as duas torcidas votam ao mesmo tempo numa janela (8 a 20 s): quem bate escolhe o canto, quem defende escolhe o pulo (`!esq`, `!meio`, `!dir`, lado da tela). A maioria decide; os percentuais só aparecem depois do chute. O cobrador roda entre os membros do time; o goleiro é o mesmo a partida toda.
3. **Resultado:** goleiro no canto certo pega 62% (cantos) ou 72% (meio); fora do canto a bola ainda pode ir na trave ou para fora. 3 ou 5 cobranças para cada lado, decisão antecipada e morte súbita.
4. **Fim:** placar, craque da torcida (quem mais acertou o voto no time campeão), anúncio do bot e clip.

Apoios (editáveis na aba Apoios): bits = chute colocado, sub = paredão (o goleiro alcança o canto ao lado), pontos = voto de capitão (vale mais), raid = pressão da torcida para o time que está perdendo.
Exibição: tela cheia (estádio completo) ou janela com fundo transparente (só o gol e os jogadores).

## Pescaria da Live

Fica rodando a live inteira num canto do overlay, ao lado dos outros jogos (pausa sozinha quando outro minigame abre e volta quando ele acaba). **Minigames → Pescaria** ou `!pescaria ligar` (mods).

- `!pescar` lança a linha; em 4 a 9 s sai um peixe sorteado por raridade (lixo, comum, incomum, raro, épico, lendário), com peso e pontos. Espera por pessoa configurável (30 s a 5 min).
- `!peixes` mostra pontos da semana, posição, coleção e maior peixe; `!ranking` mostra o top 3.
- Ranking semanal (semana ISO no horário de Brasília, zera segunda), pódio da semana passada, ranking geral e coleção do canal no painel.
- O bot anuncia pescas a partir da raridade escolhida (lendário sempre com destaque).
- Apoios editáveis: bits = isca rara, sub = vara de ouro, pontos = lançamento na hora, raid = cardume (`!cardume` pelos mods ou botão no painel): sorte e pontos em dobro e espera pela metade.
- Fundo transparente por padrão (só a água por cima do jogo) ou cenário completo (cartão com céu e mata).
- O ranking da semana pode ficar junto do lago, escondido ou fixo em 8 pontos da tela (Top 3, 5 ou 10). O painel tem um mapa da tela do OBS: escolha "Ranking" ou "Lago" e clique no lugar.
- Persistência em `clipei_kv` com a chave `fish:<channelId>`.

## Minigames automáticos (Temporizador e Modo Loop)

**Automático** no menu (`/app/automatico`, ou `!loop ligar` pelos mods). Dois modos com a mesma lista de jogos:

- **Temporizador** (streamer jogando): um minigame a cada X minutos (10 min a 1,5 h, ou outro valor de 5 a 720). A contagem começa no fim do último minigame, inclusive os abertos na mão, e continua mesmo com o chat parado. O chat e o OBS recebem o aviso 1 minuto antes. Se vencer com a live fora do ar ou o chat vazio, espera, e quando liberar avisa e abre 1 minuto depois. Substitui o antigo "boss automático": quem o tinha ligado migra sozinho para o Temporizador só com o Boss (`migrateAutoSpawn` em `rooms.ts`), e a aba Automático do Boss agora liga/desliga o Boss no Temporizador.
- **Modo Loop** (streamer ausente): os minigames se revezam sozinhos.

- Escolha os jogos do rodízio (boss, corrida, duelo, battle royale, pipa, pênaltis), em sequência (ordem com as setas) ou aleatório sem repetir o último.
- Pausa entre jogos (30 s a 10 min), contada a partir do fim do jogo anterior; o primeiro abre 15 s depois de ligar.
- Só roda com a live no ar (opcional), com o OBS conectado e com um mínimo de pessoas falando no chat; quando alguma condição falha, espera e volta sozinho.
- Desliga sozinho depois de 1, 2, 4 ou 8 horas (opcional).
- O bot avisa o próximo jogo no chat e o OBS mostra a contagem no topo ("Próximo minigame · 🏁 Corrida · 0:42").
- Se o streamer abrir um jogo na mão, o loop espera ele terminar. Com o loop ligado, o boss automático fica desativado (o boss entra no rodízio). A pescaria continua entre os jogos.
- `!loop pular` (ou o botão no painel) abre o próximo sem esperar a pausa. `POST /api/loop/skip`.

## Defesa da Base

Tower defense cooperativo. **Minigames → Defesa da Base** ou `!defesa iniciar` (mods; `!defesa comecar` pula a espera, `!defesa parar` encerra).

- Monstros saem de um portal à direita e andam pela estrada até o castelo, à esquerda. Cada pessoa vira uma torre ao lado da estrada: `!arqueiro` (rápido, longe), `!mago` (deixa lento, fura armadura) ou `!canhao` (explosão em área). Dá para entrar no meio da partida; com os lugares cheios, gente de verdade tira uma torre CPU.
- As torres atiram sozinhas no monstro mais adiantado. `!atk` carrega um tiro forte (3x, recarga de 8 s).
- Monstros: goblin (comum), lobo (rápido, em matilha), ogro (armadura: flecha e bala perdem 45%, magia não) e o Rei Ogro na última onda. Vida escala com a onda, a dificuldade e o número de torres.
- Entre as ondas o chat vota: `!muralha` (conserta e aumenta a base), `!gelo` (monstros mais lentos, mago mais forte) ou `!fogo` (mais dano e queimadura). Melhorias acumulam.
- Apoios editáveis: bits = meteoro (dano por bit), sub = herói na base, pontos = torre um nível acima, raid = onda de aliados.
- Balanceamento simulado (`HP_MULT` e `TEAM_EXP` em `packages/games/src/defense.ts`): no normal o chat vence cerca de 2 de cada 3 partidas.
- Entra no Modo Loop (vem desmarcado por padrão).

## Termo do Chat

A palavra secreta de 5 letras, no estilo Termo/Wordle. **Minigames → Termo do Chat** ou `!termo iniciar` (mods; `!termo pular` mostra a resposta e vai para a próxima, `!termo parar` encerra).

- O chat chuta com `!t palavra` (ou `!termo palavra`). Acentos não importam; só valem palavras do dicionário (11,7 mil palavras de 5 letras de `@andsfonseca/palavras-pt-br`, MIT, em `packages/games/src/termo-words.ts`). As respostas saem de uma lista curada de 345 palavras comuns.
- Cada chute aparece na tela com o nome de quem chutou: verde = lugar certo, amarelo = outro lugar, cinza = não tem. Teclado colorido e as letras já descobertas no topo.
- Pontos: acertar = 100 + bônus de rapidez (até 50); descobrir letra nova no lugar = +10, fora do lugar = +3. Espera por pessoa entre chutes (padrão 5 s).
- Partida de 1, 3 ou 5 palavras; dicas automáticas na metade e nos 3/4 do tempo (nunca revela a palavra inteira). Ranking da semana salvo em `termo:<canal>`.
- Apoios editáveis: bits e pontos = dica (revela uma letra), sub = chute sem espera por X min, raid = mais tempo e uma letra.
- Entra no Automático (Temporizador e Modo Loop).

## Primeiros passos e Testar no OBS

- **Configuração guiada** (`/app/comecar`): 4 passos (plataforma, OBS, teste com chat simulado, Automático), com progresso salvo em `settings.onboarding`. Conta nova cai nela depois do login; dá para pular passos ou esconder.
- **Testar no OBS** (Overlay e passo 2): o servidor manda `obs-test` para as fontes conectadas, elas mostram um aviso verde por 8 s e respondem `obs-pong` com: está no OBS de verdade (`window.obsstudio`), tamanho da fonte e se a cena está no ar. O painel aponta o problema (aba do navegador, tamanho diferente de 1920×1080, cena fora do ar, fonte sem resposta) e pergunta se o aviso apareceu.
- A prévia do painel conecta como `client=preview` e não conta mais como "OBS conectado".

## Desafios do Chat

O chat escolhe o desafio que o streamer vai cumprir. **Minigames → Desafios do Chat** ou `!desafio votar` (mods).

- **Personalizável**: o streamer monta a própria lista (até 60 desafios, 120 caracteres cada), com duração por desafio (1 a 60 min ou "até cumprir"), ativa/desativa, reordena e apaga. Tem ideias prontas para adicionar com um clique.
- Votação com 2 a 5 opções (sorteadas sem repetir os últimos, ou escolhidas a dedo no painel) e 20 a 90 s. O chat vota com `!1`, `!2`…; dá para trocar o voto. Também dá para "Valer agora" um desafio sem votação.
- Só a votação ocupa a tela como jogo. O desafio valendo fica numa faixa no topo com o tempo correndo, e os outros minigames podem rodar ao mesmo tempo.
- Fim: `!desafio cumprido` (confete), `!desafio falhou`, `!desafio parar` ou tempo esgotado. Histórico dos últimos 15 no painel.
- Sugestões: `!sugerir texto` (ninguém / só subs / todo o chat). Tudo vai para aprovação no painel antes de entrar na lista. `!desafio` mostra o desafio valendo.
- Apoios editáveis: bits e pontos = voto turbinado, sub = libera sugerir, raid = mais minutos no desafio valendo.
- Entra no Automático (Temporizador e Modo Loop): o resultado sai sozinho quando o tempo acaba.
