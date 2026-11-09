<script setup lang="ts">
import { computed } from 'vue'
import { useRoomStore } from '@/stores/room'

/** Com todas as palavras abertas: propor pular e votar. Todos precisam aceitar; ninguém pontua. */
const room = useRoomStore()
const r = computed(() => room.round!)
const meId = computed(() => room.me?.id ?? '')
const vote = computed(() => r.value.skipVote)
const iAmVoter = computed(() =>
  vote.value
    ? vote.value.voters.includes(meId.value)
    : !room.isMaster && room.players.some((p) => p.id === meId.value && !p.left),
)
const myVote = computed(() => vote.value?.votes[meId.value])
const accepted = computed(() => (vote.value ? vote.value.voters.filter((id) => vote.value!.votes[id] === true) : []))
const waiting = computed(() => (vote.value ? vote.value.voters.filter((id) => !(id in vote.value!.votes)) : []))
const names = (ids: string[]) => ids.map((id) => room.playerName(id)).join(', ')
</script>

<template>
  <div class="skip" data-test="skip">
    <template v-if="vote">
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
    </template>

    <template v-else-if="r.skipVoteAvailable && iAmVoter">
      <p class="hint">Todas as palavras estão abertas e ninguém acertou. Se todos aceitarem, a pergunta é pulada sem pontos.</p>
      <button class="btn ghost" data-test="skip-start" @click="room.startSkip()">Propor pular a pergunta</button>
    </template>

    <p v-else class="hint">
      Todas as palavras estão abertas. Uma nova votação para pular só depois de uma volta de chutes.
    </p>
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
</style>
