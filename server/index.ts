import { randomBytes, randomInt } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  afterAction,
  applyAction,
  countAlive,
  createState,
  getAllLegalActions,
  getLastSameTypeTieWinner,
  getPieceMoves,
  revertAction,
  type Action,
  type ActionContext,
  type GameState,
  type Owner,
  type Piece,
} from '../src/game/rules';
import type {
  ClientMessage,
  FirstTurnGuess,
  RoomState,
  SerializedGameState,
  SerializedPiece,
  ServerMessage,
} from '../src/network/protocol';

type FirstTurnState = {
  round: number;
  guesses: [FirstTurnGuess | null, FirstTurnGuess | null];
};

// 服务端历史保存完整撤销快照，悔棋时统一恢复棋盘、阵营、回合和吃子记录。
type ServerHistoryEntry = {
  revertContext: ActionContext;
  previousPlayerId: 0 | 1;
  previousPlayerOwners: [Owner | null, Owner | null];
  previousTurnCount: number;
  previousLastRevealedOwner: Owner | null;
  captured: { piece: Piece; owner: Owner }[];
};

type Room = {
  id: string;
  catOnlyCanCaptureRat: boolean;
  clients: [WebSocket | null, WebSocket | null];
  sessionTokens: [string | null, string | null];
  disconnectTimers: [ReturnType<typeof setTimeout> | null, ReturnType<typeof setTimeout> | null];
  state: GameState | null;
  firstTurn: FirstTurnState | null;
  history: ServerHistoryEntry[];
  undoRequester: 0 | 1 | null;
};

// 断线后保留席位和 sessionToken 30 秒，超时才按离房清理。
const RECONNECT_GRACE_MS = 30_000;
const rooms = new Map<string, Room>();
const clients = new Map<WebSocket, { room: Room; playerId: 0 | 1 }>();
const wss = new WebSocketServer({ host: '0.0.0.0', port: 3000 });

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function roomId(): string {
  let id = '';
  do {
    id = String(randomInt(100000, 1000000));
  } while (rooms.has(id));
  return id;
}

// 未翻棋子统一脱敏为背面标记，禁止真实棋子信息进入网络载荷。
function serializePiece(piece: Piece | null): SerializedPiece | null {
  if (!piece) return null;
  return piece.revealed ? { ...piece } : { revealed: false };
}

function serializeState(game: GameState): SerializedGameState {
  return {
    board: {
      cells: game.board.map((row) => row.map(serializePiece)),
      camp: serializePiece(game.board.camp),
      catOnlyCanCaptureRat: game.board.catOnlyCanCaptureRat !== false,
    },
    playerOwners: game.playerOwners,
    currentPlayerId: game.currentPlayerId,
    mode: game.mode,
    aiPlayerId: game.aiPlayerId,
    aiDepth: game.aiDepth,
    catOnlyCanCaptureRat: game.catOnlyCanCaptureRat,
    turnCount: game.turnCount,
    captured: game.captured,
    aliveCounts: { 1: countAlive(game.board, 1), 2: countAlive(game.board, 2) },
    gameOver: game.gameOver,
    winner: game.winner,
    lastRevealedOwner: game.lastRevealedOwner,
  };
}

// 广播时为每个连接单独组装其 playerId 和猜先提交视角，棋盘则始终使用脱敏快照。
function broadcast(room: Room, type: 'room_state' | 'game_started'): void {
  const status = room.state
    ? (room.state.gameOver ? 'finished' : 'playing')
    : room.firstTurn
      ? 'guessing'
      : room.clients[1]
        ? 'ready'
        : 'waiting';
  room.clients.forEach((socket, playerId) => {
    if (!socket) return;
    const currentPlayerId = playerId as 0 | 1;
    const state: RoomState = {
      roomId: room.id,
      playerCount: room.clients.filter(Boolean).length,
      status,
      playerId: currentPlayerId,
      ...(room.firstTurn ? {
        guessRound: room.firstTurn.round,
        guessSubmitted: room.firstTurn.guesses[currentPlayerId] !== null,
        opponentGuessSubmitted: room.firstTurn.guesses[1 - currentPlayerId] !== null,
      } : {}),
      ...(room.state ? { gameState: serializeState(room.state) } : {}),
    };
    send(socket, { type, ...(type === 'game_started' ? { state } : { state }) } as ServerMessage);
  });
}

function reject(socket: WebSocket, message: string): void {
  send(socket, { type: 'error', message });
}

// 服务端只接受规则引擎生成的候选动作，客户端附带的棋子内容不会直接参与落子。
function validAction(game: GameState, action: Action, owner: Owner | null): Action | null {
  const legal = getAllLegalActions(game.board, owner);
  if (action.type === 'reveal') {
    const candidate = legal.find((item) => item.type === 'reveal' && item.r === action.r && item.c === action.c);
    return candidate ?? null;
  }
  const moves = getPieceMoves(game.board, action.from.r, action.from.c, owner);
  const candidate = moves.find((item) => item.to.r === action.to.r && item.to.c === action.to.c && item.outcome === action.outcome);
  return candidate ?? null;
}

function handleMessage(socket: WebSocket, message: ClientMessage): void {
  const connection = clients.get(socket);
  if (message.type === 'create_room') {
    if (connection) return reject(socket, '你已经在房间中');
    const room: Room = {
      id: roomId(),
      catOnlyCanCaptureRat: message.catOnlyCanCaptureRat,
      clients: [socket, null],
      sessionTokens: [randomBytes(24).toString('hex'), null],
      disconnectTimers: [null, null],
      state: null,
      firstTurn: null,
      history: [],
      undoRequester: null,
    };
    rooms.set(room.id, room);
    clients.set(socket, { room, playerId: 0 });
    send(socket, { type: 'room_created', roomId: room.id, playerId: 0, sessionToken: room.sessionTokens[0]! });
    broadcast(room, 'room_state');
    return;
  }
  if (message.type === 'join_room') {
    if (connection) return reject(socket, '你已经在房间中');
    if (!/^\d{6}$/.test(message.roomId)) return reject(socket, '房间号格式无效');
    const room = rooms.get(message.roomId);
    if (!room || room.clients[1] || room.sessionTokens[1] || room.state) return reject(socket, '房间不存在或已开始');
    room.clients[1] = socket;
    room.sessionTokens[1] = randomBytes(24).toString('hex');
    clients.set(socket, { room, playerId: 1 });
    send(socket, { type: 'room_joined', roomId: room.id, playerId: 1, sessionToken: room.sessionTokens[1] });
    broadcast(room, 'room_state');
    return;
  }
  if (message.type === 'resume_room') {
    if (connection) return reject(socket, '你已经在房间中');
    const room = rooms.get(message.roomId);
    if (!room) return reject(socket, '房间已失效');
    const sessionPlayerId = room.sessionTokens.findIndex((token) => token === message.sessionToken);
    if (sessionPlayerId !== 0 && sessionPlayerId !== 1) return reject(socket, '重连凭据无效');
    if (room.clients[sessionPlayerId]) return reject(socket, '该玩家已经在线');
    const timer = room.disconnectTimers[sessionPlayerId];
    if (timer) clearTimeout(timer);
    room.disconnectTimers[sessionPlayerId] = null;
    let playerId = sessionPlayerId as 0 | 1;
    if (sessionPlayerId === 1 && !room.sessionTokens[0]) {
      room.sessionTokens = [room.sessionTokens[1], null];
      room.clients = [socket, null];
      room.disconnectTimers = [null, null];
      playerId = 0;
    } else {
      room.clients[playerId] = socket;
    }
    clients.set(socket, { room, playerId });
    send(socket, { type: 'room_resumed', roomId: room.id, playerId, sessionToken: message.sessionToken });
    broadcast(room, 'room_state');
    return;
  }
  if (!connection) return reject(socket, '请先创建或加入房间');
  const { room, playerId } = connection;
  if (message.type === 'start_game' || message.type === 'restart_game') {
    const finished = room.state?.gameOver === true;
    if (playerId !== 0 && !(message.type === 'restart_game' && finished)) {
      return reject(socket, '只有房主可以开始或重开');
    }
    if (!room.clients[1]) return reject(socket, '请等待第二位玩家加入');
    if (message.type === 'start_game' && (room.state || room.firstTurn)) return reject(socket, '游戏已经开始或正在猜先');
    room.state = null;
    room.firstTurn = { round: 1, guesses: [null, null] };
    room.history = [];
    room.undoRequester = null;
    broadcast(room, 'room_state');
    return;
  }
  // 两名玩家都提交猜先后才随机产生结果；平局开启下一轮，胜者决定首手。
  if (message.type === 'guess_first_turn') {
    if (message.guess !== 'heads' && message.guess !== 'tails') return reject(socket, '猜先选择无效');
    if (room.state || !room.firstTurn || !room.clients[1]) return reject(socket, '当前不在猜先阶段');
    if (room.firstTurn.guesses[playerId] !== null) return reject(socket, '本轮已经提交猜先');
    room.firstTurn.guesses[playerId] = message.guess;
    const [firstGuess, secondGuess] = room.firstTurn.guesses;
    if (firstGuess === null || secondGuess === null) {
      broadcast(room, 'room_state');
      return;
    }
    const outcome: FirstTurnGuess = randomInt(0, 2) === 0 ? 'heads' : 'tails';
    const winnerPlayerId = firstGuess === outcome && secondGuess !== outcome
      ? 0
      : secondGuess === outcome && firstGuess !== outcome
        ? 1
        : null;
    const round = room.firstTurn.round;
    room.clients.forEach((peer) => {
      if (peer) send(peer, { type: 'first_turn_result', outcome, winnerPlayerId });
    });
    if (winnerPlayerId === null) {
      room.firstTurn = { round: round + 1, guesses: [null, null] };
      broadcast(room, 'room_state');
      return;
    }
    room.state = createState('pvp', 1, 2, room.catOnlyCanCaptureRat);
    room.state.currentPlayerId = winnerPlayerId;
    room.firstTurn = null;
    broadcast(room, 'game_started');
    return;
  }
  // 动作落地前记录完整历史并由规则引擎推进回合，所有客户端都只能接收这份权威结果。
  if (message.type === 'action') {
    if (!room.state || room.state.gameOver) return reject(socket, '当前没有进行中的游戏');
    if (room.state.currentPlayerId !== playerId) return reject(socket, '还没轮到你');
    const owner = room.state.playerOwners[playerId];
    const action = validAction(room.state, message.action, owner);
    if (!action) return reject(socket, '非法动作');
    const previousPlayerId = room.state.currentPlayerId;
    const previousPlayerOwners = [...room.state.playerOwners] as [Owner | null, Owner | null];
    const previousTurnCount = room.state.turnCount;
    const previousLastRevealedOwner = room.state.lastRevealedOwner;
    const tieWinner = getLastSameTypeTieWinner(room.state.board, action);
    const revertContext = applyAction(room.state.board, action);
    const captured: ServerHistoryEntry['captured'] = [];
    if (action.type === 'move' && revertContext.info.type === 'move' && revertContext.info.target) {
      captured.push({ piece: { ...revertContext.info.target }, owner: revertContext.info.target.owner });
      if (action.outcome === 'tie') {
        captured.push({ piece: { ...revertContext.info.mover }, owner: revertContext.info.mover.owner });
      }
      for (const item of captured) {
        room.state.captured[item.owner].push({ ...item.piece });
      }
    }
    afterAction(room.state, action, tieWinner);
    room.history.push({
      revertContext,
      previousPlayerId,
      previousPlayerOwners,
      previousTurnCount,
      previousLastRevealedOwner,
      captured,
    });
    if (room.undoRequester !== null) {
      room.clients.forEach((peer) => {
        if (peer) send(peer, { type: 'undo_result', accepted: false });
      });
      room.undoRequester = null;
    }
    broadcast(room, 'room_state');
    return;
  }
  if (message.type === 'request_undo') {
    if (!room.state || room.state.gameOver) return reject(socket, '当前没有进行中的游戏');
    if (!room.history.length) return reject(socket, '暂无可悔棋步');
    if (room.undoRequester !== null) return reject(socket, '已有未处理的悔棋请求');
    const opponentId = playerId === 0 ? 1 : 0;
    const opponent = room.clients[opponentId];
    if (!opponent) return reject(socket, '对手已离开房间');
    room.undoRequester = playerId;
    send(opponent, { type: 'undo_requested' });
    return;
  }
  // 同意悔棋时弹出最近历史并恢复所有关联状态；拒绝或新动作都会清除待处理请求。
  if (message.type === 'respond_undo') {
    if (!room.state || room.undoRequester === null) return reject(socket, '当前没有待处理的悔棋请求');
    if (playerId === room.undoRequester) return reject(socket, '不能回应自己的悔棋请求');
    const requester = room.clients[room.undoRequester];
    const responder = room.clients[playerId];
    if (!message.accepted) {
      room.undoRequester = null;
      if (requester) send(requester, { type: 'undo_result', accepted: false });
      if (responder) send(responder, { type: 'undo_result', accepted: false });
      return;
    }
    const entry = room.history.pop();
    if (!entry) return reject(socket, '暂无可悔棋步');
    revertAction(room.state.board, entry.revertContext);
    for (const item of entry.captured) {
      const captured = room.state.captured[item.owner];
      const index = captured.findIndex((piece) => piece.id === item.piece.id);
      if (index >= 0) captured.splice(index, 1);
    }
    room.state.playerOwners = entry.previousPlayerOwners;
    room.state.currentPlayerId = entry.previousPlayerId;
    room.state.turnCount = entry.previousTurnCount;
    room.state.lastRevealedOwner = entry.previousLastRevealedOwner;
    room.state.gameOver = false;
    room.state.winner = null;
    room.undoRequester = null;
    if (requester) send(requester, { type: 'undo_result', accepted: true });
    if (responder) send(responder, { type: 'undo_result', accepted: true });
    broadcast(room, 'room_state');
    return;
  }
  if (message.type === 'leave_room') {
    leaveRoom(socket);
  }
}

function removePlayer(room: Room, playerId: 0 | 1): void {
  const timer = room.disconnectTimers[playerId];
  if (timer) clearTimeout(timer);
  room.disconnectTimers[playerId] = null;
  room.clients[playerId] = null;
  room.sessionTokens[playerId] = null;
  room.state = null;
  room.firstTurn = null;
  room.history = [];
  room.undoRequester = null;

  if (!room.clients.some(Boolean) && !room.sessionTokens.some(Boolean)) {
    rooms.delete(room.id);
    return;
  }

  if (!room.clients[0] && room.clients[1] && !room.sessionTokens[0]) {
    const newHost = room.clients[1];
    room.clients = [newHost, null];
    room.sessionTokens = [room.sessionTokens[1], null];
    room.disconnectTimers = [room.disconnectTimers[1], null];
    clients.set(newHost, { room, playerId: 0 });
  }
  room.clients.forEach((peer) => { if (peer) send(peer, { type: 'player_left' }); });
  broadcast(room, 'room_state');
}

function leaveRoom(socket: WebSocket): void {
  const connection = clients.get(socket);
  if (!connection) return;
  clients.delete(socket);
  removePlayer(connection.room, connection.playerId);
}

// 非主动关闭只暂时摘除连接，宽限期内可凭 sessionToken 恢复原席位。
function disconnect(socket: WebSocket): void {
  const connection = clients.get(socket);
  if (!connection) return;
  const { room, playerId } = connection;
  clients.delete(socket);
  room.clients[playerId] = null;
  if (room.disconnectTimers[playerId]) clearTimeout(room.disconnectTimers[playerId]!);
  room.disconnectTimers[playerId] = setTimeout(() => removePlayer(room, playerId), RECONNECT_GRACE_MS);
}

wss.on('connection', (socket) => {
  socket.on('message', (data) => {
    try {
      handleMessage(socket, JSON.parse(data.toString()) as ClientMessage);
    } catch {
      reject(socket, '消息格式无效');
    }
  });
  socket.on('close', () => disconnect(socket));
});

console.log('暗兽棋联机服务端已监听 ws://0.0.0.0:3000');
