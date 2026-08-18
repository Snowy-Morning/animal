<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import GameBoard from '@/components/GameBoard.vue';
import { findBestMove } from '@/game/ai';
import { afterAction, applyAction, countAlive, createState, getLastSameTypeTieWinner, getPieceAt, getPieceMoves, revertAction, PIECE_TYPES, type Action, type MoveAction, type Owner, type Piece } from '@/game/rules';

const route = useRoute();
const router = useRouter();
const mode = route.query.mode === 'pve' ? 'pve' : 'pvp';
const catOnly = route.query.catOnly !== 'false';
const difficulty = Math.min(3, Math.max(1, Number(route.query.difficulty) || 2));
const state = ref(createState(mode, 1, difficulty, catOnly));
const gameVersion = ref(0);
const animating = ref(false);
const aiThinking = ref(false);

const humanTurn = computed(() => state.value.mode === 'pvp' || state.value.currentPlayerId !== state.value.aiPlayerId);
const turnText = computed(() => { const id = state.value.currentPlayerId; const owner = state.value.playerOwners[id]; const player = state.value.mode === 'pvp' ? `玩家${id + 1}` : id === state.value.aiPlayerId ? 'AI' : '你'; return `${player}（${owner == null ? '未确定' : owner === 1 ? '红方' : '蓝方'}）行棋`; });
const actionHint = computed(() => state.value.playerOwners[state.value.currentPlayerId] == null ? `阵营未确定：翻开一张牌（${catOnly ? '只有猫能吃鼠' : '除象外都能吃鼠'}）` : '可翻未知牌或移动己方棋子；豹可斜飞，同级相撞对死');
function classicPieceImage(type: string): string { return `/animal/emojione--${type === 'lion' ? 'lion-face' : type}.svg`; }
function moveAt(r: number, c: number): MoveAction | undefined { return state.value.validMoves.find((move) => move.to.r === r && move.to.c === c); }
function select(r: number, c: number): void { if (!humanTurn.value || animating.value || aiThinking.value) return; const piece = getPieceAt(state.value.board, { r, c }); const owner = state.value.playerOwners[state.value.currentPlayerId]; if (!piece || !piece.revealed || owner == null || piece.owner !== owner) return; state.value.selected = { r, c }; state.value.validMoves = getPieceMoves(state.value.board, r, c, owner); }
function clickCell(r: number, c: number): void { if (!humanTurn.value || animating.value || state.value.gameOver) return; const selected = state.value.selected; const piece = getPieceAt(state.value.board, { r, c }); if (selected) { const move = moveAt(r, c); if (move) { execute(move); return; } if (piece?.revealed && piece.owner === state.value.playerOwners[state.value.currentPlayerId]) { select(r, c); return; } state.value.selected = null; state.value.validMoves = []; return; } if (piece && !piece.revealed) execute({ type: 'reveal', r, c, piece }); else if (piece?.revealed) select(r, c); }
function execute(action: Action): void { const game = state.value; const previous = { ...game.playerOwners } as [Owner | null, Owner | null]; const previousPlayerId = game.currentPlayerId; const previousTurn = game.turnCount; const previousLastRevealedOwner = game.lastRevealedOwner; const tieWinner = getLastSameTypeTieWinner(game.board, action); const context = applyAction(game.board, action); const captured: { piece: Piece; owner: Owner }[] = []; if (action.type === 'move' && context.info.type === 'move' && context.info.target) { captured.push({ piece: context.info.target, owner: context.info.target.owner }); if (action.outcome === 'tie') captured.push({ piece: context.info.mover, owner: context.info.mover.owner }); for (const item of captured) game.captured[item.owner].push({ ...item.piece }); } game.selected = null; game.validMoves = []; afterAction(game, action, tieWinner); game.history.push({ action, revertCtx: context, prevPlayerId: previousPlayerId, prevPlayerOwners: previous, prevTurn: previousTurn, captured, prevLastRevealedOwner: previousLastRevealedOwner }); animating.value = true; window.setTimeout(() => { animating.value = false; if (!state.value.gameOver && state.value.mode === 'pve' && state.value.currentPlayerId === state.value.aiPlayerId) triggerAI(); }, action.type === 'reveal' ? 560 : 360); }
async function triggerAI(): Promise<void> { if (state.value.gameOver) return; aiThinking.value = true; const action = await findBestMove(state.value); aiThinking.value = false; if (action) execute(action); else { state.value.gameOver = true; state.value.winner = (3 - (state.value.playerOwners[state.value.aiPlayerId] || 1)) as Owner; } }
function undo(): void { if (animating.value || aiThinking.value || !state.value.history.length || (state.value.mode === 'pve' && state.value.currentPlayerId === state.value.aiPlayerId && !state.value.gameOver)) return; state.value.gameOver = false; state.value.winner = null; const steps = state.value.mode === 'pve' && state.value.history.length > 1 ? 2 : 1; for (let i = 0; i < steps && state.value.history.length; i++) { const entry = state.value.history.pop()!; revertAction(state.value.board, entry.revertCtx); for (const item of entry.captured) { const list = state.value.captured[item.owner]; const index = list.findIndex((piece) => piece.id === item.piece.id); if (index >= 0) list.splice(index, 1); } state.value.playerOwners = entry.prevPlayerOwners; state.value.currentPlayerId = entry.prevPlayerId; state.value.turnCount = entry.prevTurn; state.value.lastRevealedOwner = entry.prevLastRevealedOwner; } state.value.selected = null; state.value.validMoves = []; }
function restart(): void { gameVersion.value++; state.value = createState(mode, 1, difficulty, catOnly); }
function alive(owner: Owner): number { return countAlive(state.value.board, owner); }
</script>

<template>
  <main class="game-screen">
    <GameBoard :state="state" :game-version="gameVersion" @cell="clickCell" />
    <aside class="panel">
      <h2 class="panel-title">暗兽棋</h2>
      <div class="turn-info"><span class="turn-dot" :class="state.playerOwners[state.currentPlayerId] === 1 ? 'red' : state.playerOwners[state.currentPlayerId] === 2 ? 'black' : 'neutral'"></span><span>{{ turnText }}</span></div>
      <div class="move-count">第 {{ state.turnCount + 1 }} 手</div><div class="action-hint">{{ actionHint }}</div>
      <div class="captured-section"><div v-for="owner in [2, 1] as Owner[]" :key="owner" class="captured-block"><div class="captured-label"><span><i class="loss-dot" :class="owner === 1 ? 'red' : 'black'"></i>{{ owner === 1 ? '红方' : '蓝方' }}损失</span></div><div class="captured-list"><span v-for="piece in state.captured[owner]" :key="piece.id" class="cap-piece" :class="owner === 1 ? 'red' : 'black'"><img :src="classicPieceImage(piece.type)" :alt="PIECE_TYPES[piece.type].char"></span></div><div class="alive-count">存活 {{ alive(owner) }}</div></div></div>
      <div class="btn-group"><button class="btn" @click="undo">悔棋</button><button class="btn" @click="restart">重开</button><button class="btn" @click="router.push('/')">返回菜单</button></div>
    </aside>
  </main>
  <div v-if="aiThinking" class="ai-thinking">AI 思考中</div>
  <div v-if="state.gameOver" class="overlay"><div class="card over-card"><h2 class="winner-text" :class="state.winner === 1 ? 'red' : 'black'">{{ state.winner === 1 ? '红方胜' : '蓝方胜' }}</h2><div class="btn-group"><button class="btn btn-primary" @click="restart">再来一局</button><button class="btn" @click="router.push('/')">返回菜单</button></div></div></div>
</template>
