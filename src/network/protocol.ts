import type { Action, GameState, Owner, Piece } from '@/game/rules';

export type FirstTurnGuess = 'heads' | 'tails';

// 客户端消息只表达操作意图，动作合法性与状态变更均由服务端权威校验。
export type ClientMessage =
  | { type: 'create_room'; catOnlyCanCaptureRat: boolean }
  | { type: 'join_room'; roomId: string }
  | { type: 'resume_room'; roomId: string; sessionToken: string }
  | { type: 'start_game' }
  | { type: 'restart_game' }
  | { type: 'guess_first_turn'; guess: FirstTurnGuess }
  | { type: 'action'; action: Action }
  | { type: 'request_undo' }
  | { type: 'respond_undo'; accepted: boolean }
  | { type: 'leave_room' };

// 未翻开的棋子仅传递背面状态，避免泄露 id、阵营、棋种和等级。
export type HiddenPiece = {
  revealed: false;
};

export type SerializedPiece = Piece | HiddenPiece;

export type SerializedBoard = {
  cells: (SerializedPiece | null)[][];
  camp: SerializedPiece | null;
  catOnlyCanCaptureRat: boolean;
};

export type SerializedGameState = {
  board: SerializedBoard;
  playerOwners: [Owner | null, Owner | null];
  currentPlayerId: 0 | 1;
  mode: GameState['mode'];
  aiPlayerId: 0 | 1;
  aiDepth: number;
  catOnlyCanCaptureRat: boolean;
  turnCount: number;
  captured: Record<Owner, Piece[]>;
  aliveCounts: Record<Owner, number>;
  gameOver: boolean;
  winner: Owner | null;
  lastRevealedOwner: Owner | null;
};

// 房间状态覆盖等待入场、可开始、猜先、对局中和已结束五个阶段。
export type RoomStatus = 'waiting' | 'ready' | 'guessing' | 'playing' | 'finished';

export type RoomState = {
  roomId: string;
  playerCount: number;
  status: RoomStatus;
  playerId: 0 | 1;
  guessRound?: number;
  guessSubmitted?: boolean;
  opponentGuessSubmitted?: boolean;
  gameState?: SerializedGameState;
};

export type ServerMessage =
  | { type: 'room_created'; roomId: string; playerId: 0; sessionToken: string }
  | { type: 'room_joined'; roomId: string; playerId: 1; sessionToken: string }
  | { type: 'room_resumed'; roomId: string; playerId: 0 | 1; sessionToken: string }
  | { type: 'room_state'; state: RoomState }
  | { type: 'game_started'; state: RoomState }
  | { type: 'first_turn_result'; outcome: FirstTurnGuess; winnerPlayerId: 0 | 1 | null }
  | { type: 'undo_requested' }
  | { type: 'undo_result'; accepted: boolean }
  | { type: 'error'; message: string }
  | { type: 'player_left' };
