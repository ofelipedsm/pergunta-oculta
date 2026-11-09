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
packages/
  shared/           tipos, contrato de eventos, schemas zod, normalização de respostas
  question-bank/    313 perguntas. Só o server importa: as respostas nunca vão para o front
```

O servidor é a única fonte da verdade. O celular recebe só `room:state`, montado por `toPublicState(room, viewerId)`, que nunca inclui pergunta ou respostas para quem está adivinhando.

## Rodando

Requisitos: Node 22+ e pnpm 10.

```bash
pnpm install
pnpm test        # testes de todos os pacotes
pnpm typecheck
pnpm dev         # front em http://localhost:5173 e servidor em http://localhost:3000
```

Variáveis: copie `apps/web/.env.example` para `apps/web/.env`. No servidor, `PORT` e `CORS_ORIGIN` (lista separada por vírgula).

## Andamento

- [x] Fase 0: monorepo, pacotes `shared` e `question-bank`, esqueleto do server e do web
- [x] Fase 1: núcleo do jogo (`apps/server/src/game`), com testes dos três modos, julgamento, ponto extra, timeouts, saída de jogadores e visibilidade do estado
- [ ] Fase 2: `RoomsGateway` + `RoomsService` (Socket.IO, salas em memória, cronômetro por sala)
- [ ] Fase 3: front do modo Banco
- [ ] Fase 4: front do modo Mestre e Misto
- [ ] Fase 5: reconexão, limites de envio, limpeza de salas
- [ ] Fase 6: deploy (Vercel + Fly.io ou Render)

## Regras que o núcleo já aplica

- Só o jogador da vez abre palavra, e precisa chutar logo depois. Errou, a vez passa.
- Acerto vale as palavras escondidas. Errar com tudo aberto encerra a rodada sem pontos.
- Ponto extra (+1) por escrever a pergunta exata, se faltavam pelo menos N palavras no acerto.
- Modo Mestre: todo chute não reconhecido vai para o mestre aceitar ou recusar. O mestre ganha metade das palavras abertas quando alguém acerta. Se o mestre cai, o dono da sala julga.
- Modo Banco: o dono pode validar o último erro de outro jogador antes de uma nova palavra ser aberta.
- Prazos: vez estourada conta como erro; mestre que não envia a pergunta cede a rodada para uma pergunta do banco; julgamento sem resposta conta como recusado.
