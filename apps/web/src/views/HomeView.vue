<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { LIMITS } from '@po/shared'
import { loadName } from '@/session'
import { useRoomStore } from '@/stores/room'

const room = useRoomStore()
const router = useRouter()

const name = ref(loadName())
const code = ref('')
const error = ref('')
const busy = ref(false)

async function create() {
  if (!name.value.trim()) return (error.value = 'Digite seu nome')
  busy.value = true
  const res = await room.createRoom(name.value.trim())
  busy.value = false
  if (!res.ok) return (error.value = res.message)
  await router.push(`/sala/${res.data.code}`)
}

async function join() {
  if (!name.value.trim()) return (error.value = 'Digite seu nome')
  if (code.value.trim().length !== LIMITS.roomCodeLength) return (error.value = 'O código tem 4 letras')
  busy.value = true
  const res = await room.joinRoom(code.value.trim(), name.value.trim())
  busy.value = false
  if (!res.ok) return (error.value = res.message)
  await router.push(`/sala/${res.data.code}`)
}
</script>

<template>
  <p class="sub">
    A resposta é fácil. O difícil é entender o que está sendo perguntado com poucas palavras abertas:
    quanto antes acertar, mais pontos.
  </p>

  <section class="panel stack">
    <label class="label" for="name">Seu nome</label>
    <input
      id="name"
      v-model="name"
      class="textin"
      :maxlength="LIMITS.nameMax"
      placeholder="Como os amigos te chamam"
      autocomplete="nickname"
    />
  </section>

  <section class="panel stack">
    <h2>Criar uma sala</h2>
    <p class="hint">Você vira o dono da sala, escolhe as regras e manda o link para os amigos.</p>
    <button class="btn wide" :disabled="busy" data-test="create" @click="create">Criar sala</button>
  </section>

  <section class="panel stack">
    <h2>Entrar numa sala</h2>
    <div class="row">
      <input
        v-model="code"
        class="textin code"
        :maxlength="LIMITS.roomCodeLength"
        placeholder="CÓDIGO"
        autocapitalize="characters"
        data-test="code"
        @keydown.enter="join"
      />
      <button class="btn" :disabled="busy" data-test="join" @click="join">Entrar</button>
    </div>
  </section>

  <p v-if="error" class="error">{{ error }}</p>
</template>

<style scoped>
.code {
  text-transform: uppercase;
  letter-spacing: 4px;
  font-weight: 700;
}
</style>
