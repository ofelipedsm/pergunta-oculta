<script setup lang="ts">
import { computed } from 'vue'
import { LIMITS } from '@po/shared'
import { useRoomStore } from '@/stores/room'
import MasterEditor from './MasterEditor.vue'
import TextAction from './TextAction.vue'

const room = useRoomStore()
const r = computed(() => room.round!)
const name = room.playerName
const meId = computed(() => room.me?.id)
const turnName = computed(() => name(r.value.turnPlayerId))
const hit = computed(() => r.value.hit)
const isHitter = computed(() => !!hit.value && hit.value.playerId === meId.value)
const canAdvance = computed(() => room.isHost || r.value.masterId === meId.value)

/** Modo Banco: o dono pode validar o último erro de outra pessoa. */
const canValidateMiss = computed(
  () =>
    r.value.phase === 'choosing' &&
    !!r.value.lastMiss &&
    room.isHost &&
    r.value.lastMiss.playerId !== meId.value,
)

const bonusLabel = computed(() => {
  const b = hit.value?.bonus
  if (b === 'ok') return 'Acertou a pergunta: +1 ponto extra.'
  if (b === 'fail') return 'Errou a pergunta: sem ponto extra.'
  if (b === 'skipped') return 'Não tentou o ponto extra.'
  return ''
})
</script>

<template>
  <div class="action" data-test="action" :data-phase="r.phase">
    <!-- O mestre está escrevendo -->
    <template v-if="r.phase === 'writing'">
      <MasterEditor v-if="room.isMaster" />
      <p v-else class="prompt"><b>{{ name(r.masterId) }}</b> está criando a pergunta…</p>
    </template>

    <!-- Escolher a palavra -->
    <template v-else-if="r.phase === 'choosing'">
      <p v-if="room.isMyTurn" class="prompt">
        <b>Sua vez:</b> toque em um número para abrir uma palavra. Depois você é obrigado a chutar.
      </p>
      <p v-else class="prompt">Vez de <b>{{ turnName }}</b> abrir uma palavra.</p>
      <div v-if="canValidateMiss" class="over">
        {{ name(r.lastMiss!.playerId) }} chutou “{{ r.lastMiss!.text }}”. Estava certo?
        <button class="btn ghost small" data-test="validate-miss" @click="room.judge(true)">
          Sim, dar {{ r.lastMiss!.points }} pts
        </button>
      </div>
    </template>

    <!-- Chutar -->
    <template v-else-if="r.phase === 'guessing'">
      <template v-if="room.isMyTurn">
        <p class="prompt">Qual é a resposta? Se acertar agora, ganha <b>{{ room.hiddenCount }}</b> pts.</p>
        <TextAction
          placeholder="Digite a resposta…"
          button="Chutar"
          :maxlength="LIMITS.guessMax"
          test-id="guess"
          @submit="room.guess"
        />
      </template>
      <p v-else class="prompt"><b>{{ turnName }}</b> está chutando…</p>
    </template>

    <!-- Julgamento -->
    <template v-else-if="r.phase === 'judging' && r.pending">
      <div v-if="room.isJudge" class="result" data-test="judge">
        <h3>{{ r.pending.kind === 'bonus' ? 'Ponto extra' : 'Julgue o chute' }}</h3>
        <p>
          <b>{{ name(r.pending.playerId) }}</b>
          {{ r.pending.kind === 'bonus' ? 'escreveu a pergunta:' : 'chutou:' }}
        </p>
        <p class="quote">“{{ r.pending.text }}”</p>
        <div class="row">
          <button class="btn ok" data-test="judge-accept" @click="room.judge(true)">Aceitar</button>
          <button class="btn bad" data-test="judge-reject" @click="room.judge(false)">Recusar</button>
        </div>
      </div>
      <p v-else class="prompt">
        {{ name(r.pending.playerId) }} {{ r.pending.kind === 'bonus' ? 'escreveu' : 'chutou' }}
        “{{ r.pending.text }}”. <b>{{ name(room.state?.judgeId) }}</b> está julgando…
      </p>
    </template>

    <!-- Ponto extra -->
    <template v-else-if="r.phase === 'bonus' && hit">
      <div class="result">
        <h3>{{ name(hit.playerId) }} acertou! +{{ hit.points }}</h3>
        <p>Resposta: <b>{{ r.answer }}</b></p>
      </div>
      <template v-if="isHitter">
        <p class="prompt">
          <b>Ponto extra:</b> escreva a pergunta exatamente como ela é. Faltavam {{ hit.hiddenAtHit }} palavras.
        </p>
        <TextAction
          placeholder="Escreva a pergunta completa…"
          button="Tentar"
          :maxlength="LIMITS.questionMaxChars"
          test-id="bonus"
          @submit="room.tryBonus"
        />
        <button class="btn ghost small skip" data-test="bonus-skip" @click="room.skipBonus()">Não quero tentar</button>
      </template>
      <p v-else class="prompt">{{ name(hit.playerId) }} está tentando o ponto extra…</p>
    </template>

    <!-- Fim da rodada -->
    <template v-else-if="r.phase === 'revealed'">
      <div class="result" data-test="round-result">
        <h3 v-if="hit">{{ name(hit.playerId) }} acertou! +{{ hit.points }}{{ hit.bonus === 'ok' ? ' +1' : '' }}</h3>
        <h3 v-else>Ninguém acertou</h3>
        <p>Resposta: <b>{{ r.answer }}</b></p>
        <p v-if="bonusLabel">{{ bonusLabel }}</p>
        <p v-else-if="hit && !hit.bonusAllowed && room.state?.config.bonusEnabled">
          Sem ponto extra: faltavam só {{ hit.hiddenAtHit }} palavras escondidas.
        </p>
        <p v-if="hit?.masterPoints !== undefined">{{ name(r.masterId) }} (mestre) ganhou {{ hit.masterPoints }} {{ hit.masterPoints === 1 ? 'ponto' : 'pontos' }}.</p>
        <button v-if="canAdvance" class="btn wide next" data-test="next" @click="room.nextRound()">
          Próxima pergunta →
        </button>
        <p v-else class="hint dark">Esperando {{ name(room.state?.hostId) }} avançar.</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.action {
  margin-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 14px;
}
.action .result + .prompt,
.action .result + .row {
  margin-top: 12px;
}
.over {
  margin-top: 8px;
  font-size: 13px;
  color: var(--muted);
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.quote {
  font-size: 18px;
  font-weight: 700;
}
.result .row {
  margin-top: 10px;
}
.result .row .btn {
  flex: 1;
}
.next {
  margin-top: 12px;
}
.skip {
  margin-top: 8px;
}
.dark {
  color: #555;
}
</style>
