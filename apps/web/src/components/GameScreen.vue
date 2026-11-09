<script setup lang="ts">
import { computed, ref } from 'vue'
import { LEVEL_LABEL } from '@po/shared'
import { useRoomStore } from '@/stores/room'
import ScoreBoard from './ScoreBoard.vue'
import WordTiles from './WordTiles.vue'
import ActionPanel from './ActionPanel.vue'
import CountdownTimer from './CountdownTimer.vue'

const emit = defineEmits<{ leave: [] }>()
const room = useRoomStore()
const r = computed(() => room.round)
const confirmEnd = ref(false)
const confirmLeave = ref(false)
const goal = computed(() => {
  const c = room.state?.config
  if (!c) return ''
  return c.endBy === 'score' ? `até ${c.target} pts` : `rodada ${r.value?.number ?? 0} de ${c.target}`
})
</script>

<template>
  <ScoreBoard />

  <div v-if="room.state?.paused" class="paused" data-test="paused">
    Partida pausada: aguardando os jogadores voltarem. O cronômetro está parado.
  </div>

  <section v-if="r" class="panel">
    <div class="meta">
      <span v-if="r.source === 'master'" class="tag master">Pergunta de {{ room.playerName(r.masterId) }}</span>
      <span v-if="r.category" class="tag">{{ r.category }}</span>
      <span v-if="r.level" class="tag" :class="`l${r.level}`">{{ LEVEL_LABEL[r.level] }}</span>
      <span class="count">Rodada {{ r.number }} · {{ goal }}</span>
      <CountdownTimer v-if="!room.state?.paused" :deadline="r.deadline" />
    </div>

    <template v-if="r.phase !== 'writing'">
      <p class="worth">
        <template v-if="r.phase === 'choosing' || r.phase === 'guessing'">
          Acertar agora vale: <b>{{ room.hiddenCount }}</b> pts
        </template>
        <template v-else>{{ r.wordCount }} palavras</template>
      </p>
      <WordTiles />
    </template>

    <ActionPanel />

  </section>

  <div class="footer">
    <template v-if="room.isHost">
      <button
        v-if="r && (r.phase === 'choosing' || r.phase === 'guessing') && !room.isMyTurn"
        class="btn ghost small"
        data-test="skip-turn"
        @click="room.skipTurn()"
      >
        Pular a vez de {{ room.playerName(r.turnPlayerId) }}
      </button>
      <button v-if="!confirmEnd" class="btn ghost small" @click="confirmEnd = true">Encerrar partida</button>
      <span v-else class="confirm">
        Encerrar mesmo?
        <button class="btn ghost small" data-test="end-yes" @click="room.endGame()">Sim</button>
        <button class="btn ghost small" @click="confirmEnd = false">Não</button>
      </span>
    </template>
    <button v-if="!confirmLeave" class="btn ghost small" @click="confirmLeave = true">Sair</button>
    <span v-else class="confirm">
      Sair da partida?
      <button class="btn ghost small" @click="emit('leave')">Sim</button>
      <button class="btn ghost small" @click="confirmLeave = false">Não</button>
    </span>
  </div>
</template>

<style scoped>
.paused {
  background: #ffd36b;
  color: var(--ink);
  font-weight: 700;
  font-size: 14px;
  border-radius: 12px;
  padding: 10px 14px;
  margin-bottom: 12px;
}
.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.count {
  color: var(--muted);
  font-size: 13px;
  margin-left: auto;
}
.worth {
  font-size: 14px;
  color: var(--muted);
  margin: 0 0 8px;
}
.worth b {
  color: var(--gold);
  font: 800 20px Fraunces, serif;
}
.footer {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.confirm {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 13px;
  color: var(--muted);
}
</style>
