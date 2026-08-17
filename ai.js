/* ============================================================
 * ai.js — 暗兽棋 AI（4×4 交叉点 + 暗棋阵营 + 对死规则）
 * 暗棋机制：谁先翻牌谁获得该颜色阵营
 * AI 策略：
 *   1. 阵营未确定时：随机翻一张牌，根据翻出的颜色确定自己的阵营
 *   2. 阵营确定后：基于启发式评分选择最优走棋/吃棋/对死动作
 * ============================================================ */

const PIECE_VALUE = {
  elephant: 120, lion: 95, tiger: 85, leopard: 65,
  wolf: 45, dog: 32, cat: 28, rat: 70,
};

/** 对单个 action 的静态评分 */
function scoreAction(board, action, aiOwner) {
  if (action.type === 'move') {
    const attacker = getPieceAt(board, action.from);

    if (action.outcome === 'eat') {
      let s = PIECE_VALUE[action.capture.type];
      if (attacker.type === 'rat' && action.capture.type === 'elephant') s += 80;
      if (action.capture.type === 'cat') s += 10;
      s -= threatScore(board, action.to.r, action.to.c, aiOwner, attacker) * 0.6;
      return s;
    }

    if (action.outcome === 'tie') {
      const myValue = PIECE_VALUE[attacker.type];
      const oppValue = PIECE_VALUE[action.capture.type];
      let s = (oppValue - myValue) * 0.8;
      if (myValue > oppValue) s -= (myValue - oppValue) * 0.5;
      if (myValue === oppValue) s -= 5;
      return s;
    }

    if (action.outcome === 'move') {
      let s = 0;
      s += approachScore(board, action.to, aiOwner);
      if (attacker.type === 'leopard') s += 3;
      s -= threatScore(board, action.to.r, action.to.c, aiOwner, attacker) * 0.8;
      return s;
    }
  }
  if (action.type === 'reveal') {
    return -2;
  }
  return 0;
}

/** 评估威胁分数 */
function threatScore(board, r, c, defenderSide, defenderPiece) {
  if (isCamp(r, c)) return 0;
  let threat = 0;
  const DIRS = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
  for (const [dr, dc] of DIRS) {
    const nr = r + dr, nc = c + dc;
    if (nr<0||nr>=ROWS||nc<0||nc>=COLS) continue;
    const opp = board[nr][nc];
    if (!opp || !opp.revealed || opp.owner === defenderSide) continue;
    const isDiagonal = (dr !== 0 && dc !== 0);
    if (isDiagonal && opp.type !== 'leopard') continue;
    const cap = canCapture(opp, defenderPiece);
    if (cap === 'eat') threat += PIECE_VALUE[defenderPiece.type] * 0.9;
    else if (cap === 'tie') threat += PIECE_VALUE[defenderPiece.type] * 0.4;
  }
  return threat;
}

/** 靠近对方已翻开弱子加分 */
function approachScore(board, to, aiOwner) {
  const opp = 3 - aiOwner;
  let s = 0;
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) {
    const p = board[r][c];
    if (!p || !p.revealed || p.owner !== opp) continue;
    const dist = Math.abs(r-to.r) + Math.abs(c-to.c);
    s += Math.max(0, (6 - dist)) * 0.3;
  }
  return s;
}

/** AI 入口：返回最优 action */
function findBestMove(state, callback) {
  setTimeout(() => {
    const aiOwner = state.playerOwners[state.aiPlayerId];

    if (aiOwner == null) {
      // 阵营未确定：翻一张牌（获得颜色）
      const reveals = getAllRevealActions(state.board);
      if (reveals.length === 0) { callback(null); return; }
      // 随机翻一张（避免作弊）
      const action = reveals[Math.floor(Math.random() * reveals.length)];
      callback(action);
      return;
    }

    // 阵营已确定：枚举所有合法动作
    const actions = getAllLegalActions(state.board, aiOwner);
    if (actions.length === 0) { callback(null); return; }

    let bestAction = actions[0];
    let bestScore = -Infinity;
    for (const act of actions) {
      const s = scoreAction(state.board, act, aiOwner);
      if (s > bestScore) { bestScore = s; bestAction = act; }
    }

    // 最佳分数低于阈值 → 翻牌
    if (bestScore < -5) {
      const reveals = actions.filter(a => a.type === 'reveal');
      if (reveals.length) {
        bestAction = reveals[Math.floor(Math.random() * reveals.length)];
      }
    }

    // 翻牌动作随机选
    if (bestAction.type === 'reveal') {
      const reveals = actions.filter(a => a.type === 'reveal');
      bestAction = reveals[Math.floor(Math.random() * reveals.length)];
    }

    callback(bestAction);
  }, 80);
}

const AI = { PIECE_VALUE, scoreAction, findBestMove };
if (typeof window !== 'undefined') window.AI = AI;
