/**
 * Teste de ponta a ponta no navegador: três celulares jogam uma rodada do modo Banco
 * e uma do modo Mestre, contra o servidor e o front rodando de verdade.
 *
 * Uso (com o servidor em :3000 e o front em :4173):
 *   WEB_URL=http://localhost:4173 node apps/web/e2e/play.mjs
 * Requer o pacote `playwright` instalado (PLAYWRIGHT_PATH aponta para ele, se não estiver no projeto).
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? 'playwright')

const WEB = process.env.WEB_URL ?? 'http://localhost:4173'
const SHOTS = process.env.SHOTS_DIR
const QUESTION = 'Qual fruta amarela o macaco adora comer'

const browser = await chromium.launch()
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }
const errors = []

async function player(name) {
  const ctx = await browser.newContext(phone)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`))
  page.on('console', (m) => {
    // fontes do Google podem não carregar em ambiente sem internet: não é erro do jogo
    if (m.type() === 'error' && !m.text().includes('ERR_TUNNEL') && !m.text().includes('fonts.g'))
      errors.push(`${name}: ${m.text()}`)
  })
  return { name, ctx, page }
}

const step = (msg) => console.log(`✓ ${msg}`)
const shot = async (p, file) => {
  if (!SHOTS) return
  await p.page.waitForTimeout(450) // deixa a animação dos quadrados terminar
  await p.page.screenshot({ path: `${SHOTS}/${file}.png`, fullPage: true })
}
const phase = (p) => p.page.locator('[data-test=action]').getAttribute('data-phase')
async function waitPhase(p, value) {
  await p.page.waitForSelector(`[data-test=action][data-phase=${value}]`, { timeout: 5000 })
}
/** Quem tem a vez é quem vê os quadrados clicáveis. */
async function whoseTurn(players, ms = 5000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    for (const p of players) if (await p.page.locator('.tile.clickable').count()) return p
    await new Promise((r) => setTimeout(r, 50))
  }
  for (const p of players) {
    console.log(p.name, await p.page.locator('[data-test=action]').getAttribute('data-phase'), await p.page.locator('[data-test=action]').innerText())
    await shot(p, `debug-${p.name}`)
  }
  throw new Error('Ninguém está com a vez')
}

try {
  const ana = await player('Ana')
  const bia = await player('Bia')
  const caio = await player('Caio')
  const all = [ana, bia, caio]

  // ---------------- criar e entrar
  await ana.page.goto(WEB)
  await ana.page.fill('#name', 'Ana')
  await ana.page.click('[data-test=create]')
  await ana.page.waitForSelector('[data-test=room-code]')
  const code = (await ana.page.textContent('[data-test=room-code]')).trim()
  step(`Ana criou a sala ${code}`)

  await bia.page.goto(WEB)
  await bia.page.fill('#name', 'Bia')
  await bia.page.fill('[data-test=code]', code.toLowerCase())
  await bia.page.click('[data-test=join]')
  await caio.page.goto(`${WEB}/sala/${code}`)
  await caio.page.fill('[data-test=room-name]', 'Caio')
  await caio.page.click('[data-test=room-join]')
  await ana.page.waitForFunction(() => document.querySelectorAll('.list li').length === 3)
  step('Bia entrou pelo código e Caio pelo link')
  // ---------------- convite: copiar, WhatsApp e QR code
  const link = `${WEB}/sala/${code}`
  const wa = await ana.page.getAttribute('[data-test=whatsapp]', 'href')
  if (!wa.startsWith('https://wa.me/?text=') || !decodeURIComponent(wa).includes(link)) {
    throw new Error(`Link do WhatsApp inesperado: ${wa}`)
  }
  await ana.ctx.grantPermissions(['clipboard-read', 'clipboard-write'])
  await ana.page.click('[data-test=copy-link]')
  await ana.page.waitForSelector('[data-test=copy-link]:has-text("Copiado!")')
  const copiedText = await ana.page.evaluate(() => navigator.clipboard.readText())
  if (copiedText !== link) throw new Error(`Link copiado inesperado: ${copiedText}`)
  await ana.page.click('[data-test=toggle-qr]')
  await ana.page.waitForSelector('[data-test=qr] svg')
  if (SHOTS) await ana.page.locator('[data-test=qr] .qr-img').screenshot({ path: `${SHOTS}/qr.png` })
  step('Convite: link copiado, WhatsApp com o link e QR code na tela')
  // ---------------- chat no lobby
  await bia.page.click('[data-test=chat-open]')
  await bia.page.fill('[data-test=chat-input]', 'Bora modo Mestre depois?')
  await bia.page.click('[data-test=chat-send]')
  await ana.page.waitForSelector('[data-test=chat-unread]:has-text("1")')
  await ana.page.click('[data-test=chat-open]')
  await ana.page.waitForSelector('[data-test=chat-user]:has-text("Bora modo Mestre depois?")')
  await ana.page.waitForSelector('[data-test=chat-system]:has-text("Caio entrou na sala")')
  await shot(ana, '00-chat-lobby')
  await ana.page.click('[data-test=chat] .close')
  await bia.page.click('[data-test=chat] .close')
  step('Chat no lobby: Bia mandou mensagem e Ana viu o aviso de não lida')
  await shot(ana, '01-lobby-dono')
  await shot(bia, '02-lobby-convidado')

  // ---------------- modo Banco
  await ana.page.click('[data-test=start]')
  for (const p of all) await waitPhase(p, 'choosing')
  let t = await whoseTurn(all)
  await shot(t, '03-banco-escolher')
  await t.page.click('[data-test=tile-0]')
  await waitPhase(t, 'guessing')
  await t.page.fill('[data-test=guess-input]', 'resposta errada')
  await t.page.click('[data-test=guess-send]')
  step(`${t.name} abriu a palavra 1 e errou`)

  t = await whoseTurn(all)
  await t.page.click('[data-test=tile-1]')
  await t.page.fill('[data-test=guess-input]', 'sinonimo valido')
  await t.page.click('[data-test=guess-send]')
  await ana.page.waitForSelector('[data-test=validate-miss]')
  await shot(ana, '04-banco-dono-valida')
  await ana.page.click('[data-test=validate-miss]')
  // ponto extra só aparece se faltavam palavras suficientes
  await t.page.waitForSelector('[data-test=action][data-phase=bonus], [data-test=action][data-phase=revealed]')
  step(`Ana validou o chute de ${t.name}`)
  await caio.page.click('[data-test=chat-open]')
  await caio.page.waitForSelector(`[data-test=chat-system]:has-text("Ana validou o chute")`)
  await caio.page.waitForSelector('[data-test=chat-system]:has-text("Vez de")')
  await shot(caio, '05b-chat-partida')
  await caio.page.click('[data-test=chat] .close')
  step('Chat narra a partida: vez de cada um, chutes e validação')

  if ((await phase(t)) === 'bonus') {
    await t.page.click('[data-test=bonus-skip]')
  }
  for (const p of all) await waitPhase(p, 'revealed')
  await shot(bia, '05-banco-resultado')
  const pts = await t.page.locator('.player.turn, .player').allTextContents()
  step(`Rodada do Banco encerrada. Placar: ${pts.join(' | ').replace(/\s+/g, ' ')}`)

  // ---------------- reconexão no meio do jogo
  await ana.page.click('[data-test=next]')
  for (const p of all) await waitPhase(p, 'choosing')
  await bia.page.reload()
  await bia.page.waitForSelector('[data-test=action][data-phase=choosing]')
  step('Bia recarregou a página e voltou para a partida')

  // ---------------- fim e jogar de novo no modo Mestre
  await ana.page.click('text=Encerrar partida')
  await ana.page.click('[data-test=end-yes]')
  for (const p of all) await p.page.waitForSelector('[data-test=end]')
  await shot(caio, '06-fim')
  await ana.page.click('[data-test=restart]')
  await ana.page.waitForSelector('[data-test=start]')
  await ana.page.click('[data-test=mode-master]')
  await bia.page.waitForSelector('[data-test=mode-master].on')
  step('Fim de jogo, de volta ao lobby, modo Mestre escolhido')

  await ana.page.click('[data-test=start]')
  await ana.page.waitForSelector('[data-test=master-editor]')
  await bia.page.waitForSelector('[data-test=action][data-phase=writing]')
  await ana.page.fill('[data-test=master-question]', QUESTION)
  await ana.page.fill('[data-test=master-answer]', 'banana')
  await ana.page.press('[data-test=master-answer]', 'Enter')
  await shot(ana, '07-mestre-editor')
  await ana.page.click('[data-test=master-submit]')
  for (const p of all) await waitPhase(p, 'choosing')
  await shot(ana, '08-mestre-visao')
  step('Ana (mestre) enviou a pergunta')

  t = await whoseTurn([bia, caio])
  await t.page.click('[data-test=tile-0]')
  await t.page.fill('[data-test=guess-input]', 'pera')
  await t.page.click('[data-test=guess-send]')
  await ana.page.waitForSelector('[data-test=judge]')
  await shot(ana, '09-mestre-julga')
  await ana.page.click('[data-test=judge-reject]')
  step(`Ana recusou o chute "pera" de ${t.name}`)

  t = await whoseTurn([bia, caio])
  await t.page.click('[data-test=tile-1]')
  await t.page.fill('[data-test=guess-input]', 'banana prata')
  await t.page.click('[data-test=guess-send]')
  await ana.page.waitForSelector('[data-test=judge]')
  await ana.page.click('[data-test=judge-accept]')
  await waitPhase(t, 'bonus')
  await shot(t, '10-ponto-extra')
  await t.page.fill('[data-test=bonus-input]', QUESTION.toLowerCase())
  await t.page.click('[data-test=bonus-send]')
  for (const p of all) await waitPhase(p, 'revealed')
  const result = await t.page.textContent('[data-test=round-result]')
  await shot(t, '11-mestre-resultado')
  if (!result.includes('+5 +1')) throw new Error(`Resultado inesperado: ${result}`)
  step(`${t.name} acertou com 5 palavras escondidas e ganhou o ponto extra`)

  await ana.page.click('[data-test=next]')
  await bia.page.waitForSelector('[data-test=master-editor]')
  step('Rodada seguinte: Bia virou a mestre')

  // ---------------- todas as palavras abertas: votação para pular
  await ana.page.click('text=Encerrar partida')
  await ana.page.click('[data-test=end-yes]')
  await ana.page.click('[data-test=restart]')
  await ana.page.waitForSelector('[data-test=start]')
  // O lobby acabou de montar: se o primeiro toque se perder na troca de tela, toca de novo.
  for (let k = 0; k < 3 && !(await ana.page.locator('[data-test=mode-bank].on').count()); k++) {
    await ana.page.click('[data-test=mode-bank]')
    await ana.page.waitForSelector('[data-test=mode-bank].on', { timeout: 2000 }).catch(() => {})
  }
  await ana.page.waitForSelector('[data-test=mode-bank].on')
  const pool = (await ana.page.textContent('[data-test=question-pool]')).replace(/\s+/g, ' ')
  const [total, unused] = pool.match(/\d+/g).map(Number)
  if (!(unused < total)) throw new Error(`Contagem de perguntas inesperada: ${pool}`)
  step(`Lobby mostra o que já saiu nesta sala: ${pool.trim()}`)
  await ana.page.click('[data-test=start]')
  for (const p of all) await waitPhase(p, 'choosing')
  /** Quem está com o campo de chute na tela. */
  async function guesser(ms = 5000) {
    const start = Date.now()
    while (Date.now() - start < ms) {
      for (const p of all) if (await p.page.locator('[data-test=guess-input]').count()) return p
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error('Ninguém está chutando')
  }
  // abre tudo errando, até não sobrar palavra escondida
  for (;;) {
    let opener = null
    for (const p of all) if (await p.page.locator('.tile.clickable').count()) opener = p
    if (!opener) break
    await opener.page.locator('.tile.clickable').first().click()
    await opener.page.fill('[data-test=guess-input]', 'nao sei')
    await opener.page.click('[data-test=guess-send]')
    await opener.page.waitForTimeout(80)
  }
  await ana.page.waitForSelector('[data-test=skip-start]')
  await shot(ana, '12-tudo-aberto')
  await ana.page.click('[data-test=skip-start]')
  await bia.page.click('[data-test=skip-reject]')
  await caio.page.waitForSelector('[data-test=chat-open]')
  await ana.page.waitForSelector('text=Uma nova votação para pular só depois de uma volta')
  step('Todas as palavras abertas: Ana propôs pular e Bia recusou; os chutes seguem')
  for (let k = 0; k < 3; k++) {
    const g = await guesser()
    await g.page.fill('[data-test=guess-input]', `ainda nao ${k}`)
    await g.page.click('[data-test=guess-send]')
    await g.page.waitForTimeout(120)
  }
  await bia.page.waitForSelector('[data-test=skip-start]')
  await bia.page.click('[data-test=skip-start]')
  await ana.page.click('[data-test=skip-accept]')
  await caio.page.click('[data-test=skip-accept]')
  for (const p of all) await waitPhase(p, 'revealed')
  const skipped = await caio.page.textContent('[data-test=round-result]')
  if (!skipped.includes('Pergunta pulada')) throw new Error(`Resultado inesperado: ${skipped}`)
  await shot(caio, '13-pulada')
  step('Depois de uma volta, Bia propôs de novo, todos aceitaram e a pergunta foi pulada sem pontos')

  if (errors.length) throw new Error(`Erros no console:\n${errors.join('\n')}`)
  console.log('\nTudo certo.')
} catch (e) {
  console.error(e)
  for (const ctx of browser.contexts()) {
    for (const pg of ctx.pages()) {
      const toasts = await pg.locator('.toasts').innerText().catch(() => '')
      const phase = await pg.locator('[data-test=action]').getAttribute('data-phase').catch(() => null)
      console.error(`[${pg.url()}] fase=${phase} avisos=${toasts.replace(/\n/g, ' | ')}`)
      const failDir = process.env.FAIL_SHOTS ?? SHOTS
      if (failDir) await pg.screenshot({ path: `${failDir}/falha-${ctx.pages().indexOf(pg)}-${Date.now()}.png`, fullPage: true })
    }
  }
  if (errors.length) console.error(errors.join('\n'))
  process.exitCode = 1
} finally {
  await browser.close()
}
