<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import GameBoard from '@/components/GameBoard.vue';
import {
  countAlive,
  getPieceAt,
  getPieceMoves,
  PIECE_TYPES,
  type GameState,
  type Owner,
} from '@/game/rules';
import type { RoomState, SerializedPiece, ServerMessage } from '@/network/protocol';

const route = useRoute();
const router = useRouter();
const roomIdInput = ref(
  typeof route.params.roomId === 'string' && route.params.roomId !== 'new'
    ? route.params.roomId
    : '',
);
const catOnly = ref(route.query.catOnly !== 'false');
const roomState = ref<RoomState | null>(null);
const state = ref<GameState | null>(null);
const playerId = ref<0 | 1 | null>(null);
const roomError = ref('');
const firstTurnResult = ref('');
const copyFeedback = ref('');
const undoPending = ref(false);
const incomingUndo = ref(false);
const restartPending = ref(false);
const gameVersion = ref(0);
let socket: WebSocket | null = null;

const isPlaying = computed(
  () =>
    !!state.value &&
    (roomState.value?.status === 'playing' || roomState.value?.status === 'finished'),
);
const humanTurn = computed(
  () => !!state.value && playerId.value === state.value.currentPlayerId,
);
const turnText = computed(() => {
  if (!state.value) return '';

  const id = state.value.currentPlayerId;
  const owner = state.value.playerOwners[id];
  return `${playerId.value === id ? '你' : '对手'}（${owner == null ? '未确定' : owner === 1 ? '红方' : '蓝方'}）行棋`;
});
const actionHint = computed(() =>
  state.value?.playerOwners[state.value.currentPlayerId] == null
    ? `阵营未确定：翻开一张牌（${state.value?.catOnlyCanCaptureRat ? '只有猫能吃鼠' : '除象外都能吃鼠'}）`
    : '可翻未知牌或移动己方棋子；豹可斜飞，同级相撞对死',
);

function image(type: string): string {
  return `/animal/emojione--${type === 'lion' ? 'lion-face' : type}.svg`;
}

function hydratePiece(piece: SerializedPiece | null, id: string): GameState['board'][number][number] {
  if (!piece) return null;
  if ('id' in piece) return { ...piece };
  return { id, owner: 1, type: 'rat', rank: 1, revealed: false };
}

function hydrate(room: RoomState): void {
  if (!room.gameState) {
    state.value = null;
    return;
  }

  const remote = room.gameState;
  const board = remote.board.cells.map((row, r) =>
    row.map((piece, c) => hydratePiece(piece, `hidden-${r}-${c}`)),
  ) as GameState['board'];
  board.camp = hydratePiece(remote.board.camp, 'hidden-camp');
  board.catOnlyCanCaptureRat = remote.board.catOnlyCanCaptureRat;
  gameVersion.value++;
  state.value = {
    ...remote,
    board,
    history: [],
    selected: null,
    validMoves: [],
  };
}

function send(message: object): void {
  if (socket?.readyState !== WebSocket.OPEN) {
    roomError.value = '联机服务端连接已断开';
    return;
  }

  socket.send(JSON.stringify(message));
}

function handleRoomState(room: RoomState): void {
  roomState.value = room;
  playerId.value = room.playerId;

  if (room.playerCount === 2 && roomError.value === '另一位玩家已离开') {
    roomError.value = '';
  }
  if (room.status === 'waiting' || room.status === 'ready' || room.status === 'guessing') {
    firstTurnResult.value = '';
  }
  if (room.status === 'guessing') {
    roomError.value = '';
  }

  hydrate(room);
}

function handleMessage(message: ServerMessage): void {
  if (message.type === 'room_created' || message.type === 'room_joined') {
    playerId.value = message.playerId;
    roomIdInput.value = message.roomId;

    if (message.type === 'room_created' && route.params.roomId === 'new') {
      void router.replace(`/room/${message.roomId}`);
    }
    return;
  }

  if (message.type === 'room_state' || message.type === 'game_started') {
    handleRoomState(message.state);
    return;
  }

  if (message.type === 'first_turn_result') {
    const outcome = message.outcome === 'heads' ? '正面' : '反面';
    if (message.winnerPlayerId === null) {
      firstTurnResult.value = `结果为${outcome}，本轮无人胜出，请重新猜先`;
    } else if (message.winnerPlayerId === playerId.value) {
      firstTurnResult.value = `结果为${outcome}，你猜先获胜，由你先走`;
    } else {
      firstTurnResult.value = `结果为${outcome}，对手猜先获胜，由对手先走`;
    }
    return;
  }

  if (message.type === 'undo_requested') {
    incomingUndo.value = true;
    return;
  }

  if (message.type === 'undo_result') {
    undoPending.value = false;
    incomingUndo.value = false;
    roomError.value = message.accepted ? '对手已同意悔棋' : '对手已拒绝悔棋';
    return;
  }

  if (message.type === 'error') {
    roomError.value = message.message;
    undoPending.value = false;
    return;
  }

  firstTurnResult.value = '';
  undoPending.value = false;
  incomingUndo.value = false;
  state.value = null;
  roomError.value = '另一位玩家已离开';
}

function connect(type: 'create_room' | 'join_room'): void {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const address = import.meta.env.VITE_WEBSOCKET_URL || `${protocol}//${location.hostname}:3000`;
  socket = new WebSocket(address);
  socket.onopen = () =>
    send(
      type === 'create_room'
        ? { type, catOnlyCanCaptureRat: catOnly.value }
        : { type, roomId: roomIdInput.value },
    );
  socket.onmessage = (event) => {
    handleMessage(JSON.parse(event.data) as ServerMessage);
  };
  socket.onerror = () => {
    roomError.value = '无法连接联机服务端';
  };
}

function clickCell(r: number, c: number): void {
  if (!state.value || !humanTurn.value || state.value.gameOver) return;

  const piece = getPieceAt(state.value.board, { r, c });
  if (state.value.selected) {
    const move = state.value.validMoves.find((item) => item.to.r === r && item.to.c === c);
    if (move) {
      send({ type: 'action', action: move });
      state.value.selected = null;
      state.value.validMoves = [];
      return;
    }
    if (piece?.revealed && piece.owner === state.value.playerOwners[state.value.currentPlayerId]) {
      select(r, c);
      return;
    }
    state.value.selected = null;
    state.value.validMoves = [];
    return;
  }

  if (piece && !piece.revealed) {
    send({ type: 'action', action: { type: 'reveal', r, c, piece } });
  } else if (piece?.revealed) {
    select(r, c);
  }
}

function select(r: number, c: number): void {
  if (!state.value) return;

  const owner = state.value.playerOwners[state.value.currentPlayerId];
  const piece = getPieceAt(state.value.board, { r, c });
  if (piece?.revealed && owner != null && piece.owner === owner) {
    state.value.selected = { r, c };
    state.value.validMoves = getPieceMoves(state.value.board, r, c, owner);
  }
}

function leave(): void {
  const currentSocket = socket;
  socket = null;
  if (currentSocket?.readyState === WebSocket.OPEN) {
    currentSocket.send(JSON.stringify({ type: 'leave_room' }));
  }
  currentSocket?.close();
  void router.push('/');
}

async function copy(): Promise<void> {
  const value = roomIdInput.value;
  if (!value) return;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const input = document.createElement('textarea');
      input.value = value;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      const copied = document.execCommand('copy');
      input.remove();
      if (!copied) throw new Error('copy failed');
    }
    copyFeedback.value = '已复制';
  } catch {
    copyFeedback.value = '复制失败，请手动复制';
  }

  window.setTimeout(() => {
    copyFeedback.value = '';
  }, 2000);
}

function alive(owner: Owner): number {
  return state.value ? countAlive(state.value.board, owner) : 8;
}

function start(): void {
  send({ type: 'start_game' });
}

function guess(guessValue: 'heads' | 'tails'): void {
  if (!roomState.value?.guessSubmitted) {
    firstTurnResult.value = '';
    send({ type: 'guess_first_turn', guess: guessValue });
  }
}

function restart(): void {
  if (playerId.value === 0) restartPending.value = true;
}

function confirmRestart(): void {
  restartPending.value = false;
  roomError.value = '';
  firstTurnResult.value = '';
  undoPending.value = false;
  incomingUndo.value = false;
  state.value = null;
  send({ type: 'restart_game' });
}

function undo(): void {
  undoPending.value = true;
  send({ type: 'request_undo' });
}

function respond(accepted: boolean): void {
  send({ type: 'respond_undo', accepted });
}

onMounted(() => connect(route.params.roomId === 'new' ? 'create_room' : 'join_room'));

onBeforeUnmount(() => {
  const currentSocket = socket;
  socket = null;
  if (currentSocket?.readyState === WebSocket.OPEN) {
    currentSocket.send(JSON.stringify({ type: 'leave_room' }));
  }
  currentSocket?.close();
});
</script>

<template>
  <div v-if="!isPlaying" class="overlay">
    <div class="card start-card">
      <h1 class="title">暗兽棋</h1>
      <p class="subtitle">联机房间</p>
      <div class="room-status">
        <p class="room-id-line">
          <span>房间号：<b>{{ roomIdInput || '连接中' }}</b></span>
          <button
            v-if="roomIdInput"
            class="copy-room-btn"
            type="button"
            aria-label="复制房间号"
            title="复制房间号"
            @click="copy"
          >
            <span class="copy-room-icon" aria-hidden="true"></span>
          </button>
          <span v-if="copyFeedback" class="copy-room-feedback">{{ copyFeedback }}</span>
        </p>
        <p v-if="roomState">{{ roomState.playerCount }}/2 位玩家已进入</p>
        <button
          v-if="roomState?.status === 'ready' && playerId === 0"
          class="btn btn-primary"
          @click="start"
        >
          开始对局
        </button>
        <template v-else-if="roomState?.status === 'guessing'">
          <p>猜先第 {{ roomState.guessRound }} 轮</p>
          <div class="guess-actions">
            <button class="btn" :disabled="roomState.guessSubmitted" @click="guess('heads')">
              猜正面
            </button>
            <button class="btn" :disabled="roomState.guessSubmitted" @click="guess('tails')">
              猜反面
            </button>
          </div>
          <p v-if="roomState.guessSubmitted">已提交，等待对手选择</p>
          <p v-else-if="roomState.opponentGuessSubmitted">对手已提交，请选择</p>
          <p v-if="firstTurnResult" class="room-error">{{ firstTurnResult }}</p>
        </template>
        <p v-else>
          {{
            roomState?.status === 'waiting'
              ? '等待另一位玩家加入'
              : roomState
                ? '等待房主开始对局'
                : '正在连接联机服务端'
          }}
        </p>
        <button class="btn" @click="leave">退出房间</button>
      </div>
      <p v-if="roomError" class="room-error">{{ roomError }}</p>
    </div>
  </div>

  <main v-else class="game-screen">
    <GameBoard :state="state!" :game-version="gameVersion" @cell="clickCell" />
    <aside class="panel">
      <h2 class="panel-title">暗兽棋</h2>
      <div class="turn-info">
        <span
          class="turn-dot"
          :class="
            state!.playerOwners[state!.currentPlayerId] === 1
              ? 'red'
              : state!.playerOwners[state!.currentPlayerId] === 2
                ? 'black'
                : 'neutral'
          "
        ></span>
        <span>{{ turnText }}</span>
      </div>
      <div class="move-count">第 {{ state!.turnCount + 1 }} 手</div>
      <div class="action-hint">{{ actionHint }}</div>
      <p v-if="roomError" class="room-error">{{ roomError }}</p>
      <div class="captured-section">
        <div v-for="owner in [2, 1] as Owner[]" :key="owner" class="captured-block">
          <div class="captured-label">
            <span>
              <i class="loss-dot" :class="owner === 1 ? 'red' : 'black'"></i>
              {{ owner === 1 ? '红方' : '蓝方' }}损失
            </span>
          </div>
          <div class="captured-list">
            <span
              v-for="piece in state!.captured[owner]"
              :key="piece.id"
              class="cap-piece"
              :class="owner === 1 ? 'red' : 'black'"
            >
              <img :src="image(piece.type)" :alt="PIECE_TYPES[piece.type].char" />
            </span>
          </div>
          <div class="alive-count">存活 {{ alive(owner) }}</div>
        </div>
      </div>
      <div class="btn-group">
        <button
          class="btn"
          :disabled="undoPending || incomingUndo || state!.gameOver"
          @click="undo"
        >
          请求悔棋
        </button>
        <button v-if="playerId === 0" class="btn" @click="restart">重开</button>
        <button class="btn" @click="leave">退出房间</button>
      </div>
    </aside>
  </main>

  <div v-if="incomingUndo" class="overlay undo-overlay">
    <div class="card undo-card">
      <span class="undo-mark" aria-hidden="true"></span>
      <h2>对手请求悔棋</h2>
      <p>是否同意撤销对手的上一手棋？</p>
      <div class="undo-actions">
        <button class="btn btn-primary" @click="respond(true)">同意悔棋</button>
        <button class="btn" @click="respond(false)">暂不接受</button>
      </div>
    </div>
  </div>

  <div v-if="restartPending" class="overlay undo-overlay">
    <div class="card undo-card">
      <span class="undo-mark" aria-hidden="true"></span>
      <h2>确认重新开始</h2>
      <p>当前对局进度将被清除，确定要重新开始吗？</p>
      <div class="undo-actions">
        <button class="btn btn-primary" @click="confirmRestart">确认重开</button>
        <button class="btn" @click="restartPending = false">取消</button>
      </div>
    </div>
  </div>

  <div v-if="roomState?.status === 'finished' && state" class="overlay">
    <div class="card over-card">
      <h2 class="winner-text" :class="state.winner === 1 ? 'red' : 'black'">
        {{ state.winner === 1 ? '红方胜' : '蓝方胜' }}
      </h2>
      <div class="btn-group">
        <button class="btn btn-primary" @click="restart">再来一局</button>
        <button class="btn" @click="leave">返回菜单</button>
      </div>
    </div>
  </div>
</template>
