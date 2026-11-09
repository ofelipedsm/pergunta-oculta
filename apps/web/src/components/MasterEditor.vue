<script setup lang="ts">
import { computed, ref } from 'vue'
import { LIMITS, splitWords } from '@po/shared'
import { useRoomStore } from '@/stores/room'

const room = useRoomStore()
const question = ref('')
const answerInput = ref('')
const answers = ref<string[]>([])
const category = ref('')
const error = ref('')
const sending = ref(false)

const words = computed(() => splitWords(question.value))
const count = computed(() => words.value.length)
const countOk = computed(() => count.value >= LIMITS.questionMinWords && count.value <= LIMITS.questionMaxWords)

function addAnswer() {
  const a = answerInput.value.trim()
  if (!a) return
  if (answers.value.length >= LIMITS.answersMax) return (error.value = `No máximo ${LIMITS.answersMax} respostas`)
  if (!answers.value.some((x) => x.toLowerCase() === a.toLowerCase())) answers.value.push(a)
  answerInput.value = ''
  error.value = ''
}

function removeAnswer(i: number) {
  answers.value.splice(i, 1)
}

async function submit() {
  addAnswer()
  if (!countOk.value) {
    return (error.value = `A pergunta precisa ter de ${LIMITS.questionMinWords} a ${LIMITS.questionMaxWords} palavras`)
  }
  if (!answers.value.length) return (error.value = 'Coloque pelo menos uma resposta aceita')
  sending.value = true
  const res = await room.submitQuestion({
    question: question.value.trim(),
    answers: answers.value,
    category: category.value.trim() || undefined,
  })
  sending.value = false
  if (!res.ok) error.value = res.message
}
</script>

<template>
  <div class="stack" data-test="master-editor">
    <p class="prompt"><b>Você é o mestre desta rodada.</b> Escreva uma pergunta que todo mundo sabe responder.</p>
    <p class="hint">O desafio é entender a pergunta com poucas palavras abertas, não saber a resposta.</p>

    <label class="label" for="mq">Pergunta ({{ count }} palavras)</label>
    <textarea
      id="mq"
      v-model="question"
      class="textin"
      :maxlength="LIMITS.questionMaxChars"
      placeholder="Ex.: Ford, BYD e Toyota são montadoras de qual produto"
      data-test="master-question"
    />

    <div v-if="words.length" class="tiles preview">
      <span v-for="(w, i) in words" :key="i" class="tile open small">
        <em>{{ i + 1 }}</em> {{ w }}
      </span>
    </div>
    <p v-if="count && !countOk" class="error">De {{ LIMITS.questionMinWords }} a {{ LIMITS.questionMaxWords }} palavras.</p>

    <label class="label" for="ma">Respostas aceitas</label>
    <div class="row">
      <input
        id="ma"
        v-model="answerInput"
        class="textin"
        :maxlength="LIMITS.answerMax"
        placeholder="Ex.: carro"
        data-test="master-answer"
        @keydown.enter.prevent="addAnswer"
      />
      <button class="btn ghost" @click="addAnswer">Adicionar</button>
    </div>
    <div v-if="answers.length" class="chips">
      <button v-for="(a, i) in answers" :key="a" class="chip on" title="Remover" @click="removeAnswer(i)">
        {{ a }} ×
      </button>
    </div>
    <p class="hint">Inclua variações: "carro", "automóvel". Chutes que não baterem chegam para você julgar.</p>

    <label class="label" for="mc">Categoria (opcional, só um rótulo)</label>
    <input id="mc" v-model="category" class="textin" maxlength="30" placeholder="Ex.: Marcas" />

    <button class="btn wide" :disabled="sending" data-test="master-submit" @click="submit">Enviar pergunta</button>
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<style scoped>
.preview {
  margin: 0;
}
.tile.small {
  height: 36px;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  animation: none;
}
.tile.small em {
  font-style: normal;
  color: var(--muted);
  font-size: 11px;
}
</style>
