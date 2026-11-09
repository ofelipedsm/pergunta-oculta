# Deploy: Pergunta Oculta online

São duas peças, em dois lugares:

| Peça | Onde | Por quê |
| --- | --- | --- |
| Front (`apps/web`) | **Vercel** | Site estático em Vue. Grátis no plano Hobby. |
| Servidor (`apps/server`) | **Render** (grátis) ou **Fly.io** (cerca de US$ 2/mês) | Precisa ficar ligado com as salas na memória e com conexões WebSocket abertas. |

> **Por que o servidor não vai para a Vercel?** A Vercel passou a aceitar WebSocket nas Functions em 2026, mas cada conexão dura no máximo o tempo da Function (5 minutos por padrão) e cada reconexão pode cair em outra instância, com outra memória. O jogo guarda as salas na memória de **um** processo, então ele precisa de um servidor contínuo.

Ordem: **1. servidor** (para ter o endereço dele) → **2. front na Vercel** → **3. liberar o front no servidor (CORS)** → **4. testar**.

---

## 1. Servidor

Escolha **uma** das opções.

### Opção A: Render, grátis

Bom para jogar com amigos. Limitações do plano grátis:
- O servidor **dorme depois de 15 minutos** sem nenhuma requisição nem mensagem WebSocket. A primeira pessoa a abrir o jogo depois disso espera ele acordar (de alguns segundos a cerca de 1 minuto).
- Durante uma partida ele não dorme, porque o próprio jogo gera mensagens. Mas o Render pode reiniciar serviços grátis a qualquer momento, e uma reinicialização derruba as salas abertas.

Passos:
1. Crie a conta em [render.com](https://render.com) entrando com o GitHub.
2. **New → Blueprint**, escolha o repositório `pergunta-oculta`. O Render lê o `render.yaml` da raiz e cria o serviço `pergunta-oculta-server` com o `Dockerfile`.
3. Quando ele pedir `CORS_ORIGIN`, deixe em branco por enquanto (você preenche no passo 3).
4. Espere o primeiro deploy terminar e copie o endereço, algo como `https://pergunta-oculta-server.onrender.com`.
5. Teste: abra `https://SEU-SERVIDOR/health`. Tem que aparecer `{"ok":true,"questions":313,"rooms":0}`.

### Opção B: Fly.io, cerca de US$ 2/mês, sempre ligado

Sem tempo de acordar e com servidor em São Paulo (`gru`). Contas novas no Fly não têm plano grátis: uma máquina `shared-cpu-1x` com 256 MB ligada o mês inteiro custa por volta de US$ 2 (confira em [fly.io/pricing](https://fly.io/pricing)).

1. Instale o CLI: `curl -L https://fly.io/install.sh | sh` (macOS: `brew install flyctl`) e faça login com `fly auth login`.
2. Na raiz do repositório:
   ```bash
   fly launch --no-deploy --copy-config --name pergunta-oculta-SEUNOME
   ```
   Ele usa o `fly.toml` que já está no repositório. Se perguntar sobre Postgres ou Redis, responda **não**.
3. Faça o primeiro deploy:
   ```bash
   fly deploy
   ```
4. **Deixe uma máquina só.** O Fly às vezes cria duas para alta disponibilidade. Com duas, cada uma teria salas diferentes e os jogadores se perderiam:
   ```bash
   fly scale count 1
   ```
5. Copie o endereço (`https://pergunta-oculta-SEUNOME.fly.dev`) e teste o `/health` como no Render.

---

## 2. Front na Vercel

1. Em [vercel.com](https://vercel.com), **Add New → Project** e importe o repositório `pergunta-oculta`.
2. Em **Root Directory**, escolha **`apps/web`**. Isso é o mais importante.
3. Deixe ligada a opção de incluir arquivos fora do Root Directory no build (vem ligada por padrão em monorepos). O front usa o pacote `packages/shared`.
4. Framework, instalação, build e pasta de saída já vêm do `apps/web/vercel.json`. Não precisa mudar nada:
   - instalação: `pnpm install --frozen-lockfile`
   - build: `pnpm --filter @po/shared build && pnpm --filter @po/web build`
   - saída: `dist`
5. Em **Environment Variables**, crie:

   | Nome | Valor |
   | --- | --- |
   | `VITE_SERVER_URL` | o endereço do servidor do passo 1, sem barra no final. Ex.: `https://pergunta-oculta-server.onrender.com` |

6. **Deploy.** No fim, copie o endereço do site, algo como `https://pergunta-oculta.vercel.app`.

> A `VITE_SERVER_URL` entra no código na hora do build. Se mudar o servidor depois, faça **Redeploy** na Vercel.

---

## 3. Liberar o front no servidor (CORS)

O servidor só aceita conexões dos endereços listados em `CORS_ORIGIN`. Use o endereço da Vercel, sem barra no final. Para mais de um endereço, separe por vírgula (ex.: o `.vercel.app` e um domínio próprio).

- **Render:** serviço → **Environment** → `CORS_ORIGIN` = `https://pergunta-oculta.vercel.app` → salve. O Render reinicia sozinho.
- **Fly.io:**
  ```bash
  fly secrets set CORS_ORIGIN=https://pergunta-oculta.vercel.app
  ```
  O Fly reinicia a máquina sozinho.

---

## 4. Testar

- [ ] `https://SEU-SERVIDOR/health` responde `ok: true`.
- [ ] Abra o site da Vercel no celular, crie uma sala e copie o link.
- [ ] Abra o link em outro celular, **um deles no 4G**, e entre.
- [ ] Jogue uma rodada do modo Banco até o fim.
- [ ] Troque para o modo Mestre e jogue uma rodada com julgamento.
- [ ] Bloqueie a tela de um celular por 30 s e volte: ele tem que reconectar sozinho.
- [ ] Recarregue a página no meio da partida: tem que voltar para o mesmo lugar.

---

## Problemas comuns

| Sintoma | Causa provável | Solução |
| --- | --- | --- |
| Faixa vermelha "Reconectando ao servidor…" que não sai | `VITE_SERVER_URL` errada ou CORS bloqueando | Confira a variável na Vercel (e faça Redeploy) e o `CORS_ORIGIN` no servidor. No celular ou no DevTools, procure erro de CORS no console |
| Abrir `/sala/ABCD` direto dá 404 | Root Directory errado na Vercel | Tem que ser `apps/web`, onde está o `vercel.json` com o rewrite |
| Build da Vercel falha com "Cannot find module '@po/shared'" | A Vercel não incluiu os arquivos fora de `apps/web` | Ligue a opção de incluir arquivos fora do Root Directory e faça Redeploy |
| Primeira entrada demora quase 1 minuto | Render grátis estava dormindo | Normal no plano grátis. Para eliminar, use o Fly ou o plano pago do Render |
| Jogadores na mesma sala não se veem, ou "Sala não encontrada" aleatório | Mais de uma instância do servidor | `fly scale count 1` (Fly) ou uma instância só no Render |
| Salas somem do nada | O servidor reiniciou (deploy novo ou reinício do plano grátis) | Esperado: as salas ficam em memória. Basta criar outra |

## Domínio próprio (opcional)

1. Compre o domínio (ex.: no Registro.br para `.com.br`).
2. Na Vercel: **Project → Settings → Domains** → adicione e siga as instruções de DNS.
3. Adicione o novo endereço ao `CORS_ORIGIN` do servidor, separado por vírgula do `.vercel.app`.
