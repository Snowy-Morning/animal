export type PieceType = 'elephant' | 'lion' | 'tiger' | 'leopard' | 'wolf' | 'dog' | 'cat' | 'rat';
export type Owner = 1 | 2;

// 棋子类型，包含棋子 ID、所属玩家、棋子类型、棋子等级、是否已显示。
export interface Piece {
  id: string;
  owner: Owner;
  type: PieceType;
  rank: number;
  revealed: boolean;
}

// 棋盘位置类型，包含行号、列号、是否为营地。
export interface Position {
  r: number;
  c: number;
  camp?: boolean;
}

// 棋盘类型，包含棋子矩阵、营地、是否仅猫可以吃鼠。
export type Board = (Piece | null)[][] & {
  camp: Piece | null;
  catOnlyCanCaptureRat?: boolean;
};

// 移动结果类型，包含移动、吃子、平局。
export type MoveOutcome = 'move' | 'eat' | 'tie';

// 显示棋子类型，包含显示棋子意图、行号、列号、棋子。
export interface RevealAction {
  type: 'reveal';
  r: number;
  c: number;
  piece: Piece;
}

// 移动类型，包含移动意图、起始位置、目标位置、吃子棋子、移动结果。
export interface MoveAction {
  type: 'move';
  from: Position;
  to: Position;
  capture: Piece | null;
  outcome: MoveOutcome;
}

// 操作类型，包含显示棋子、移动棋子。
export type Action = RevealAction | MoveAction;

// 操作上下文类型，包含操作类型、操作信息。
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

// 游戏状态类型，包含棋盘、玩家信息、当前玩家、游戏模式、AI 玩家 ID、AI 深度、是否仅猫可以吃鼠、回合数、历史记录、吃子记录、选中位置、有效移动、是否结束、赢家、最后显示棋子玩家。
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

// 历史记录条目类型，包含操作、操作上下文、前一个玩家 ID、前一个玩家信息、前一个回合数、吃子记录、前一个最后显示棋子玩家。
export interface HistoryEntry {
  action: Action;
  revertCtx: ActionContext;
  prevPlayerId: 0 | 1;
  prevPlayerOwners: [Owner | null, Owner | null];
  prevTurn: number;
  captured: { piece: Piece; owner: Owner }[];
  prevLastRevealedOwner: Owner | null;
}
