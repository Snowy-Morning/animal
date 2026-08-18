import type { Action, GameState, Owner, Piece } from '@/game/rules';

export type FirstTurnGuess = 'heads' | 'tails';

export type ClientMessage =
  | { type: 'create_room'; catOnlyCanCaptureRat: boolean }
  | { type: 'join_room'; roomId: string }
  | { type: 'start_game' }
  | { type: 'restart_game' }
  | { type: 'guess_first_turn'; guess: FirstTurnGuess }
  | { type: 'action'; action: Action }
  | { type: 'request_undo' }
  | { type: 'respond_undo'; accepted: boolean }
  | { type: 'leave_room' };

export type SerializedBoard = {
  cells: (Piece | null)[][];
  camp: Piece | null;
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
  gameOver: boolean;
  winner: Owner | null;
  lastRevealedOwner: Owner | null;
};

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
  | { type: 'room_created'; roomId: string; playerId: 0 }
  | { type: 'room_joined'; roomId: string; playerId: 1 }
  | { type: 'room_state'; state: RoomState }
  | { type: 'game_started'; state: RoomState }
  | { type: 'first_turn_result'; outcome: FirstTurnGuess; winnerPlayerId: 0 | 1 | null }
  | { type: 'undo_requested' }
  | { type: 'undo_result'; accepted: boolean }
  | { type: 'error'; message: string }
  | { type: 'player_left' };
