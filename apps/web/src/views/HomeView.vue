<script setup lang="ts">
import { LIMITS } from '@po/shared'

// Fase 3: criar sala / entrar por código usando o store `room` e o socket.
const serverUrl = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000'
</script>

<template>
  <section class="panel">
    <p class="sub">
      A resposta é fácil. O difícil é entender o que está sendo perguntado com poucas palavras
      abertas.
    </p>
    <p class="hint">
      Esqueleto do front (Fase 0). Salas de até {{ LIMITS.maxPlayers }} jogadores. Servidor:
      <code>{{ serverUrl }}</code>
    </p>
  </section>
</template>
