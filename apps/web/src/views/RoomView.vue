<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LIMITS } from '@po/shared'
import { loadName } from '@/session'
import { useRoomStore } from '@/stores/room'
import LobbyScreen from '@/components/LobbyScreen.vue'
import GameScreen from '@/components/GameScreen.vue'
import EndScreen from '@/components/EndScreen.vue'

const room = useRoomStore()
const route = useRoute()
const router = useRouter()

const code = computed(() => String(route.params.code ?? '').toUpperCase())
const inThisRoom = computed(() => room.state?.code === code.value)
const checking = ref(true)
const name = ref(loadName())
const error = ref('')

onMounted(async () => {
  if (!inThisRoom.value) await room.rejoin(code.value)
  checking.value = false
})

async function join() {
  if (!name.value.trim()) return (error.value = 'Digite seu nome')
  const res = await room.joinRoom(code.value, name.value.trim())
  if (!res.ok) error.value = res.message
}

async function leave() {
  await room.leave()
  await router.push('/')
}
</script>

<template>
  <template v-if="inThisRoom && room.state">
    <LobbyScreen v-if="room.state.phase === 'lobby'" @leave="leave" />
    <GameScreen v-else-if="room.state.phase === 'playing'" @leave="leave" />
    <EndScreen v-else @leave="leave" />
  </template>

  <section v-else-if="room.closedReason" class="panel stack">
    <h2>{{ room.closedReason }}</h2>
    <RouterLink to="/" class="btn wide" style="display: block; text-align: center; text-decoration: none">
      Voltar ao início
    </RouterLink>
  </section>

  <section v-else-if="!checking" class="panel stack">
    <h2>Entrar na sala {{ code }}</h2>
    <label class="label" for="room-name">Seu nome</label>
    <div class="row">
      <input
        id="room-name"
        v-model="name"
        class="textin"
        :maxlength="LIMITS.nameMax"
        placeholder="Seu nome"
        data-test="room-name"
        @keydown.enter="join"
      />
      <button class="btn" data-test="room-join" @click="join">Entrar</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
  </section>

  <p v-else class="hint">Conectando à sala…</p>
</template>
