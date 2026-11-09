<script setup lang="ts">
import { useRoomStore } from '@/stores/room'

const room = useRoomStore()
</script>

<template>
  <div class="toasts" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in room.toasts" :key="t.id" class="toast" :class="t.kind">{{ t.text }}</div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  left: 50%;
  top: 10px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: min(92vw, 420px);
  z-index: 30;
  pointer-events: none;
}
.toast {
  background: var(--bg3);
  border-left: 4px solid var(--muted);
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 600;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
}
.toast.hit {
  border-left-color: var(--ok);
}
.toast.miss {
  border-left-color: var(--bad);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
.toast-enter-active,
.toast-leave-active {
  transition: all 0.2s;
}
</style>
