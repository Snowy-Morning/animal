// 导入规则函数、常量和游戏类型。
import {
  applyAction,
  canCapture,
  COLS,
  getAllLegalActions,
  getAllRevealActions,
  getPieceAt,
  isCamp,
  revertAction,
  ROWS,
  type Action,
  type Board,
  type GameState,
  type Owner,
  type Piece,
} from '@/game/rules';

// 定义各棋种的静态价值。
export const PIECE_VALUE: Record<string, number> = {
  elephant: 120,
  lion: 95,
  tiger: 85,
  leopard: 65,
  wolf: 45,
  dog: 32,
  cat: 28,
  rat: 70,
};

// 评估一个动作对 AI 的收益。
export function scoreAction(board: Board, action: Action, aiOwner: Owner): number {
  // 翻牌的即时收益保持为较低的随机探索分数。
  if (action.type === 'reveal') {
    return -2;
  }

  const attacker = getPieceAt(board, action.from);
  if (!attacker) {
    return 0;
  }

  // 吃子优先考虑目标价值，同时规避落入威胁。
  if (action.outcome === 'eat') {
    let score = PIECE_VALUE[action.capture!.type];
    if (attacker.type === 'rat' && action.capture!.type === 'elephant') {
      score += 80;
    }
    if (action.capture!.type === 'cat') {
      score += 10;
    }
    return score - threatScore(board, action.to.r, action.to.c, aiOwner, attacker) * 0.6;
  }

  // 同级对死比较双方价值，普通移动则靠近敌方棋子。
  if (action.outcome === 'tie') {
    return (PIECE_VALUE[action.capture!.type] - PIECE_VALUE[attacker.type]) * 0.8 - 5;
  }
  return (
    approachScore(board, action.to, aiOwner) +
    (attacker.type === 'leopard' ? 3 : 0) -
    threatScore(board, action.to.r, action.to.c, aiOwner, attacker) * 0.8
  );
}

// 估算某个位置受到的相邻敌棋威胁。
function threatScore(
  board: Board,
  r: number,
  c: number,
  defenderSide: Owner,
  defenderPiece: Piece,
): number {
  if (isCamp(r, c)) {
    return 0;
  }
  let threat = 0;
  const directions = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ];
  for (const [dr, dc] of directions) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) {
      continue;
    }
    const opponent = board[nr][nc];
    if (!opponent || !opponent.revealed || opponent.owner === defenderSide) {
      continue;
    }
    if (dr !== 0 && dc !== 0 && opponent.type !== 'leopard') {
      continue;
    }
    const result = canCapture(
      opponent,
      defenderPiece,
      board.catOnlyCanCaptureRat !== false,
    );
    if (result === 'eat') {
      threat += PIECE_VALUE[defenderPiece.type] * 0.9;
    } else if (result === 'tie') {
      threat += PIECE_VALUE[defenderPiece.type] * 0.4;
    }
  }
  return threat;
}

// 评估移动到目标位置后接近敌方棋子的收益。
function approachScore(
  board: Board,
  to: { r: number; c: number },
  aiOwner: Owner,
): number {
  const opponent = (3 - aiOwner) as Owner;
  let score = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const piece = board[r][c];
      if (piece?.revealed && piece.owner === opponent) {
        score += Math.max(0, 6 - Math.abs(r - to.r) - Math.abs(c - to.c)) * 0.3;
      }
    }
  }
  return score;
}

// 异步选择 AI 的下一步动作。
export function findBestMove(state: GameState): Promise<Action | null> {
  return new Promise((resolve) => {
    // 固定延迟让思考状态可见，并保持调用接口异步。
    window.setTimeout(() => {
      const owner = state.playerOwners[state.aiPlayerId];
      // 阵营尚未确定时随机翻开一张牌。
      if (owner == null) {
        const actions = getAllRevealActions(state.board);
        resolve(actions.length ? actions[Math.floor(Math.random() * actions.length)] : null);
        return;
      }

      // 计算所有合法动作，并根据难度采用不同决策策略。
      const actions = getAllLegalActions(state.board, owner);
      if (!actions.length) {
        resolve(null);
        return;
      }
      if (state.aiDepth <= 1) {
        const captures = actions.filter((action) => action.type === 'move' && action.outcome === 'eat');
        const choices = captures.length && Math.random() < 0.6 ? captures : actions;
        resolve(choices[Math.floor(Math.random() * choices.length)]);
        return;
      }

      let best = actions[0];
      let bestScore = -Infinity;
      for (const action of actions) {
        let score = scoreAction(state.board, action, owner);
        if (state.aiDepth >= 3) {
          const context = applyAction(state.board, action);
          const opponent = (3 - owner) as Owner;
          const replies = getAllLegalActions(state.board, opponent);
          let opponentScore = 0;
          for (const reply of replies) {
            opponentScore = Math.max(opponentScore, scoreAction(state.board, reply, opponent));
          }
          revertAction(state.board, context);
          score -= opponentScore * 0.65;
        }
        if (score > bestScore) {
          bestScore = score;
          best = action;
        }
      }

      // 评分过低时优先随机翻牌，增加探索性。
      if (bestScore < -5) {
        const reveals = actions.filter((action) => action.type === 'reveal');
        if (reveals.length) {
          best = reveals[Math.floor(Math.random() * reveals.length)];
        }
      }
      resolve(best);
    }, 420);
  });
}
