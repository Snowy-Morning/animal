<script setup lang="ts">
// 导入 Vue 响应式 API。
import { computed, ref } from 'vue';

// 导入规则函数、常量和状态类型。
import {
  afterAction,
  applyAction,
  countAlive,
  createState,
  getPieceAt,
  getPieceMoves,
  PIECE_TYPES,
  revertAction,
  type Action,
  type GameState,
  type MoveAction,
  type Owner,
  type Piece,
} from './game/rules';

// 导入 AI 动作选择函数。
import { findBestMove } from './game/ai';

// 定义棋子的 Unicode 图标。
const icons: Record<string, string> = {
  elephant: '🐘',
  lion: '🦁',
  tiger: '🐯',
  leopard: '🐆',
  wolf: '🐺',
  dog: '🐕',
  cat: '🐈',
  rat: '🐀',
};

// 保存菜单中的对战模式、吃鼠规则和 AI 难度。
const mode = ref<'pvp' | 'pve'>('pvp');
const catOnly = ref(true);
const difficulty = ref(2);

// 保存当前游戏状态。
const state = ref<GameState | null>(null);

// 保存动画和 AI 思考状态。
const animating = ref(false);
const aiThinking = ref(false);

// 根据菜单配置开始一局新游戏。
function startGame(): void {
  state.value = createState(mode.value, 1, difficulty.value, catOnly.value);
  animating.value = false;
  aiThinking.value = false;
  if (state.value.mode === 'pve' && state.value.currentPlayerId === state.value.aiPlayerId) {
    triggerAI();
  }
}

// 返回开始菜单并清理 AI 状态。
function menu(): void {
  state.value = null;
  aiThinking.value = false;
}

// 按当前规则重新开始游戏。
function restart(): void {
  if (state.value) {
    const current = state.value;
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
const humanTurn = computed(
  () =>
    !!state.value &&
    (state.value.mode === 'pvp' || state.value.currentPlayerId !== state.value.aiPlayerId),
);

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
  return `${player}（${owner == null ? '未确定' : owner === 1 ? '红方' : '黑方'}）行棋`;
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

// 执行动作、记录历史并安排下一回合。
function execute(action: Action): void {
  if (!state.value) {
    return;
  }
  const game = state.value;
  const previous = { ...game.playerOwners } as [Owner | null, Owner | null];
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
  afterAction(game, action);
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
        <div class="option-label">对战模式</div>
        <div class="options">
          <label class="radio"><input v-model="mode" type="radio" value="pvp">本地双人对战</label>
          <label class="radio"><input v-model="mode" type="radio" value="pve">人机对战</label>
        </div>
      </div>

      <!-- 吃鼠规则选择。 -->
      <div class="option-group">
        <div class="option-label">吃鼠规则</div>
        <div class="options">
          <label class="radio"><input v-model="catOnly" type="radio" :value="true">只有猫能吃鼠</label>
          <label class="radio"><input v-model="catOnly" type="radio" :value="false">除象外都能吃鼠</label>
        </div>
      </div>

      <!-- AI 难度选择。 -->
      <div v-if="mode === 'pve'" class="option-group">
        <div class="option-label">AI 难度</div>
        <div class="options">
          <label v-for="level in [1, 2, 3]" :key="level" class="radio">
            <input v-model="difficulty" type="radio" :value="level">
            {{ level === 1 ? '简单' : level === 2 ? '中等' : '困难' }}
          </label>
        </div>
      </div>

      <!-- 开始游戏和规则说明。 -->
      <button class="btn btn-primary" @click="startGame">开始对局</button>
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
              <span class="piece-icon">{{ icons[state.board.camp.type] }}</span>
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
                  <span class="piece-icon">{{ icons[piece.type] }}</span>
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

      <!-- 双方损失与存活数量。 -->
      <div class="captured-section">
        <div v-for="owner in [2, 1] as Owner[]" :key="owner" class="captured-block">
          <div class="captured-label">
            <span><i class="loss-dot" :class="owner === 1 ? 'red' : 'black'"></i>{{ owner === 1 ? '红方' : '黑方' }}损失</span>
          </div>
          <div class="captured-list">
            <span v-for="piece in state.captured[owner]" :key="piece.id" class="cap-piece" :class="owner === 1 ? 'red' : 'black'">{{ icons[piece.type] }}</span>
          </div>
          <div class="alive-count">存活 {{ alive(owner) }}</div>
        </div>
      </div>

      <!-- 游戏操作按钮。 -->
      <div class="btn-group">
        <button class="btn" @click="undo">悔棋</button>
        <button class="btn" @click="restart">重开</button>
        <button class="btn" @click="menu">返回菜单</button>
      </div>
    </aside>
  </main>

  <!-- AI 思考提示。 -->
  <div v-if="aiThinking" class="ai-thinking">AI 思考中</div>

  <!-- 结算遮罩和重新开始操作。 -->
  <div v-if="state?.gameOver" class="overlay">
    <div class="card over-card">
      <h2 class="winner-text" :class="state.winner === 1 ? 'red' : 'black'">{{ state.winner === 1 ? '红方胜' : '黑方胜' }}</h2>
      <div class="btn-group">
        <button class="btn btn-primary" @click="restart">再来一局</button>
        <button class="btn" @click="menu">返回菜单</button>
      </div>
    </div>
  </div>
</template>
