/* ============================================================
 * game.js — 暗兽棋核心规则引擎（无 DOM 依赖）
 * 规则参考：象狮虎豹狼狗猫鼠 等级制（维基百科）+ 民间暗棋变体
 * 棋盘：3×3 方格的 4×4 交叉点（共 16 点），棋子在交叉点上
 *       中央方格内部是独立公共大本营，四个角点均可进入
 * 暗棋阵营：没有固定先手，谁先翻开哪色棋子就获得该颜色阵营
 *       玩家翻第一张牌后阵营确定，对方自动获得另一颜色
 * 玩法：16 棋子（红黑各 8）随机散布在 16 交叉点，全部背面朝上
 *       每回合可选：翻任意一张未知棋子，或移动己方已翻开的棋子
 * 走法：普通棋子上下左右一格；豹可斜向飞（8 方向）
 * 吃子：大吃小；只有猫能吃鼠；象不能吃鼠；鼠能吃象
 * 对死：同级相撞 → 双方同归于尽（tie）
 * 胜利条件：吃光对方所有存活棋子
 * ============================================================ */

// -------------------- 棋盘尺寸 --------------------
const ROWS = 4;   // 4×4 交叉点 = 3×3 方格
const COLS = 4;

// -------------------- 大本营判定 --------------------
// 大本营是中央方格内部的独立落点，四个角点是它的入口。
const CAMP_POSITION = Object.freeze({ r: 1.5, c: 1.5, camp: true });

function isCamp(r, c) {
  return r === CAMP_POSITION.r && c === CAMP_POSITION.c;
}

function isCampEntrance(r, c) {
  return (r === 1 || r === 2) && (c === 1 || c === 2);
}

function campPieceCount(board) {
  return board.camp ? 1 : 0;
}

function getPieceAt(board, position) {
  return position.camp || isCamp(position.r, position.c)
    ? board.camp
    : board[position.r][position.c];
}

function setPieceAt(board, position, piece) {
  if (position.camp || isCamp(position.r, position.c)) board.camp = piece;
  else board[position.r][position.c] = piece;
}

// -------------------- 棋种常量 --------------------
const PIECE_TYPES = {
  elephant: { rank: 8, char: '象' },
  lion:     { rank: 7, char: '狮' },
  tiger:    { rank: 6, char: '虎' },
  leopard:  { rank: 5, char: '豹' },
  wolf:     { rank: 4, char: '狼' },
  dog:      { rank: 3, char: '狗' },
  cat:      { rank: 2, char: '猫' },
  rat:      { rank: 1, char: '鼠' },
};
const ALL_TYPES = Object.keys(PIECE_TYPES);

// -------------------- 洗牌（Fisher-Yates）--------------------
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// -------------------- 棋盘创建 + 随机散子 --------------------
function createBoard(catOnlyCanCaptureRat = true) {
  const board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  board.camp = null;
  board.catOnlyCanCaptureRat = catOnlyCanCaptureRat;

  // 16 棋子池：红黑各 8（象狮虎豹狼狗猫鼠）
  const pool = [];
  let idCount = 0;
  for (const owner of [1, 2]) {
    for (const type of ALL_TYPES) {
      pool.push({
        id: `p${owner}_${type}_${idCount++}`,
        owner,
        type,
        rank: PIECE_TYPES[type].rank,
        revealed: false,
      });
    }
  }
  shuffle(pool);

  // 16 个交叉点全部放满棋子
  let idx = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      board[r][c] = pool[idx++];
    }
  }
  return board;
}

function cloneBoard(board) {
  const copy = board.map(row => row.map(cell => (cell ? { ...cell } : null)));
  copy.camp = board.camp ? { ...board.camp } : null;
  copy.catOnlyCanCaptureRat = board.catOnlyCanCaptureRat !== false;
  return copy;
}

// -------------------- 存活棋子统计 --------------------
function countAlive(board, owner) {
  let n = board.camp && board.camp.owner === owner ? 1 : 0;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (board[r][c] && board[r][c].owner === owner) n++;
  return n;
}

// -------------------- 吃子判定 --------------------
function canCapture(attacker, defender, catOnlyCanCaptureRat = true) {
  if (!attacker.revealed || !defender.revealed) return 'no';
  if (attacker.owner === defender.owner) return 'no';

  // 同级 → 对死（双方都移除）—— 优先于吃鼠规则
  if (attacker.rank === defender.rank) return 'tie';

  // 象在两种规则下都不能吃鼠
  if (attacker.type === 'elephant' && defender.type === 'rat') return 'no';

  // 开启时只有猫能吃鼠；关闭时除象外按正常等级规则吃鼠
  if (catOnlyCanCaptureRat && defender.type === 'rat' && attacker.type !== 'cat') return 'no';

  // 鼠能吃象（小博大特例）
  if (attacker.type === 'rat' && defender.type === 'elephant') return 'eat';

  // 通用规则：等级高吃等级低
  return attacker.rank > defender.rank ? 'eat' : 'no';
}

// -------------------- 合法移动走法生成 --------------------
const ORTHOGONAL_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAGONAL_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

/**
 * 生成单个已翻开棋子的合法走/吃走法
 * 大本营规则：
 *   1) 大本营一次最多只能容纳 1 颗棋子（进入前需检查 campPieceCount）
 *   2) 敌方不能对大本营内的棋子进行吃/对死（大本营内棋子受保护）
 *   3) 大本营内的棋子可以攻击大本营四周的敌方棋子（目标在大本营外，不受保护）
 *   4) 大本营有棋子时，豹不能斜飞进入或攻击大本营；其他位置的斜飞不受影响
 * @param {Array} board 
 * @param {number} r 
 * @param {number} c 
 * @param {number} [playerOwner] 可选，若传入则只能走该 owner 的棋子
 */
function getPieceMoves(board, r, c, playerOwner) {
  const fromCamp = isCamp(r, c);
  const from = fromCamp ? { ...CAMP_POSITION } : { r, c };
  const piece = getPieceAt(board, from);
  const moves = [];
  if (!piece || !piece.revealed) return moves;
  if (playerOwner != null && piece.owner !== playerOwner) return moves;

  // 营内统一使用四个固定出口；豹在这里不启用营外的斜飞方向。
  if (fromCamp) {
    const campExits = [[1, 1], [1, 2], [2, 1], [2, 2]];
    for (const [nr, nc] of campExits) {
      const target = board[nr][nc];
      if (!target) {
        moves.push({ type: 'move', from, to: { r: nr, c: nc }, capture: null, outcome: 'move' });
        continue;
      }
      const cap = canCapture(piece, target, board.catOnlyCanCaptureRat !== false);
      if (cap === 'eat' || cap === 'tie') {
        moves.push({ type: 'move', from, to: { r: nr, c: nc }, capture: target, outcome: cap });
      }
    }
    return moves;
  }

  // 豹在普通棋盘上始终可以斜飞；大本营占用状态不影响其他位置的斜向走法。
  const dirs = piece.type === 'leopard'
    ? [...ORTHOGONAL_DIRS, ...DIAGONAL_DIRS]
    : ORTHOGONAL_DIRS;

  for (const [dr, dc] of dirs) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
    const target = board[nr][nc];
    if (!target) {
      moves.push({ type: 'move', from, to: { r: nr, c: nc }, capture: null, outcome: 'move' });
      continue;
    }
    const cap = canCapture(piece, target, board.catOnlyCanCaptureRat !== false);
    if (cap === 'eat' || cap === 'tie') {
      moves.push({ type: 'move', from, to: { r: nr, c: nc }, capture: target, outcome: cap });
    }
  }

  // 只有中央方格四个角点可进入大本营。营内被占用时，包含豹斜飞在内的
  // 所有进入、吃子和碰撞动作都不生成；豹在其他目标位置仍保留斜飞。
  const campIsEmpty = campPieceCount(board) === 0;
  if (isCampEntrance(r, c) && campIsEmpty) {
    moves.push({ type: 'move', from, to: { ...CAMP_POSITION }, capture: null, outcome: 'move' });
  }

  return moves;
}

/**
 * 返回指定 owner 的所有走棋类动作
 */
function getAllPieceMoves(board, owner) {
  if (owner == null) return [];
  const all = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c];
      if (p && p.revealed && p.owner === owner) all.push(...getPieceMoves(board, r, c));
    }
  }
  if (board.camp && board.camp.revealed && board.camp.owner === owner) {
    all.push(...getPieceMoves(board, CAMP_POSITION.r, CAMP_POSITION.c));
  }
  return all;
}

/**
 * 返回翻牌类动作（玩家未确定 owner 时，任何人可以翻任何牌）
 */
function getAllRevealActions(board) {
  const acts = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c];
      if (p && !p.revealed) acts.push({ type: 'reveal', r, c, piece: p });
    }
  }
  return acts;
}

/**
 * 汇总玩家回合内所有可选动作
 * @param {Array} board
 * @param {number|null} playerOwner 玩家已确定的 owner（1 或 2）；null 表示尚未确定阵营，只能翻牌
 */
function getAllLegalActions(board, playerOwner) {
  if (playerOwner == null) {
    // 阵营未确定：只能翻牌
    return getAllRevealActions(board);
  }
  // 阵营已确定：可以翻牌 + 走棋（走棋限于己方棋子）
  return [...getAllRevealActions(board), ...getAllPieceMoves(board, playerOwner)];
}

// -------------------- 执行动作 / 回退 --------------------
function applyAction(board, action) {
  if (action.type === 'reveal') {
    const p = board[action.r][action.c];
    const wasRevealed = p.revealed;
    p.revealed = true;
    return { info: { type: 'reveal', r: action.r, c: action.c, wasRevealed, revealedOwner: p.owner } };
  }
  if (action.type === 'move') {
    const mover = getPieceAt(board, action.from);
    const target = getPieceAt(board, action.to);

    if (action.outcome === 'move') {
      setPieceAt(board, action.from, null);
      setPieceAt(board, action.to, mover);
      return { info: { type: 'move', outcome: 'move', from: action.from, to: action.to, mover, target: null } };
    }
    if (action.outcome === 'eat') {
      setPieceAt(board, action.from, null);
      setPieceAt(board, action.to, mover);
      return { info: { type: 'move', outcome: 'eat', from: action.from, to: action.to, mover, target } };
    }
    if (action.outcome === 'tie') {
      setPieceAt(board, action.from, null);
      setPieceAt(board, action.to, null);
      return { info: { type: 'move', outcome: 'tie', from: action.from, to: action.to, mover, target } };
    }
  }
  throw new Error('未知 action：' + JSON.stringify(action));
}

function revertAction(board, context) {
  const { info } = context;
  if (info.type === 'reveal') {
    board[info.r][info.c].revealed = info.wasRevealed;
    return;
  }
  if (info.type === 'move') {
    if (info.outcome === 'move') {
      setPieceAt(board, info.from, info.mover);
      setPieceAt(board, info.to, null);
      return;
    }
    if (info.outcome === 'eat') {
      setPieceAt(board, info.from, info.mover);
      setPieceAt(board, info.to, info.target);
      return;
    }
    if (info.outcome === 'tie') {
      setPieceAt(board, info.from, info.mover);
      setPieceAt(board, info.to, info.target);
      return;
    }
  }
  throw new Error('未知回退：' + JSON.stringify(info));
}

// -------------------- 胜负判定 --------------------
/**
 * @param {Array} board
 * @param {number} winnerOwner 获胜方的 owner（1 或 2）
 * @param {number|null} loserOwner 失败方的 owner（若已确定）
 */
function checkWinner(board, winnerOwner, loserOwner) {
  if (countAlive(board, winnerOwner) === 0) return null;
  if (loserOwner != null && countAlive(board, loserOwner) === 0) return winnerOwner;
  // 所有对手阵营的合法动作
  if (loserOwner != null && getAllLegalActions(board, loserOwner).length === 0) return winnerOwner;
  return null;
}

// -------------------- 游戏状态 --------------------
/**
 * 创建暗兽棋游戏状态
 * @param {string} mode 'pvp' 或 'pve'
 * @param {number} aiPlayerId AI 对应的玩家 ID（0 或 1）
 * @param {number} aiDepth 未使用
 * @param {boolean} catOnlyCanCaptureRat 是否启用“只有猫能吃鼠”
 */
function createState(mode = 'pvp', aiPlayerId = 1, aiDepth = 2, catOnlyCanCaptureRat = true) {
  return {
    board: createBoard(catOnlyCanCaptureRat),
    // 暗棋：初始无阵营，谁先翻谁定
    playerOwners: [null, null],  // playerOwners[0] = 玩家1的owner, playerOwners[1] = 玩家2的owner
    currentPlayerId: 0,          // 当前行动的玩家 ID
    mode,
    aiPlayerId,
    aiDepth,
    catOnlyCanCaptureRat,
    turnCount: 0,
    history: [],
    captured: { 1: [], 2: [] },
    selected: null,
    validMoves: [],
    gameOver: false,
    winner: null,
    // 最近翻牌得到的 owner（用于 AI 判断是否已确定阵营）
    lastRevealedOwner: null,
  };
}

/**
 * 玩家完成一个动作后，更新阵营和回合
 * @param {object} state 
 * @param {object} action 执行的动作
 */
function afterAction(state, action) {
  const playerId = state.currentPlayerId;

  // 如果翻牌且该玩家的阵营未确定 → 根据翻出的棋子确定阵营
  if (action.type === 'reveal' && state.playerOwners[playerId] == null) {
    const revealedOwner = state.board[action.r][action.c].owner;
    state.playerOwners[playerId] = revealedOwner;
    // 对方自动获得另一个颜色
    state.playerOwners[1 - playerId] = 3 - revealedOwner;
    state.lastRevealedOwner = revealedOwner;
  }

  state.turnCount++;
  state.currentPlayerId = 1 - playerId;

  // 胜负判定
  const myOwner = state.playerOwners[playerId];
  const oppOwner = state.playerOwners[1 - playerId];
  const w = checkWinner(state.board, myOwner, oppOwner);
  if (w) {
    state.gameOver = true;
    state.winner = w;
  }
}

// -------------------- 暴露 API --------------------
const Game = {
  ROWS, COLS, PIECE_TYPES, ALL_TYPES, CAMP_POSITION,
  isCamp, isCampEntrance, campPieceCount, getPieceAt,
  createBoard, cloneBoard, shuffle, countAlive,
  canCapture, getPieceMoves, getAllPieceMoves, getAllRevealActions, getAllLegalActions,
  applyAction, revertAction, checkWinner, createState, afterAction,
};
if (typeof window !== 'undefined') window.Game = Game;
