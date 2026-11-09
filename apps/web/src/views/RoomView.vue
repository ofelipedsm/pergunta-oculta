<script setup lang="ts">
import { useRoute } from 'vue-router'

// Fase 3: alternar LobbyScreen, GameScreen e EndScreen conforme room:state.
const route = useRoute()
</script>

<template>
  <section class="panel">
    <h2>Sala {{ route.params.code }}</h2>
    <p class="hint">Em construção.</p>
  </section>
</template>
