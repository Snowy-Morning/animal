// 暗兽棋规则引擎，完全独立于 DOM。

// 定义棋盘尺寸。
export const ROWS = 4;
export const COLS = 4;

// 定义棋盘中央的独立营位。
export const CAMP_POSITION = Object.freeze({
  r: 1.5,
  c: 1.5,
  camp: true as const,
});

// 定义各类棋子的等级和显示字符。
export const PIECE_TYPES = {
  elephant: { rank: 8, char: '象' },
  lion: { rank: 7, char: '狮' },
  tiger: { rank: 6, char: '虎' },
  leopard: { rank: 5, char: '豹' },
  wolf: { rank: 4, char: '狼' },
  dog: { rank: 3, char: '狗' },
  cat: { rank: 2, char: '猫' },
  rat: { rank: 1, char: '鼠' },
} as const;

// 定义棋子、位置和动作相关类型。
export type PieceType = keyof typeof PIECE_TYPES;
export type Owner = 1 | 2;

export interface Piece {
  id: string;
  owner: Owner;
  type: PieceType;
  rank: number;
  revealed: boolean;
}

export interface Position {
  r: number;
  c: number;
  camp?: boolean;
}

// 棋盘数组额外保存营位棋子和吃鼠规则。
export type Board = (Piece | null)[][] & {
  camp: Piece | null;
  catOnlyCanCaptureRat?: boolean;
};

export type MoveOutcome = 'move' | 'eat' | 'tie';

export interface RevealAction {
  type: 'reveal';
  r: number;
  c: number;
  piece: Piece;
}

export interface MoveAction {
  type: 'move';
  from: Position;
  to: Position;
  capture: Piece | null;
  outcome: MoveOutcome;
}

export type Action = RevealAction | MoveAction;

// 保存动作撤销所需的上下文。
export interface ActionContext {
  info:
    | {
        type: 'reveal';
        r: number;
        c: number;
        wasRevealed: boolean;
        revealedOwner: Owner;
      }
    | {
        type: 'move';
        outcome: MoveOutcome;
        from: Position;
        to: Position;
        mover: Piece;
        target: Piece | null;
      };
}

// 保存完整的游戏状态和历史记录。
export interface GameState {
  board: Board;
  playerOwners: [Owner | null, Owner | null];
  currentPlayerId: 0 | 1;
  mode: 'pvp' | 'pve';
  aiPlayerId: 0 | 1;
  aiDepth: number;
  catOnlyCanCaptureRat: boolean;
  turnCount: number;
  history: HistoryEntry[];
  captured: Record<Owner, Piece[]>;
  selected: Position | null;
  validMoves: MoveAction[];
  gameOver: boolean;
  winner: Owner | null;
  lastRevealedOwner: Owner | null;
}

export interface HistoryEntry {
  action: Action;
  revertCtx: ActionContext;
  prevPlayerId: 0 | 1;
  prevPlayerOwners: [Owner | null, Owner | null];
  prevTurn: number;
  captured: { piece: Piece; owner: Owner }[];
  prevLastRevealedOwner: Owner | null;
}

// 判断坐标是否为中央营位。
export function isCamp(r: number, c: number): boolean {
  return r === 1.5 && c === 1.5;
}

// 判断坐标是否为营位入口。
export function isCampEntrance(r: number, c: number): boolean {
  return (r === 1 || r === 2) && (c === 1 || c === 2);
}

// 获取营位中的棋子数量。
export function campPieceCount(board: Board): number {
  return board.camp ? 1 : 0;
}

// 读取指定位置的棋子。
export function getPieceAt(board: Board, position: Position): Piece | null {
  if (position.camp || isCamp(position.r, position.c)) {
    return board.camp;
  }
  return board[position.r][position.c];
}

// 将棋子写入指定位置。
export function setPieceAt(
  board: Board,
  position: Position,
  piece: Piece | null,
): void {
  if (position.camp || isCamp(position.r, position.c)) {
    board.camp = piece;
  } else {
    board[position.r][position.c] = piece;
  }
}

// 使用 Fisher-Yates 算法随机洗牌。
export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 创建随机初始棋盘。
export function createBoard(catOnlyCanCaptureRat = true): Board {
  const board = Array.from(
    { length: ROWS },
    () => Array<Piece | null>(COLS).fill(null),
  ) as Board;
  board.camp = null;
  board.catOnlyCanCaptureRat = catOnlyCanCaptureRat;

  // 按双方和棋种生成全部棋子。
  const pool: Piece[] = [];
  let id = 0;
  for (const owner of [1, 2] as Owner[]) {
    for (const type of Object.keys(PIECE_TYPES) as PieceType[]) {
      pool.push({
        id: `p${owner}_${type}_${id++}`,
        owner,
        type,
        rank: PIECE_TYPES[type].rank,
        revealed: false,
      });
    }
  }

  // 洗牌后填充普通棋盘格。
  shuffle(pool);
  let i = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      board[r][c] = pool[i++];
    }
  }
  return board;
}

// 深复制棋盘及其中的棋子。
export function cloneBoard(board: Board): Board {
  const copy = board.map((row) =>
    row.map((piece) => (piece ? { ...piece } : null)),
  ) as Board;
  copy.camp = board.camp ? { ...board.camp } : null;
  copy.catOnlyCanCaptureRat = board.catOnlyCanCaptureRat !== false;
  return copy;
}

// 统计指定阵营仍存活的棋子数量。
export function countAlive(board: Board, owner: Owner): number {
  let count = board.camp?.owner === owner ? 1 : 0;
  for (const row of board) {
    for (const piece of row) {
      if (piece?.owner === owner) {
        count++;
      }
    }
  }
  return count;
}

// 根据等级和特殊规则判断攻击结果。
export function canCapture(
  attacker: Piece,
  defender: Piece,
  catOnlyCanCaptureRat = true,
): 'no' | 'eat' | 'tie' {
  if (!attacker.revealed || !defender.revealed || attacker.owner === defender.owner) {
    return 'no';
  }
  if (attacker.rank === defender.rank) {
    return 'tie';
  }
  if (attacker.type === 'elephant' && defender.type === 'rat') {
    return 'no';
  }
  if (catOnlyCanCaptureRat && defender.type === 'rat' && attacker.type !== 'cat') {
    return 'no';
  }
  if (attacker.type === 'rat' && defender.type === 'elephant') {
    return 'eat';
  }
  return attacker.rank > defender.rank ? 'eat' : 'no';
}

// 生成单个棋子的所有合法走法。
export function getPieceMoves(
  board: Board,
  r: number,
  c: number,
  playerOwner?: Owner | null,
): MoveAction[] {
  const fromCamp = isCamp(r, c);
  const from = fromCamp ? { ...CAMP_POSITION } : { r, c };
  const piece = getPieceAt(board, from);
  if (!piece || !piece.revealed || (playerOwner != null && piece.owner !== playerOwner)) {
    return [];
  }

  const moves: MoveAction[] = [];
  const orthogonal = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const diagonal = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  // 营内棋子只能移动到四个营位入口。
  if (fromCamp) {
    for (const [nr, nc] of [[1, 1], [1, 2], [2, 1], [2, 2]]) {
      addMove(nr, nc);
    }
    return moves;
  }

  // 豹可以斜向移动，其余棋子只能正交移动。
  const dirs = piece.type === 'leopard' ? [...orthogonal, ...diagonal] : orthogonal;
  for (const [dr, dc] of dirs) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) {
      continue;
    }
    const crossesCamp =
      piece.type === 'leopard' &&
      dr !== 0 &&
      dc !== 0 &&
      isCampEntrance(r, c) &&
      isCampEntrance(nr, nc) &&
      r + nr === 3 &&
      c + nc === 3 &&
      campPieceCount(board) > 0;
    if (!crossesCamp) {
      addMove(nr, nc);
    }
  }

  // 空营位允许入口棋子进入。
  if (isCampEntrance(r, c) && campPieceCount(board) === 0) {
    moves.push({
      type: 'move',
      from,
      to: { ...CAMP_POSITION },
      capture: null,
      outcome: 'move',
    });
  }
  return moves;

  // 根据目标格内容添加移动或攻击动作。
  function addMove(nr: number, nc: number): void {
    const target = board[nr][nc];
    if (!target) {
      moves.push({ type: 'move', from, to: { r: nr, c: nc }, capture: null, outcome: 'move' });
      return;
    }
    if (isCamp(nr, nc)) {
      return;
    }
    const outcome = canCapture(piece!, target, board.catOnlyCanCaptureRat !== false);
    if (outcome !== 'no') {
      moves.push({ type: 'move', from, to: { r: nr, c: nc }, capture: target, outcome });
    }
  }
}

// 生成指定阵营的全部移动动作。
export function getAllPieceMoves(board: Board, owner: Owner | null): MoveAction[] {
  if (owner == null) {
    return [];
  }
  const moves: MoveAction[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      moves.push(...getPieceMoves(board, r, c, owner));
    }
  }
  if (board.camp?.owner === owner) {
    moves.push(...getPieceMoves(board, 1.5, 1.5, owner));
  }
  return moves;
}

// 生成全部未翻开的翻牌动作。
export function getAllRevealActions(board: Board): RevealAction[] {
  const actions: RevealAction[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const piece = board[r][c];
      if (piece && !piece.revealed) {
        actions.push({ type: 'reveal', r, c, piece });
      }
    }
  }
  return actions;
}

// 汇总当前阵营可以执行的全部动作。
export function getAllLegalActions(board: Board, owner: Owner | null): Action[] {
  return owner == null
    ? getAllRevealActions(board)
    : [...getAllRevealActions(board), ...getAllPieceMoves(board, owner)];
}

// 执行动作，并返回用于撤销的上下文。
export function applyAction(board: Board, action: Action): ActionContext {
  if (action.type === 'reveal') {
    const piece = board[action.r][action.c];
    if (!piece) {
      throw new Error('翻牌位置没有棋子');
    }
    const wasRevealed = piece.revealed;
    piece.revealed = true;
    return {
      info: {
        type: 'reveal',
        r: action.r,
        c: action.c,
        wasRevealed,
        revealedOwner: piece.owner,
      },
    };
  }

  // 移动棋子并处理吃子或同级对死。
  const mover = getPieceAt(board, action.from);
  const target = getPieceAt(board, action.to);
  if (!mover) {
    throw new Error('移动位置没有棋子');
  }
  if (action.outcome === 'tie') {
    setPieceAt(board, action.from, null);
    setPieceAt(board, action.to, null);
  } else {
    setPieceAt(board, action.from, null);
    setPieceAt(board, action.to, mover);
  }
  return {
    info: {
      type: 'move',
      outcome: action.outcome,
      from: action.from,
      to: action.to,
      mover,
      target,
    },
  };
}

// 回退一个已经执行的动作。
export function revertAction(board: Board, context: ActionContext): void {
  const info = context.info;
  if (info.type === 'reveal') {
    const piece = board[info.r][info.c];
    if (piece) {
      piece.revealed = info.wasRevealed;
    }
    return;
  }
  if (info.outcome === 'move') {
    setPieceAt(board, info.from, info.mover);
    setPieceAt(board, info.to, null);
  } else {
    setPieceAt(board, info.from, info.mover);
    setPieceAt(board, info.to, info.target);
  }
}

// 根据存活数量和无棋可走状态判定胜者。
export function checkWinner(
  board: Board,
  winnerOwner: Owner | null,
  loserOwner: Owner | null,
): Owner | null {
  if (winnerOwner == null || countAlive(board, winnerOwner) === 0) {
    return null;
  }
  if (
    loserOwner != null &&
    (countAlive(board, loserOwner) === 0 || getAllLegalActions(board, loserOwner).length === 0)
  ) {
    return winnerOwner;
  }
  return null;
}

// 创建一局新的游戏状态。
export function createState(
  mode: 'pvp' | 'pve' = 'pvp',
  aiPlayerId: 0 | 1 = 1,
  aiDepth = 2,
  catOnlyCanCaptureRat = true,
): GameState {
  return {
    board: createBoard(catOnlyCanCaptureRat),
    playerOwners: [null, null],
    currentPlayerId: 0,
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
    lastRevealedOwner: null,
  };
}

// 返回双方各剩一枚同类型棋子时，主动发起对死的一方。
export function getLastSameTypeTieWinner(board: Board, action: Action): Owner | null {
  if (action.type !== 'move' || action.outcome !== 'tie') {
    return null;
  }
  const mover = getPieceAt(board, action.from);
  const target = getPieceAt(board, action.to);
  if (
    mover &&
    target &&
    mover.type === target.type &&
    countAlive(board, mover.owner) === 1 &&
    countAlive(board, target.owner) === 1
  ) {
    return mover.owner;
  }
  return null;
}

// 完成动作后的阵营分配、回合切换和胜负判断。
export function afterAction(state: GameState, action: Action, tieWinner: Owner | null = null): void {
  const player = state.currentPlayerId;
  if (action.type === 'reveal' && state.playerOwners[player] == null) {
    const piece = state.board[action.r][action.c];
    if (!piece) {
      throw new Error('翻牌位置没有棋子');
    }
    const owner = piece.owner;
    state.playerOwners[player] = owner;
    state.playerOwners[1 - player] = (3 - owner) as Owner;
    state.lastRevealedOwner = owner;
  }
  state.turnCount++;
  state.currentPlayerId = (1 - player) as 0 | 1;
  const playerOwner = state.playerOwners[player];
  const opponentOwner = state.playerOwners[1 - player];
  const winner = tieWinner ?? (
    playerOwner != null && countAlive(state.board, playerOwner) === 0
      ? opponentOwner
      : checkWinner(state.board, playerOwner, opponentOwner)
  );
  if (winner) {
    state.gameOver = true;
    state.winner = winner;
  }
}
