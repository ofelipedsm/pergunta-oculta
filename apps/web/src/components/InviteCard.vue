<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import QRCode from 'qrcode'

/** Convite da sala: código, link para copiar, WhatsApp, compartilhar e QR code. */
const props = defineProps<{ code: string }>()

const link = computed(() => `${location.origin}/sala/${props.code}`)
const message = computed(() => `Bora jogar Pergunta Oculta? Entra na sala ${props.code}: ${link.value}`)
const whatsapp = computed(() => `https://wa.me/?text=${encodeURIComponent(message.value)}`)
const canShare = typeof navigator !== 'undefined' && 'share' in navigator

const copied = ref(false)
const showQr = ref(false)
const qrSvg = ref('')

watch(
  [showQr, link],
  async ([show, url]) => {
    if (!show || !url) return
    qrSvg.value = await QRCode.toString(url, {
      type: 'svg',
      margin: 4, // zona de silêncio padrão: câmeras leem melhor
      errorCorrectionLevel: 'M',
      color: { dark: '#1b1f3a', light: '#f6efe2' },
    })
  },
  { immediate: true },
)

/** Copia com a API moderna e, se ela não existir (http, navegador antigo), pelo jeito antigo. */
async function copy() {
  try {
    await navigator.clipboard.writeText(link.value)
  } catch {
    const el = document.createElement('textarea')
    el.value = link.value
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    el.remove()
  }
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}

async function share() {
  try {
    await navigator.share({ title: 'Pergunta Oculta', text: message.value, url: link.value })
  } catch {
    /* cancelado pelo usuário */
  }
}
</script>

<template>
  <section class="panel invite" data-test="invite">
    <p class="hint">Código da sala</p>
    <div class="code" data-test="room-code">{{ code }}</div>

    <div class="link-row">
      <input class="textin link" :value="link" readonly aria-label="Link da sala" @focus="($event.target as HTMLInputElement).select()" />
      <button class="btn small" data-test="copy-link" @click="copy">{{ copied ? 'Copiado!' : 'Copiar' }}</button>
    </div>

    <div class="actions">
      <a class="btn wa" :href="whatsapp" target="_blank" rel="noopener" data-test="whatsapp">WhatsApp</a>
      <button v-if="canShare" class="btn ghost" @click="share">Compartilhar…</button>
      <button class="btn ghost" data-test="toggle-qr" @click="showQr = !showQr">
        {{ showQr ? 'Esconder QR code' : 'QR code' }}
      </button>
    </div>

    <div v-if="showQr && qrSvg" class="qr" data-test="qr">
      <!-- SVG gerado localmente pela biblioteca qrcode a partir do link da sala -->
      <div class="qr-img" v-html="qrSvg" />
      <p class="hint">Aponte a câmera do celular para entrar na sala.</p>
    </div>
  </section>
</template>

<style scoped>
.invite {
  text-align: center;
}
.invite > .hint {
  margin: 0;
}
.code {
  font: 800 44px Fraunces, serif;
  letter-spacing: 8px;
  color: var(--gold);
  margin: 4px 0 12px;
}
.link-row {
  display: flex;
  gap: 8px;
}
.link {
  flex: 1;
  font-size: 14px;
  color: var(--muted);
  text-overflow: ellipsis;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 10px;
}
.actions .btn {
  flex: 1 1 120px;
  text-decoration: none;
  font-size: 14px;
  padding: 10px 14px;
}
.wa {
  background: #25d366;
  color: #0b2b17;
}
.qr {
  margin-top: 14px;
}
.qr-img {
  width: min(240px, 70vw);
  margin: 0 auto;
  border-radius: 12px;
  overflow: hidden;
}
.qr-img :deep(svg) {
  display: block;
  width: 100%;
  height: auto;
}
</style>
