import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from '@/App.vue';
import StartPage from '@/pages/StartPage.vue';
import LocalGamePage from '@/pages/LocalGamePage.vue';
import RoomPage from '@/pages/RoomPage.vue';
import '@/assets/css/style.css';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: StartPage },
    { path: '/game', component: LocalGamePage },
    { path: '/room/:roomId', component: RoomPage },
  ],
});

createApp(App).use(router).mount('#app');
