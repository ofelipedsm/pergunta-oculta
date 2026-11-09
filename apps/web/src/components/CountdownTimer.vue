<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

/** Só desenha a contagem. Quem decide o fim do prazo é o servidor. */
const props = defineProps<{ deadline?: number }>()
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  timer = setInterval(() => (now.value = Date.now()), 250)
})
onBeforeUnmount(() => clearInterval(timer))

const seconds = computed(() =>
  props.deadline ? Math.max(0, Math.ceil((props.deadline - now.value) / 1000)) : null,
)
</script>

<template>
  <span v-if="seconds !== null" class="clock" :class="{ low: seconds <= 10 }">{{ seconds }}s</span>
</template>

<style scoped>
.clock {
  font: 800 18px Fraunces, serif;
  color: var(--muted);
  min-width: 42px;
  text-align: right;
}
.clock.low {
  color: var(--bad);
}
</style>
