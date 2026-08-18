<script setup lang="ts">
// 导入 Vue 响应式 API。
import { computed, ref } from 'vue';
import type { RoomState, ServerMessage } from '@/network/protocol';

// 导入规则函数、常量和状态类型。
import {
  afterAction,
  applyAction,
  countAlive,
  createState,
  getPieceAt,
  getPieceMoves,
  getLastSameTypeTieWinner,
  PIECE_TYPES,
  revertAction,
  type Action,
  type GameState,
  type MoveAction,
  type Owner,
  type Board,
  type Piece,
} from '@/game/rules';

// 导入 AI 动作选择函数。
import { findBestMove } from '@/game/ai';

// 返回动物图标图片地址。
function classicPieceImage(type: string): string {
  const iconName = type === 'lion' ? 'lion-face' : type;
  return `/animal/emojione--${iconName}.svg`;
}

// 保存菜单中的对战模式、吃鼠规则和 AI 难度。
const mode = ref<'pvp' | 'pve' | 'lan'>('pvp');
const catOnly = ref(true);
const roomIdInput = ref('');
const roomState = ref<RoomState | null>(null);
const roomError = ref('');
const playerId = ref<0 | 1 | null>(null);
const undoRequestPending = ref(false);
const incomingUndoRequest = ref(false);
const restartConfirmPending = ref(false);
let socket: WebSocket | null = null;
const difficulty = ref(2);

// 保存当前游戏状态。
const state = ref<GameState | null>(null);
const gameVersion = ref(0);

// 保存动画和 AI 思考状态。
const animating = ref(false);
const aiThinking = ref(false);

// 根据菜单配置开始一局新游戏。
function startGame(): void {
  state.value = createState(mode.value === 'pve' ? 'pve' : 'pvp', 1, difficulty.value, catOnly.value);
  animating.value = false;
  aiThinking.value = false;
  if (state.value.mode === 'pve' && state.value.currentPlayerId === state.value.aiPlayerId) {
    triggerAI();
  }
}

// 返回开始菜单并清理 AI 状态。
function menu(): void {
  closeRoomConnection();
  state.value = null;
  roomState.value = null;
  playerId.value = null;
  roomError.value = '';
  undoRequestPending.value = false;
  incomingUndoRequest.value = false;
  restartConfirmPending.value = false;
  aiThinking.value = false;
}

// 通知服务端离开房间并关闭当前连接。
function closeRoomConnection(): void {
  if (!socket) {
    return;
  }
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'leave_room' }));
  }
  socket.close();
  socket = null;
}

// 主动退出联机房间并回到菜单。
function leaveRoom(): void {
  menu();
}

// 按当前规则重新开始游戏。
function restart(): void {
  if (mode.value === 'lan') {
    if (playerId.value !== 0) {
      return;
    }
    restartConfirmPending.value = true;
    return;
  }
  restartLocalGame();
}

// 结算后直接开始下一局。
function playAgain(): void {
  if (mode.value === 'lan') {
    if (playerId.value !== 0) {
      return;
    }
    confirmNetworkRestart();
    return;
  }
  restartLocalGame();
}

// 在确认后重开联机对局。
function confirmNetworkRestart(): void {
  restartConfirmPending.value = false;
  if (socket?.readyState !== WebSocket.OPEN) {
    roomError.value = '联机服务端连接已断开';
    return;
  }
  socket.send(JSON.stringify({ type: 'restart_game' }));
}

// 重开本地对局。
function restartLocalGame(): void {
  if (state.value) {
    const current = state.value;
    gameVersion.value += 1;
    state.value = createState(
      current.mode,
      current.aiPlayerId,
      current.aiDepth,
      current.catOnlyCanCaptureRat,
    );
    if (state.value.mode === 'pve' && state.value.currentPlayerId === state.value.aiPlayerId) {
      triggerAI();
    }
  }
}

// 判断当前是否轮到人类操作。
const humanTurn = computed(() => {
  if (!state.value) {
    return false;
  }
  if (mode.value === 'lan') {
    return playerId.value === state.value.currentPlayerId;
  }
  return state.value.mode === 'pvp' || state.value.currentPlayerId !== state.value.aiPlayerId;
});

// 生成当前回合的玩家和阵营说明。
const turnText = computed(() => {
  if (!state.value) {
    return '';
  }
  const id = state.value.currentPlayerId;
  const owner = state.value.playerOwners[id];
  const player =
    state.value.mode === 'pvp'
      ? `玩家${id + 1}`
      : id === state.value.aiPlayerId
        ? 'AI'
        : '你';
  return `${player}（${owner == null ? '未确定' : owner === 1 ? '红方' : '蓝方'}）行棋`;
});

// 生成当前操作提示。
const actionHint = computed(() =>
  state.value?.playerOwners[state.value.currentPlayerId] == null
    ? `阵营未确定：翻开一张牌（${catOnly.value ? '只有猫能吃鼠' : '除象外都能吃鼠'}）`
    : '可翻未知牌或移动己方棋子；豹可斜飞，同级相撞对死',
);

// 读取棋盘指定位置的棋子。
function pieceAt(r: number, c: number): Piece | null {
  if (!state.value) {
    return null;
  }
  return getPieceAt(state.value.board, { r, c });
}

// 选择己方棋子并计算合法移动提示。
function select(r: number, c: number): void {
  if (!state.value || !humanTurn.value || animating.value || aiThinking.value) {
    return;
  }
  const piece = pieceAt(r, c);
  const owner = state.value.playerOwners[state.value.currentPlayerId];
  if (!piece || !piece.revealed || owner == null || piece.owner !== owner) {
    return;
  }
  state.value.selected = { r, c };
  state.value.validMoves = getPieceMoves(state.value.board, r, c, owner);
}

// 查找指定目标位置对应的移动动作。
function moveAt(r: number, c: number): MoveAction | undefined {
  return state.value?.validMoves.find((move) => move.to.r === r && move.to.c === c);
}

// 处理棋盘格点击，区分翻牌、选子和移动。
function clickCell(r: number, c: number): void {
  if (!state.value || !humanTurn.value || animating.value || state.value.gameOver) {
    return;
  }
  const selected = state.value.selected;
  const piece = pieceAt(r, c);
  if (selected) {
    const move = moveAt(r, c);
    if (move) {
      execute(move);
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
    execute({ type: 'reveal', r, c, piece });
  } else if (piece?.revealed) {
    select(r, c);
  }
}

// 将联机动作交由服务端校验和执行。
function sendNetworkAction(action: Action): void {
  if (socket?.readyState !== WebSocket.OPEN) {
    roomError.value = '联机服务端连接已断开';
    return;
  }
  socket.send(JSON.stringify({ type: 'action', action }));
}

/*
 * 向对手发起悔棋请求，等待服务端转发的处理结果。
 */
function requestNetworkUndo(): void {
  if (socket?.readyState !== WebSocket.OPEN) {
    roomError.value = '联机服务端连接已断开';
    return;
  }
  undoRequestPending.value = true;
  socket.send(JSON.stringify({ type: 'request_undo' }));
}

/*
 * 回应对手的悔棋请求，由服务端执行实际回退。
 */
function respondNetworkUndo(accepted: boolean): void {
  if (socket?.readyState !== WebSocket.OPEN) {
    roomError.value = '联机服务端连接已断开';
    return;
  }
  socket.send(JSON.stringify({ type: 'respond_undo', accepted }));
}

// 执行动作、记录历史并安排下一回合。
function execute(action: Action): void {
  if (!state.value) {
    return;
  }
  if (mode.value === 'lan') {
    state.value.selected = null;
    state.value.validMoves = [];
    sendNetworkAction(action);
    return;
  }
  const game = state.value;
  const previous = { ...game.playerOwners } as [Owner | null, Owner | null];
  const tieWinner = getLastSameTypeTieWinner(game.board, action);
  const context = applyAction(game.board, action);
  const captured: { piece: Piece; owner: Owner }[] = [];

  // 记录被吃棋子，供面板显示和悔棋恢复。
  if (action.type === 'move' && context.info.type === 'move' && context.info.target) {
    captured.push({ piece: context.info.target, owner: context.info.target.owner });
    if (action.outcome === 'tie') {
      captured.push({ piece: context.info.mover, owner: context.info.mover.owner });
    }
    for (const item of captured) {
      game.captured[item.owner].push({ ...item.piece });
    }
  }

  // 保存动作前的状态信息。
  const entry = {
    action,
    revertCtx: context,
    prevPlayerId: game.currentPlayerId,
    prevPlayerOwners: previous,
    prevTurn: game.turnCount,
    captured,
    prevLastRevealedOwner: game.lastRevealedOwner,
  };
  game.selected = null;
  game.validMoves = [];
  afterAction(game, action, tieWinner);
  game.history.push(entry);

  // 使用原有延迟播放动作动画并触发 AI。
  animating.value = true;
  window.setTimeout(() => {
    animating.value = false;
    if (state.value?.gameOver) {
      return;
    }
    if (state.value?.mode === 'pve' && state.value.currentPlayerId === state.value.aiPlayerId) {
      triggerAI();
    }
  }, action.type === 'reveal' ? 560 : 360);
}

// 请求 AI 选择并执行动作。
async function triggerAI(): Promise<void> {
  if (!state.value || state.value.gameOver) {
    return;
  }
  aiThinking.value = true;
  const action = await findBestMove(state.value);
  aiThinking.value = false;
  if (action) {
    execute(action);
  } else {
    state.value.gameOver = true;
    state.value.winner = (3 - (state.value.playerOwners[state.value.aiPlayerId] || 1)) as Owner;
  }
}

// 撤销最近的一步，PVE 模式下同时撤销双方动作。
function undo(): void {
  if (mode.value === 'lan') {
    return;
  }
  if (!state.value || animating.value || aiThinking.value || !state.value.history.length) {
    return;
  }
  if (state.value.mode === 'pve' && state.value.currentPlayerId === state.value.aiPlayerId && !state.value.gameOver) {
    return;
  }
  state.value.gameOver = false;
  state.value.winner = null;
  const steps = state.value.mode === 'pve' && state.value.history.length > 1 ? 2 : 1;

  // 逐步回退棋盘、吃子记录和回合信息。
  for (let i = 0; i < steps && state.value.history.length; i++) {
    const entry = state.value.history.pop()!;
    revertAction(state.value.board, entry.revertCtx);
    for (const item of entry.captured) {
      const list = state.value.captured[item.owner];
      const index = list.findIndex((piece) => piece.id === item.piece.id);
      if (index >= 0) {
        list.splice(index, 1);
      }
    }
    state.value.playerOwners = entry.prevPlayerOwners;
    state.value.currentPlayerId = entry.prevPlayerId;
    state.value.turnCount = entry.prevTurn;
    state.value.lastRevealedOwner = entry.prevLastRevealedOwner;
  }
  state.value.selected = null;
  state.value.validMoves = [];
}

function hydrate(room: RoomState): void {
  if (!room.gameState) return;
  const remote = room.gameState;
  const board = remote.board.cells.map((row) => row.map((piece) => (piece ? { ...piece } : null))) as Board;
  board.camp = remote.board.camp ? { ...remote.board.camp } : null;
  board.catOnlyCanCaptureRat = remote.board.catOnlyCanCaptureRat;
  gameVersion.value += 1;
  state.value = {
    ...remote,
    board,
    history: [],
    selected: null,
    validMoves: [],
  };
}

function connectRoom(type: 'create_room' | 'join_room'): void {
  roomError.value = '';
  undoRequestPending.value = false;
  incomingUndoRequest.value = false;
  socket?.close();
  socket = new WebSocket(`ws://${location.hostname}:3000`);
  socket.onopen = () => {
    const message = type === 'create_room'
      ? { type, catOnlyCanCaptureRat: catOnly.value }
      : { type, roomId: roomIdInput.value.trim() };
    socket?.send(JSON.stringify(message));
  };
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data) as ServerMessage;
    if (message.type === 'room_created' || message.type === 'room_joined') {
      playerId.value = message.playerId;
      roomIdInput.value = message.roomId;
    } else if (message.type === 'room_state' || message.type === 'game_started') {
      roomState.value = message.state;
      undoRequestPending.value = false;
      incomingUndoRequest.value = false;
      hydrate(message.state);
    } else if (message.type === 'undo_requested') {
      incomingUndoRequest.value = true;
    } else if (message.type === 'undo_result') {
      undoRequestPending.value = false;
      incomingUndoRequest.value = false;
      roomError.value = message.accepted ? '对手已同意悔棋' : '对手已拒绝悔棋';
    } else if (message.type === 'error') {
      roomError.value = message.message;
      undoRequestPending.value = false;
    } else if (message.type === 'player_left') {
      roomError.value = '另一位玩家已离开';
      undoRequestPending.value = false;
      incomingUndoRequest.value = false;
      state.value = null;
    }
  };
  socket.onerror = () => { roomError.value = '无法连接联机服务端'; };
}

function joinRoom(): void {
  if (roomIdInput.value.trim().length === 6) connectRoom('join_room');
  else roomError.value = '请输入 6 位房间号';
}

// 清空待加入的房间号和关联错误提示。
function clearRoomId(): void {
  roomIdInput.value = '';
  roomError.value = '';
}

// 由房主向服务端发送开始联机对局请求。
function startNetworkGame(): void {
  if (socket?.readyState !== WebSocket.OPEN) {
    roomError.value = '联机服务端连接已断开';
    return;
  }
  socket.send(JSON.stringify({ type: 'start_game' }));
}

// 判断某个位置是否为当前移动提示点。
function isHint(r: number, c: number): boolean {
  return !!moveAt(r, c);
}

// 计算棋子在棋盘上的 CSS 坐标变量。
function positionStyle(r: number, c: number): Record<string, string> {
  return { '--r': String(r), '--c': String(c) };
}

// 统计指定阵营的存活棋子数。
function alive(owner: Owner): number {
  return state.value ? countAlive(state.value.board, owner) : 8;
}
</script>

<template>
  <!-- 开始界面与规则选择。 -->
  <div v-if="!state" class="overlay">
    <div class="card start-card">
      <h1 class="title">暗兽棋</h1>
      <p class="subtitle">翻牌暗战 · 丛林对决</p>

      <!-- 对战模式选择。 -->
      <div class="option-group">
        <div class="option-label">
          <span class="option-label-icon icon-aiming" aria-hidden="true"></span>
          对战模式
        </div>
        <div class="options">
          <label class="radio"><input v-model="mode" type="radio" value="pvp">本地双人对战</label>
          <label class="radio"><input v-model="mode" type="radio" value="pve">人机对战</label>
          <label class="radio"><input v-model="mode" type="radio" value="lan">局域网联机</label>
        </div>
      </div>

      <!-- 局域网房间操作。 -->
      <div v-if="mode === 'lan'" class="option-group lan-options">
        <div class="option-label">
          <span class="option-label-icon icon-airdrop" aria-hidden="true"></span>
          局域网房间
        </div>
        <p class="lan-note">请先在一台电脑上启动联机服务端。</p>
        <div v-if="!roomState" class="lan-actions">
          <button class="btn" @click="connectRoom('create_room')">创建房间</button>
          <div class="join-row">
            <div class="room-input-wrap">
              <input v-model="roomIdInput" class="room-input" maxlength="6" inputmode="numeric" placeholder="输入 6 位房间号">
              <button v-if="roomIdInput" class="clear-room-input" type="button" aria-label="清空房间号" title="清空房间号" @click="clearRoomId">×</button>
            </div>
            <button class="btn" @click="joinRoom">加入房间</button>
          </div>
        </div>
        <div v-else class="room-status">
          <p>房间号：<b>{{ roomIdInput }}</b></p>
          <p>{{ roomState.playerCount }}/2 位玩家已进入</p>
          <button v-if="roomState.status === 'ready' && playerId === 0" class="btn btn-primary" @click="startNetworkGame">开始对局</button>
          <p v-else>等待{{ roomState.status === 'waiting' ? '另一位玩家加入' : '房主开始对局' }}</p>
          <button class="btn" @click="leaveRoom">退出房间</button>
        </div>
        <p v-if="roomError" class="room-error">{{ roomError }}</p>
      </div>

      <!-- 吃鼠规则选择，仅房主可以设置联机规则。 -->
      <div v-if="mode !== 'lan' || playerId !== 1" class="option-group">
        <div class="option-label">
          <span class="option-label-icon icon-cookie" aria-hidden="true"></span>
          吃鼠规则
        </div>
        <div class="options">
          <label class="radio"><input v-model="catOnly" type="radio" :value="true">只有猫能吃鼠</label>
          <label class="radio"><input v-model="catOnly" type="radio" :value="false">除象外都能吃鼠</label>
        </div>
      </div>

      <!-- AI 难度选择。 -->
      <div v-if="mode === 'pve'" class="option-group">
        <div class="option-label">
          <span class="option-label-icon icon-ai" aria-hidden="true"></span>
          AI 难度
        </div>
        <div class="options">
          <label v-for="level in [1, 2, 3]" :key="level" class="radio">
            <input v-model="difficulty" type="radio" :value="level">
            {{ level === 1 ? '简单' : level === 2 ? '中等' : '困难' }}
          </label>
        </div>
      </div>

      <!-- 本地模式开始游戏和规则说明。 -->
      <button v-if="mode !== 'lan'" class="btn btn-primary" @click="startGame">开始对局</button>
      <details class="rules">
        <summary>查看游戏规则</summary>
        <div class="rules-content">
          <p><b>棋具</b>：4 × 4 交叉点，共 16 子；中央方格内是独立公共大本营。</p>
          <p><b>走法</b>：普通棋子上下左右一格，豹可八方向斜飞。</p>
          <p><b>吃子</b>：等级制，鼠能吃象，同级相撞双方对死。</p>
          <p><b>大本营</b>：一次最多容纳一子，营内棋子受外围敌棋保护。</p>
        </div>
      </details>
    </div>
  </div>

  <!-- 游戏棋盘与信息面板。 -->
  <main v-else class="game-screen">
    <!-- 棋盘区域。 -->
    <div class="board-wrap">
      <div class="board-intersection">
        <!-- 普通棋盘交叉点。 -->
        <div v-for="r in 4" :key="`row-${r}`">
          <button
            v-for="c in 4"
            :key="`${r}-${c}`"
            class="dot"
            :style="positionStyle(r - 1, c - 1)"
            @click="clickCell(r - 1, c - 1)"
          />
        </div>

        <!-- 中央营位和营位棋子。 -->
        <div class="camp-box" @click="clickCell(1.5, 1.5)"></div>
        <div
          v-if="state.board.camp"
          :key="`camp-${gameVersion}-${state.board.camp.id}`"
          class="piece in-camp"
          :class="[
            `owner-${state.board.camp.owner}`,
            { flipped: state.board.camp.revealed, selected: state.selected?.camp },
          ]"
          :style="positionStyle(1.5, 1.5)"
          @click.stop="clickCell(1.5, 1.5)"
        >
          <div class="piece-inner">
            <div class="piece-face back"></div>
            <div class="piece-face front">
              <img class="piece-icon classic-icon" :src="classicPieceImage(state.board.camp.type)" :alt="PIECE_TYPES[state.board.camp.type].char">
              <span class="piece-name">{{ PIECE_TYPES[state.board.camp.type].char }}</span>
            </div>
          </div>
        </div>

        <!-- 当前棋子的可移动提示。 -->
        <span
          v-for="move in state.validMoves"
          :key="`hint-${move.to.r}-${move.to.c}`"
          class="hint"
          :class="move.outcome"
          :style="positionStyle(move.to.r, move.to.c)"
          @click.stop="clickCell(move.to.r, move.to.c)"
        ></span>

        <!-- 普通棋盘棋子。 -->
        <template v-for="(row, r) in state.board" :key="r">
          <template v-for="(piece, c) in row" :key="`${r}-${c}`">
            <div
              v-if="piece"
              :key="`piece-${gameVersion}-${piece.id}`"
              class="piece"
              :class="[
                `owner-${piece.owner}`,
                { flipped: piece.revealed, selected: state.selected?.r === r && state.selected?.c === c },
              ]"
              :style="positionStyle(r, c)"
              @click.stop="clickCell(r, c)"
            >
              <div class="piece-inner">
                <div class="piece-face back"></div>
                <div class="piece-face front">
                  <img class="piece-icon classic-icon" :src="classicPieceImage(piece.type)" :alt="PIECE_TYPES[piece.type].char">
                  <span class="piece-name">{{ PIECE_TYPES[piece.type].char }}</span>
                </div>
              </div>
            </div>
          </template>
        </template>
      </div>
    </div>

    <!-- 右侧回合、吃子和操作面板。 -->
    <aside class="panel">
      <h2 class="panel-title">暗兽棋</h2>
      <div class="turn-info">
        <span
          class="turn-dot"
          :class="state.playerOwners[state.currentPlayerId] === 1 ? 'red' : state.playerOwners[state.currentPlayerId] === 2 ? 'black' : 'neutral'"
        ></span>
        <span>{{ turnText }}</span>
      </div>
      <div class="move-count">第 {{ state.turnCount + 1 }} 手</div>
      <div class="action-hint">{{ actionHint }}</div>
      <p v-if="roomError && mode === 'lan'" class="room-error">{{ roomError }}</p>

      <!-- 双方损失与存活数量。 -->
      <div class="captured-section">
        <div v-for="owner in [2, 1] as Owner[]" :key="owner" class="captured-block">
          <div class="captured-label">
            <span><i class="loss-dot" :class="owner === 1 ? 'red' : 'black'"></i>{{ owner === 1 ? '红方' : '蓝方' }}损失</span>
          </div>
          <div class="captured-list">
            <span
              v-for="piece in state.captured[owner]"
              :key="piece.id"
              class="cap-piece"
              :class="owner === 1 ? 'red' : 'black'"
            ><img :src="classicPieceImage(piece.type)" :alt="PIECE_TYPES[piece.type].char"></span>
          </div>
          <div class="alive-count">存活 {{ alive(owner) }}</div>
        </div>
      </div>

      <!-- 游戏操作按钮。 -->
      <div class="btn-group">
        <button
          v-if="mode === 'lan'"
          class="btn"
          :disabled="undoRequestPending || incomingUndoRequest || state.gameOver"
          @click="requestNetworkUndo"
        >请求悔棋</button>
        <button v-else class="btn" @click="undo">悔棋</button>
        <button v-if="mode !== 'lan' || playerId === 0" class="btn" @click="restart">重开</button>
        <button v-if="mode === 'lan'" class="btn" @click="leaveRoom">退出房间</button>
        <button v-else class="btn" @click="menu">返回菜单</button>
      </div>
    </aside>
  </main>

  <!-- 对手悔棋确认。 -->
  <div v-if="incomingUndoRequest" class="overlay undo-overlay">
    <div class="card undo-card" role="dialog" aria-modal="true" aria-labelledby="undo-title">
      <span class="undo-mark" aria-hidden="true"></span>
      <h2 id="undo-title">对手请求悔棋</h2>
      <p>是否同意撤销对手的上一手棋？</p>
      <div class="undo-actions">
        <button class="btn btn-primary" @click="respondNetworkUndo(true)">同意悔棋</button>
        <button class="btn" @click="respondNetworkUndo(false)">暂不接受</button>
      </div>
    </div>
  </div>

  <!-- 房主重开确认。 -->
  <div v-if="restartConfirmPending" class="overlay undo-overlay">
    <div class="card undo-card" role="dialog" aria-modal="true" aria-labelledby="restart-title">
      <span class="undo-mark" aria-hidden="true"></span>
      <h2 id="restart-title">确认重新开始</h2>
      <p>当前对局进度将被清除，确定要重新开始吗？</p>
      <div class="undo-actions">
        <button class="btn btn-primary" @click="confirmNetworkRestart">确认重开</button>
        <button class="btn" @click="restartConfirmPending = false">取消</button>
      </div>
    </div>
  </div>

  <!-- AI 思考提示。 -->
  <div v-if="aiThinking" class="ai-thinking">AI 思考中</div>

  <!-- 结算遮罩和重新开始操作。 -->
  <div v-if="state?.gameOver" class="overlay">
    <div class="card over-card">
      <h2 class="winner-text" :class="state.winner === 1 ? 'red' : 'black'">{{ state.winner === 1 ? '红方胜' : '蓝方胜' }}</h2>
      <div class="btn-group">
        <button class="btn btn-primary" @click="playAgain">再来一局</button>
        <button class="btn" @click="menu">返回菜单</button>
      </div>
    </div>
  </div>
</template>
