<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const mode = ref<'pvp' | 'pve' | 'lan'>('pvp');
const catOnly = ref(true);
const difficulty = ref(2);
const roomId = ref('');
const error = ref('');

watch(mode, () => {
  error.value = '';
});

function startGame(): void {
  router.push({ path: '/game', query: { mode: mode.value, catOnly: String(catOnly.value), difficulty: String(difficulty.value) } });
}
function createRoom(): void {
  router.push({ path: '/room/new', query: { catOnly: String(catOnly.value) } });
}
function joinRoom(): void {
  error.value = '';
  if (roomId.value.trim().length !== 6) { error.value = '请输入 6 位房间号'; return; }
  router.push(`/room/${roomId.value.trim()}`);
}
</script>

<template>
  <div class="overlay">
    <div class="card start-card">
      <h1 class="title">暗兽棋</h1>
      <p class="subtitle">翻牌暗战 · 丛林对决</p>
      <div class="option-group">
        <div class="option-label"><span class="option-label-icon icon-aiming" aria-hidden="true"></span>对战模式</div>
        <div class="options">
          <label class="radio"><input v-model="mode" type="radio" value="pvp">本地双人对战</label>
          <label class="radio"><input v-model="mode" type="radio" value="pve">人机对战</label>
          <label class="radio"><input v-model="mode" type="radio" value="lan">局域网联机</label>
        </div>
      </div>
      <div v-if="mode === 'lan'" class="option-group lan-options">
        <div class="option-label"><span class="option-label-icon icon-airdrop" aria-hidden="true"></span>局域网房间</div>
        <p class="lan-note">请先在一台电脑上启动联机服务端。</p>
        <div class="lan-actions">
          <button class="btn" @click="createRoom">创建房间</button>
          <div class="join-row">
            <div class="room-input-wrap">
              <input v-model="roomId" class="room-input" maxlength="6" inputmode="numeric" placeholder="输入 6 位房间号">
              <button v-if="roomId" class="clear-room-input" type="button" aria-label="清空房间号" title="清空房间号" @click="roomId = ''">×</button>
            </div>
            <button class="btn" @click="joinRoom">加入房间</button>
          </div>
        </div>
        <p v-if="error" class="room-error">{{ error }}</p>
      </div>
      <div class="option-group">
        <div class="option-label"><span class="option-label-icon icon-cookie" aria-hidden="true"></span>吃鼠规则</div>
        <div class="options">
          <label class="radio"><input v-model="catOnly" type="radio" :value="true">只有猫能吃鼠</label>
          <label class="radio"><input v-model="catOnly" type="radio" :value="false">除象外都能吃鼠</label>
        </div>
      </div>
      <div v-if="mode === 'pve'" class="option-group">
        <div class="option-label"><span class="option-label-icon icon-ai" aria-hidden="true"></span>AI 难度</div>
        <div class="options">
          <label v-for="level in [1, 2, 3]" :key="level" class="radio"><input v-model="difficulty" type="radio" :value="level">{{ level === 1 ? '简单' : level === 2 ? '中等' : '困难' }}</label>
        </div>
      </div>
      <button v-if="mode !== 'lan'" class="btn btn-primary" @click="startGame">开始对局</button>
      <details class="rules"><summary>查看游戏规则</summary><div class="rules-content"><p><b>棋具</b>：4 × 4 交叉点，共 16 子；中央方格内是独立公共大本营。</p><p><b>走法</b>：普通棋子上下左右一格，豹可八方向斜飞。</p><p><b>吃子</b>：等级制，鼠能吃象，同级相撞双方对死。</p><p><b>大本营</b>：一次最多容纳一子，营内棋子受外围敌棋保护。</p></div></details>
    </div>
  </div>
</template>
