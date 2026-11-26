import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FOUNDER_DISCOUNT, FOUNDER_SLOTS, PLAN_OFFERS, TRIAL_DAYS } from '@clipei/shared';
import { Logo } from '../components/ui.tsx';

const COMPANY = 'Clipei Studio Digital';
const EMAIL = 'g4master01@gmail.com';
const UPDATED = '25 de novembro de 2026';
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · Clipei Live Games`;
    window.scrollTo(0, 0);
    return () => {
      document.title = 'Clipei Live Games';
    };
  }, [title]);
  return (
    <div className="legal">
      <header className="legal-top">
        <Link to="/" aria-label="Clipei Live Games, página inicial">
          <Logo className="legal-logo" />
        </Link>
        <nav>
          <Link to="/privacidade">Privacidade</Link>
          <Link to="/termos">Termos</Link>
        </nav>
      </header>
      <main className="legal-body">
        <h1>{title}</h1>
        <p className="legal-meta">
          Última atualização: {UPDATED} · {COMPANY}
        </p>
        {children}
        <p className="legal-meta">
          Dúvidas: <a href={`mailto:${EMAIL}`}>{EMAIL}</a>
        </p>
      </main>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <LegalPage title="Política de Privacidade">
      <p>
        Esta política explica quais dados a Clipei Live Games ("Clipei", "nós"), operada por {COMPANY}, coleta, como usa, onde guarda e como você pode pedir acesso ou
        exclusão. Ela vale para o site, o painel e o overlay do OBS, e segue a Lei Geral de Proteção de Dados (LGPD, Lei 13.709/2018).
      </p>

      <h2>1. O que a Clipei faz</h2>
      <p>
        A Clipei é uma ferramenta de interação para transmissões ao vivo: um overlay para o OBS com minigames que o público do streamer controla pelo chat da Twitch,
        da Kick ou do YouTube. É entretenimento, sem dinheiro envolvido. Para usar, o streamer conecta a conta da plataforma em que faz live.
      </p>

      <h2>2. Dados que coletamos</h2>
      <h3>Do streamer (quem cria a conta)</h3>
      <ul>
        <li>
          <b>Dados da conta da plataforma:</b> identificador, nome de usuário, nome de exibição e foto do perfil ou do canal (Twitch, Kick e/ou YouTube).
        </li>
        <li>
          <b>Tokens de acesso:</b> as chaves que a plataforma entrega quando você autoriza a Clipei. Elas permitem ler o chat da sua live, receber apoios e, conforme a
          plataforma, criar a recompensa de pontos e clips. Não temos acesso à sua senha.
        </li>
        <li>
          <b>Uso da plataforma:</b> configurações dos jogos e do overlay, clips criados, histórico das partidas e dados da assinatura (plano, datas e status).
        </li>
        <li>
          <b>Pagamentos:</b> são processados pelo Mercado Pago. A Clipei guarda só o número do pagamento, o valor, a forma de pagamento e a data; não recebe nem guarda dados de cartão.
        </li>
      </ul>
      <h3>Do público do chat</h3>
      <p>
        Enquanto um jogo está rolando, a Clipei recebe as mensagens do chat e os apoios (bits, subs, Kicks, Super Chats, membros, pontos e raids) para executar os
        comandos. Usamos apenas o identificador e o nome de exibição de quem participa, para mostrar o personagem e os rankings. As mensagens são processadas na hora e
        <b> não são guardadas</b>; ficam salvos só nomes que aparecem no resultado das partidas (por exemplo, vencedor e golpe final).
      </p>

      <h2>3. Dados do YouTube e do Google</h2>
      <p>Quando você conecta um canal do YouTube, a Clipei usa os Serviços de API do YouTube com estas permissões:</p>
      <ul>
        <li>
          <b>youtube.readonly</b> (canal do streamer): ler o nome e a foto do canal, encontrar a live que está no ar e ler o chat dessa live, incluindo Super Chats,
          Super Stickers e membros, só para rodar os jogos.
        </li>
        <li>
          <b>youtube.force-ssl</b> (somente a conta do bot da Clipei): publicar as mensagens do bot no chat das lives conectadas.
        </li>
      </ul>
      <p>
        Ao usar os recursos do YouTube, você concorda com os{' '}
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">
          Termos de Serviço do YouTube
        </a>{' '}
        e com a{' '}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
          Política de Privacidade do Google
        </a>
        . Você pode retirar o acesso da Clipei a qualquer momento em Conexões, no painel, ou na página de{' '}
        <a href="https://security.google.com/settings/security/permissions" target="_blank" rel="noreferrer">
          permissões da sua conta Google
        </a>
        .
      </p>
      <p>
        O uso e a transferência, para qualquer outro app, das informações recebidas das APIs do Google pela Clipei seguem a{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
          Política de Dados do Usuário dos Serviços de API do Google
        </a>
        , incluindo os requisitos de Uso Limitado. Dados do Google e do YouTube não são vendidos, não são usados para publicidade e não são usados para treinar
        modelos de inteligência artificial.
      </p>

      <h2>4. Como usamos os dados</h2>
      <ul>
        <li>Rodar os minigames, mostrar o overlay e falar no chat pelo bot.</li>
        <li>Aplicar os apoios do público dentro dos jogos.</li>
        <li>Manter sua conta, seu teste grátis e sua assinatura.</li>
        <li>Corrigir erros, evitar abuso e manter a plataforma segura.</li>
      </ul>
      <p>Não vendemos dados pessoais e não usamos os dados para anúncios.</p>

      <h2>5. Com quem compartilhamos</h2>
      <p>Só com os serviços que fazem a Clipei funcionar, sob contrato e apenas para essa finalidade:</p>
      <ul>
        <li>Supabase (banco de dados), Railway (servidor dos jogos) e Vercel (site e painel);</li>
        <li>Twitch, Kick e YouTube/Google, nas chamadas necessárias para ler o chat, receber apoios e publicar mensagens;</li>
        <li>Mercado Pago, para pagamentos;</li>
        <li>autoridades, quando a lei exigir.</li>
      </ul>
      <p>Esses serviços podem guardar dados fora do Brasil, com as proteções previstas na LGPD.</p>

      <h2>6. Cookies</h2>
      <p>
        Usamos apenas um cookie de sessão, para manter você conectado ao painel, e um cookie temporário durante o login. Não usamos cookies de publicidade nem de
        rastreamento de terceiros.
      </p>

      <h2>7. Por quanto tempo guardamos</h2>
      <ul>
        <li>Dados da conta, configurações, clips e histórico: enquanto a conta existir.</li>
        <li>Tokens de uma plataforma: até você desconectar essa plataforma ou excluir a conta.</li>
        <li>Mensagens do chat: não são guardadas.</li>
        <li>Registros técnicos do servidor: por poucos dias, para segurança e correção de erros.</li>
        <li>Dados de cobrança: pelo prazo exigido pela lei fiscal.</li>
      </ul>

      <h2>8. Seus direitos e exclusão</h2>
      <p>
        Você pode pedir acesso, correção, portabilidade ou exclusão dos seus dados, e retirar consentimentos. Para apagar tudo na hora, use{' '}
        <b>Conta → Excluir minha conta</b> no painel. Se preferir, escreva para <a href={`mailto:${EMAIL}`}>{EMAIL}</a>: respondemos em até 15 dias.
      </p>

      <h2>9. Segurança</h2>
      <p>
        As conexões usam HTTPS, os tokens ficam em banco de dados com acesso restrito ao servidor e o acesso administrativo é limitado à equipe da Clipei. Nenhum
        sistema é 100% seguro; se houver um incidente que afete você, avisaremos conforme a LGPD.
      </p>

      <h2>10. Crianças</h2>
      <p>A Clipei não é destinada a menores de 13 anos. Streamers precisam ter a idade mínima exigida pela plataforma em que fazem live.</p>

      <h2>11. Mudanças</h2>
      <p>Se esta política mudar, a data no topo é atualizada. Mudanças importantes são avisadas no painel.</p>
    </LegalPage>
  );
}

export function TermsPage() {
  const monthly = PLAN_OFFERS.find((p) => p.id === 'monthly')!;
  const yearly = PLAN_OFFERS.find((p) => p.id === 'yearly')!;
  return (
    <LegalPage title="Termos de Serviço">
      <p>
        Estes termos regem o uso da Clipei Live Games ("Clipei"), operada por {COMPANY}. Ao criar uma conta ou usar o site, o painel ou o overlay, você concorda com
        eles e com a <Link to="/privacidade">Política de Privacidade</Link>.
      </p>

      <h2>1. O serviço</h2>
      <p>
        A Clipei é uma ferramenta de software para streamers (SaaS). Ela oferece minigames interativos controlados pelo chat da live, como Boss coletivo, Corrida,
        Duelo, Battle Royale, Pipa Combate, Pênaltis, Defesa da Base e Pescaria. Eles aparecem na transmissão por um overlay no OBS, e um bot responde no chat.
      </p>
      <h3>Natureza do serviço: entretenimento, sem dinheiro</h3>
      <ul>
        <li>A Clipei é entretenimento para a comunidade do streamer, do mesmo tipo que alertas, enquetes e contadores na tela.</li>
        <li>
          A Clipei não oferece nem intermedia apostas, jogos de azar, cassino, rifas, loterias ou sorteios com prêmio, e não recebe nem paga valores do público.
        </li>
        <li>O público participa de graça, digitando comandos no chat, sem criar conta na Clipei.</li>
        <li>Pontos, níveis, coleções e rankings não têm valor em dinheiro, não são vendidos e não podem ser trocados por dinheiro, produtos ou prêmios.</li>
        <li>
          Bits, subs, raids e pontos do canal são recursos das próprias plataformas (Twitch e Kick). Na Clipei, eles só ativam efeitos visuais nos minigames.
        </li>
        <li>O único pagamento é a assinatura da ferramenta, feita pelo streamer (item 4).</li>
      </ul>

      <h2>2. Conta</h2>
      <ul>
        <li>Você entra com uma conta da Twitch, da Kick ou do YouTube e é responsável pelo que acontece nela.</li>
        <li>A URL do overlay é pessoal: não compartilhe. Se vazar, gere uma nova no painel.</li>
        <li>Você precisa ter a idade mínima exigida pela plataforma em que faz live.</li>
      </ul>

      <h2>3. Plataformas de terceiros</h2>
      <p>
        A Clipei depende das APIs da Twitch, da Kick e do YouTube. Ao usá-las pela Clipei, você continua sujeito às regras delas, incluindo os{' '}
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">
          Termos de Serviço do YouTube
        </a>
        . Mudanças, limites de uso ou instabilidade nessas plataformas podem afetar recursos da Clipei, e não temos controle sobre isso.
      </p>

      <h2>4. Teste grátis, planos e pagamento</h2>
      <ul>
        <li>Toda conta nova tem {TRIAL_DAYS} dias de teste grátis, sem cartão.</li>
        <li>
          Depois do teste: plano {monthly.name} por {brl(monthly.price)} por mês ou {yearly.name} por {brl(yearly.price)} por ano. Os {FOUNDER_SLOTS} primeiros
          assinantes recebem o selo Fundador e {Math.round(FOUNDER_DISCOUNT * 100)}% de desconto enquanto mantiverem a assinatura.
        </li>
        <li>Sem plano ativo, os jogos ficam pausados; configurações e histórico continuam salvos.</li>
        <li>
          O pagamento é feito pelo Mercado Pago (Pix, cartão ou boleto). Cada pagamento libera 1 mês ou 12 meses, sem cobrança automática: para continuar, você renova
          no painel. Renovar antes do fim soma ao período que você já tem.
        </li>
        <li>
          Você pode parar quando quiser: basta não renovar, e o acesso segue até o fim do período já pago. Você pode pedir o reembolso em até 7 dias depois do
          pagamento (direito de arrependimento); fora desse prazo, valores pagos não são devolvidos, exceto quando a lei exigir.
        </li>
        <li>Preços podem mudar, com aviso prévio no painel; a mudança vale a partir da próxima renovação.</li>
      </ul>

      <h2>5. Uso permitido</h2>
      <p>Você concorda em não:</p>
      <ul>
        <li>
          usar a Clipei para promover, operar ou divulgar apostas, jogos de azar, cassinos, rifas, loterias ou sorteios pagos, nem associar os resultados dos
          minigames a dinheiro ou prêmios;
        </li>
        <li>exibir conteúdo ilegal, de ódio ou de assédio por meio dos jogos, nomes ou mensagens;</li>
        <li>tentar invadir, sobrecarregar, copiar ou revender a plataforma;</li>
        <li>usar automações para simular público ou apoios.</li>
      </ul>
      <p>
        A Clipei não oferece nem intermedia prêmios. Se você decidir dar algum brinde ao seu público por conta própria, isso acontece fora da Clipei, sob sua
        responsabilidade, seguindo a lei e as regras da plataforma em que faz live. Contas que descumprirem este item podem ser suspensas.
      </p>

      <h2>6. Conteúdo e propriedade</h2>
      <p>
        Os jogos, artes, marca e código da Clipei pertencem a {COMPANY}. Você pode mostrar os jogos nas suas lives e nos seus vídeos, inclusive com monetização. Os
        clips criados ficam na sua conta da plataforma, seguindo as regras dela.
      </p>

      <h2>7. Disponibilidade</h2>
      <p>
        Trabalhamos para manter a Clipei no ar, mas o serviço é oferecido "como está", podendo ter pausas para manutenção, falhas ou mudanças de recursos. Na medida
        permitida pela lei, a responsabilidade da Clipei fica limitada ao valor pago por você nos últimos 3 meses.
      </p>

      <h2>8. Suspensão e encerramento</h2>
      <p>
        Podemos suspender contas que violem estes termos, com aviso quando possível. Você pode excluir sua conta a qualquer momento em Conta → Excluir minha conta.
      </p>

      <h2>9. Mudanças e lei aplicável</h2>
      <p>
        Estes termos podem ser atualizados; a data no topo indica a versão atual e mudanças importantes são avisadas no painel. Vale a lei brasileira, com foro no
        domicílio do consumidor quando a lei assim determinar.
      </p>
    </LegalPage>
  );
}
