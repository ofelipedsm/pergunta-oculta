<script setup lang="ts">
import { onMounted, ref } from 'vue'

/**
 * Campo + botão, usado no chute e na tentativa do ponto extra.
 * `primary` destaca o campo: é a ação principal da tela e não pode ser confundido com o chat.
 */
const props = defineProps<{ placeholder: string; button: string; maxlength: number; testId: string; primary?: boolean }>()
const emit = defineEmits<{ submit: [text: string] }>()
const text = ref('')
const input = ref<HTMLInputElement | null>(null)
const sending = ref(false)

onMounted(() => input.value?.focus())

async function send() {
  const v = text.value.trim()
  if (!v || sending.value) return input.value?.focus()
  sending.value = true
  emit('submit', v)
  text.value = ''
  setTimeout(() => (sending.value = false), 400)
}
</script>

<template>
  <div class="row" :class="{ primary: props.primary }">
    <input
      ref="input"
      v-model="text"
      class="textin"
      autocomplete="off"
      :placeholder="props.placeholder"
      :maxlength="props.maxlength"
      :data-test="`${props.testId}-input`"
      @keydown.enter.prevent="send"
    />
    <button class="btn" :disabled="sending" :data-test="`${props.testId}-send`" @click="send">
      {{ props.button }}
    </button>
  </div>
</template>

<style scoped>
.primary .textin {
  padding: 15px 16px;
  font-size: 18px;
  font-weight: 700;
  border-color: var(--gold);
  background: #10132a;
  box-shadow: 0 0 0 4px rgba(242, 185, 75, 0.18);
}
.primary .btn {
  padding: 15px 20px;
  font-size: 17px;
}
</style>
