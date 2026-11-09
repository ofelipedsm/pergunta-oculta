<script setup lang="ts">
import { computed } from 'vue'
import { CATEGORIES, LEVEL_LABEL, type Category, type GameMode, type Level, type RoomConfig } from '@po/shared'
import { useRoomStore } from '@/stores/room'

const room = useRoomStore()
const cfg = computed(() => room.state!.config)
const editable = computed(() => room.isHost)
const usesBank = computed(() => cfg.value.mode !== 'master')

const MODES: { id: GameMode; label: string; hint: string }[] = [
  { id: 'bank', label: 'Banco', hint: 'Perguntas sorteadas do banco do jogo.' },
  { id: 'master', label: 'Mestre', hint: 'Cada rodada, um jogador cria a pergunta e julga os chutes.' },
  { id: 'mixed', label: 'Misto', hint: 'Alterna: uma rodada do banco, uma de mestre.' },
]
const LEVELS: Level[] = [1, 2, 3]

function set(patch: Partial<RoomConfig>) {
  if (editable.value) void room.setConfig(patch)
}

function toggleCategory(c: Category) {
  const list = cfg.value.categories
  const next = list.includes(c) ? list.filter((x) => x !== c) : [...list, c]
  if (next.length) set({ categories: next })
}

function toggleLevel(l: Level) {
  const list = cfg.value.levels
  const next = list.includes(l) ? list.filter((x) => x !== l) : [...list, l]
  if (next.length) set({ levels: next })
}

function step(key: 'bonusMinHidden' | 'target', delta: number, min: number, max: number) {
  set({ [key]: Math.min(max, Math.max(min, cfg.value[key] + delta)) })
}
</script>

<template>
  <section class="panel">
    <h2>Regras {{ editable ? '' : '(o dono escolhe)' }}</h2>

    <div class="block">
      <span class="label">Modo de jogo</span>
      <div class="chips">
        <button
          v-for="m in MODES"
          :key="m.id"
          class="chip"
          :class="{ on: cfg.mode === m.id }"
          :disabled="!editable"
          :data-test="`mode-${m.id}`"
          @click="set({ mode: m.id })"
        >
          {{ m.label }}
        </button>
      </div>
      <p class="hint">{{ MODES.find((m) => m.id === cfg.mode)?.hint }}</p>
    </div>

    <div v-if="usesBank" class="block">
      <span class="label">Categorias do banco</span>
      <div v-if="editable" class="links">
        <button @click="set({ categories: [...CATEGORIES] })">Marcar todas</button>
      </div>
      <div class="chips">
        <button
          v-for="c in CATEGORIES"
          :key="c"
          class="chip"
          :class="{ on: cfg.categories.includes(c) }"
          :disabled="!editable"
          @click="toggleCategory(c)"
        >
          {{ c }}
        </button>
      </div>
    </div>

    <div v-if="usesBank" class="block">
      <span class="label">Nível</span>
      <div class="chips">
        <button
          v-for="l in LEVELS"
          :key="l"
          class="chip"
          :class="{ on: cfg.levels.includes(l) }"
          :disabled="!editable"
          @click="toggleLevel(l)"
        >
          {{ LEVEL_LABEL[l] }}
        </button>
      </div>
    </div>

    <div class="block">
      <label class="switch">
        <input
          type="checkbox"
          :checked="cfg.bonusEnabled"
          :disabled="!editable"
          @change="set({ bonusEnabled: ($event.target as HTMLInputElement).checked })"
        />
        Ponto extra por escrever a pergunta exata
      </label>
      <p v-if="cfg.bonusEnabled" class="line">
        Só vale se faltarem pelo menos
        <span class="stepper">
          <button v-if="editable" @click="step('bonusMinHidden', -1, 1, 15)">−</button>
          <b>{{ cfg.bonusMinHidden }}</b>
          <button v-if="editable" @click="step('bonusMinHidden', 1, 1, 15)">+</button>
        </span>
        palavras escondidas no acerto.
      </p>
    </div>

    <div class="block">
      <span class="label">Fim da partida</span>
      <div class="chips">
        <button
          class="chip"
          :class="{ on: cfg.endBy === 'score' }"
          :disabled="!editable"
          @click="set({ endBy: 'score', target: 50 })"
        >
          Por pontos
        </button>
        <button
          class="chip"
          :class="{ on: cfg.endBy === 'rounds' }"
          :disabled="!editable"
          @click="set({ endBy: 'rounds', target: Math.max(room.activePlayers.length, 2) * 2 })"
        >
          Por rodadas
        </button>
      </div>
      <p class="line">
        {{ cfg.endBy === 'score' ? 'Termina quando alguém chegar a' : 'Termina depois de' }}
        <span class="stepper">
          <button v-if="editable" @click="step('target', cfg.endBy === 'score' ? -10 : -1, 1, 500)">−</button>
          <b>{{ cfg.target }}</b>
          <button v-if="editable" @click="step('target', cfg.endBy === 'score' ? 10 : 1, 1, 500)">+</button>
        </span>
        {{ cfg.endBy === 'score' ? 'pontos.' : 'rodadas.' }}
      </p>
    </div>

    <div class="block">
      <span class="label">Tempo por vez</span>
      <div class="chips">
        <button
          v-for="s in [30, 60, 90, 120]"
          :key="s"
          class="chip"
          :class="{ on: cfg.turnTimeoutSec === s }"
          :disabled="!editable"
          @click="set({ turnTimeoutSec: s })"
        >
          {{ s }} s
        </button>
      </div>
    </div>

    <div v-if="cfg.mode !== 'bank'" class="block">
      <span class="label">Tempo para o mestre criar a pergunta</span>
      <div class="chips">
        <button
          v-for="s in [120, 180, 300]"
          :key="s"
          class="chip"
          :class="{ on: cfg.writeTimeoutSec === s }"
          :disabled="!editable"
          @click="set({ writeTimeoutSec: s })"
        >
          {{ s / 60 }} min
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.block + .block {
  margin-top: 16px;
}
.block .hint {
  margin: 6px 0 0;
}
.links {
  margin-bottom: 8px;
}
.links button {
  background: none;
  border: none;
  color: var(--gold);
  font: 600 13px 'DM Sans';
  cursor: pointer;
  padding: 0;
}
.switch {
  display: flex;
  gap: 10px;
  align-items: center;
  font-weight: 600;
  cursor: pointer;
}
.switch input {
  width: 20px;
  height: 20px;
  accent-color: var(--gold);
}
.line {
  margin: 8px 0 0;
  line-height: 2.2;
  font-size: 15px;
}
.stepper {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0 4px;
}
.stepper button {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid var(--bg3);
  background: var(--bg3);
  color: #fff;
  font: 700 17px 'DM Sans';
  cursor: pointer;
}
.stepper b {
  min-width: 22px;
  text-align: center;
  font: 800 20px Fraunces, serif;
  color: var(--gold);
}
</style>
