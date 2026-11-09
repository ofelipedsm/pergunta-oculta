<script setup lang="ts">
import { onMounted, ref } from 'vue'

/** Campo + botão, usado no chute e na tentativa do ponto extra. */
const props = defineProps<{ placeholder: string; button: string; maxlength: number; testId: string }>()
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
  <div class="row">
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
