# Pergunta Oculta

Jogo de festa online: a pergunta aparece em quadrados numerados, cada jogador abre uma palavra na sua vez e é obrigado a chutar a resposta. A resposta é fácil; o difícil é entender a pergunta com poucas palavras abertas. Quem acerta ganha 1 ponto por palavra ainda escondida.

Modos: **Banco** (perguntas sorteadas), **Mestre da Pergunta** (um jogador por rodada cria a pergunta e julga os chutes) e **Misto** (alterna os dois).

Plano completo: [Pergunta Oculta Online — Plano de Implementação](https://claude.ai/artifact/Cubu2jKvu2X3e2B8n3sMeq)

## Estrutura

```
apps/
  web/              Vue 3 + Vite + Pinia (front, vai para a Vercel)
  server/           NestJS + Socket.IO (servidor do jogo, uma instância)
    src/game/       regras do jogo em TypeScript puro, com testes
    src/rooms/      gateway Socket.IO + serviço das salas em memória
packages/
  shared/           tipos, contrato de eventos, schemas zod, normalização de respostas
  question-bank/    800 perguntas. Só o server importa: as respostas nunca vão para o front
```

O servidor é a única fonte da verdade. O celular recebe só `room:state`, montado por `toPublicState(room, viewerId)`, que nunca inclui pergunta ou respostas para quem está adivinhando.

[![CI](https://github.com/ofelipedsm/pergunta-oculta/actions/workflows/ci.yml/badge.svg)](https://github.com/ofelipedsm/pergunta-oculta/actions/workflows/ci.yml)

## Rodando

Requisitos: Node 22+ e pnpm 10.

```bash
pnpm install
pnpm test        # testes de todos os pacotes
pnpm typecheck
pnpm dev         # front em http://localhost:5173 e servidor em http://localhost:3000
```

Teste de ponta a ponta no navegador (três celulares jogando uma rodada do Banco e uma do Mestre). Com o servidor em `:3000` e o front em `:4173` (`pnpm --filter @po/web build && pnpm --filter @po/web preview`):

```bash
pnpm exec playwright install chromium   # só na primeira vez
pnpm e2e
```

Variáveis: copie `apps/web/.env.example` para `apps/web/.env`. No servidor, `PORT` e `CORS_ORIGIN` (lista separada por vírgula; vazia libera qualquer origem).

## CI

O GitHub Actions roda a cada push na `main` e em cada pull request:
1. **Testes, tipos e build** de todos os pacotes.
2. **Partida no navegador:** sobe servidor e front e joga com três navegadores (convite, modo Banco, reconexão, modo Mestre). As capturas de tela ficam nos artefatos da execução.

## Deploy

Front na Vercel, servidor no Render (grátis) ou no Fly.io. Passo a passo completo em [docs/DEPLOY.md](docs/DEPLOY.md).

## Andamento

- [x] Fase 0: monorepo, pacotes `shared` e `question-bank`, esqueleto do server e do web
- [x] Fase 1: núcleo do jogo (`apps/server/src/game`), com testes dos três modos, julgamento, ponto extra, timeouts, saída de jogadores e visibilidade do estado
- [x] Fase 2: `RoomsGateway` + `RoomsService` (Socket.IO, salas em memória, cronômetro por sala, troca de dono, limpeza de salas, limite de 10 eventos/s), com testes de integração usando clientes Socket.IO reais
- [x] Fase 3: front do modo Banco (início, lobby com regras, jogo, fim de jogo, jogar de novo)
- [x] Fase 4: front do modo Mestre e Misto (editor da pergunta com prévia dos quadrados, julgamento, ponto extra julgado pelo mestre)
- [x] Fase 5: reconexão com token, pausa automática com menos de 2 conectados, vez pula quem caiu, mestre offline cede a rodada em 30 s, troca de dono, limpeza de salas, limite de envios
- [x] Fase 6 (preparação): `Dockerfile`, `fly.toml`, `render.yaml`, `apps/web/vercel.json` e o passo a passo em [docs/DEPLOY.md](docs/DEPLOY.md). Falta só subir nas contas.

## Front

- `src/socket.ts`: conexão única, reconecta sozinha.
- `src/stores/room.ts`: guarda o `room:state` e transforma toques em eventos. Nenhuma regra mora no front.
- `src/session.ts`: código da sala, `playerId` e `token` no `localStorage`. Recarregar a página ou perder a rede devolve o jogador à partida.
- Rotas: `/` (criar ou entrar) e `/sala/:code` (lobby, jogo e fim).
- Chat da sala (`ChatDock`): fixo à direita no computador e em botão flutuante no celular, do lobby ao fim de jogo. Além das mensagens dos jogadores, o jogo narra tudo ali: vez de cada um, palavras abertas, chutes, julgamentos, acertos e o fim da rodada.
- Convite no lobby: copiar o link, mandar pelo WhatsApp (mensagem pronta), compartilhar pelo menu do celular ou mostrar um QR code para os amigos apontarem a câmera.
- `vercel.json` já reescreve qualquer rota para o `index.html`.

## Servidor em tempo real

- Eventos e payloads: `packages/shared/src/events.ts`. Todo evento responde pelo callback com `{ ok: true }` ou `{ ok: false, code, message }`.
- Depois de qualquer mudança, cada celular recebe `room:state` com o que ele pode ver, e a sala recebe `room:toast` com avisos curtos.
- Um cronômetro por sala, sempre no prazo da fase (`round.deadline`). Quando vence, o servidor chama `engine.onTimeout()`.
- Dono desconectado por 30 s: a posse passa para o próximo jogador conectado.
- Menos de 2 jogadores conectados: a partida pausa e o cronômetro congela. Quando alguém volta, retoma com o tempo que restava (no mínimo 15 s).
- A vez pula quem está desconectado. Mestre que cai enquanto escreve tem 30 s para voltar; depois a rodada usa uma pergunta do banco.
- Sala sem ninguém conectado por 30 min é removida.
- `skip:start` e `skip:vote` (`{ accept }`): votação para pular, só com todas as palavras abertas. O mestre não vota.
- `chat:send` (qualquer jogador, em qualquer fase): mensagem de até 200 caracteres. O servidor guarda as últimas 120 mensagens da sala e manda junto no `room:state`. As mensagens automáticas nunca revelam a pergunta ou a resposta antes da hora; isso tem teste.
- `game:restart` (dono, depois do fim de jogo) volta ao lobby com os mesmos jogadores e pontos zerados.

## Regras que o núcleo já aplica

- Só o jogador da vez abre palavra, e precisa chutar logo depois. Errou, a vez passa.
- Acerto vale as palavras escondidas. Com todas as palavras abertas, a rodada vira uma roda de chutes (acertar não dá pontos, mas encerra a rodada).
- Com tudo aberto, qualquer jogador que adivinha pode propor **pular a pergunta**. Se todos aceitarem, pula sem ninguém pontuar. Se alguém recusar (ou a vez passar sem todos aceitarem), os chutes seguem e uma nova votação só abre depois de uma volta completa.
- Ponto extra (+1) por escrever a pergunta exata, se faltavam pelo menos N palavras no acerto.
- Modo Mestre: todo chute não reconhecido vai para o mestre aceitar ou recusar. O mestre ganha metade das palavras abertas quando alguém acerta. Se o mestre cai, o dono da sala julga.
- Modo Banco: o dono pode validar o último erro de outro jogador antes de uma nova palavra ser aberta.
- Sem repetição na mesma sala: a sala guarda as perguntas do banco que já saíram, inclusive em partidas anteriores ("Jogar de novo"). Só quando todas da seleção tiverem saído o baralho recomeça, com aviso no chat. O lobby mostra quantas ainda não saíram.
- Prazos: vez estourada conta como erro; mestre que não envia a pergunta cede a rodada para uma pergunta do banco; julgamento sem resposta conta como recusado.
