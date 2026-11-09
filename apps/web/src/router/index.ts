import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    // Fase 3: lobby, jogo e fim de jogo ficam dentro desta rota.
    { path: '/sala/:code', name: 'room', component: () => import('../views/RoomView.vue') },
  ],
})

export default router
