<script setup lang="ts">
import { computed } from 'vue'
import { useRoomStore } from '@/stores/room'

/**
 * Pular a pergunta: qualquer um que adivinha pode propor a qualquer momento da rodada.
 * Todos precisam aceitar e ninguém pontua. Depois de uma recusa, só na próxima volta.
 */
const room = useRoomStore()
const r = computed(() => room.round!)
const meId = computed(() => room.me?.id ?? '')
const vote = computed(() => r.value.skipVote)
const iAmVoter = computed(() =>
  vote.value
    ? vote.value.voters.includes(meId.value)
    : !room.isMaster && !room.spectating && room.players.some((p) => p.id === meId.value && !p.left),
)
const myVote = computed(() => vote.value?.votes[meId.value])
const accepted = computed(() => (vote.value ? vote.value.voters.filter((id) => vote.value!.votes[id] === true) : []))
const waiting = computed(() => (vote.value ? vote.value.voters.filter((id) => !(id in vote.value!.votes)) : []))
const names = (ids: string[]) => ids.map((id) => room.playerName(id)).join(', ')
</script>

<template>
  <div v-if="vote" class="skip" data-test="skip">
    <p>
      <b>{{ room.playerName(vote.startedBy) }}</b> propôs pular a pergunta. Todos precisam aceitar e ninguém pontua.
    </p>
    <p class="hint">
      Aceitaram: {{ names(accepted) || 'ninguém' }}<span v-if="waiting.length"> · Faltam: {{ names(waiting) }}</span>
    </p>
    <div v-if="iAmVoter && myVote === undefined" class="row">
      <button class="btn ok" data-test="skip-accept" @click="room.voteSkip(true)">Aceitar pular</button>
      <button class="btn bad" data-test="skip-reject" @click="room.voteSkip(false)">Recusar, quero chutar</button>
    </div>
    <p v-else-if="myVote === true" class="hint">Você aceitou. Se a vez passar sem todos aceitarem, a votação cai.</p>
  </div>

  <div v-else-if="iAmVoter" class="offer">
    <button
      v-if="r.skipVoteAvailable"
      class="btn ghost small"
      data-test="skip-start"
      @click="room.startSkip()"
    >
      Propor pular a pergunta
    </button>
    <span v-else class="hint">Pular foi recusado. Nova votação depois de uma volta.</span>
  </div>
</template>

<style scoped>
.skip {
  margin-top: 14px;
  padding: 12px 14px;
  border: 1px dashed var(--bg3);
  border-radius: 12px;
}
.skip p {
  margin: 0 0 8px;
  font-size: 14px;
  line-height: 1.45;
}
.skip .row .btn {
  flex: 1;
  font-size: 14px;
  padding: 10px 12px;
}
.offer {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
.offer .hint {
  font-size: 12.5px;
}
</style>
