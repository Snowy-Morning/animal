/* ============================================================
 * ui.js — 暗兽棋渲染与交互（4×4 交叉点 + 暗棋阵营 + 翻牌 + 走/吃/对死）
 * 暗棋机制：谁先翻牌谁获得该颜色阵营，对方自动获得另一颜色
 * 玩家操作：只能操作自己阵营的已翻开棋子
 * ============================================================ */

const pieceElements = new Map();

const $ = (id) => document.getElementById(id);
const boardEl = $('board');

// -------------------- 渲染棋盘 --------------------
function renderBoard() {
  boardEl.innerHTML = '';
  pieceElements.clear();

  // 4×4 = 16 个交叉点（dot）
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const dot = document.createElement('div');
      dot.className = 'dot';
      if (isCamp(r, c)) dot.classList.add('camp');
      dot.style.setProperty('--r', r);
      dot.style.setProperty('--c', c);
      dot.dataset.r = r;
      dot.dataset.c = c;
      boardEl.appendChild(dot);
    }
  }

  // 中央大本营：虚线方框 + 文字标签
  const campBox = document.createElement('div');
  campBox.className = 'camp-box';
  boardEl.appendChild(campBox);

  const campLabel = document.createElement('div');
  campLabel.className = 'camp-label';
  campLabel.textContent = '大本营';
  boardEl.appendChild(campLabel);

  renderPieces();
}

// -------------------- 渲染棋子 --------------------
function renderPieces() {
  boardEl.querySelectorAll('.piece').forEach((el) => el.remove());
  pieceElements.clear();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const piece = state.board[r][c];
      if (piece) {
        const el = createPieceElement(piece, r, c);
        boardEl.appendChild(el);
        pieceElements.set(piece.id, el);
      }
    }
  }
  if (state.board.camp) {
    const el = createPieceElement(state.board.camp, CAMP_POSITION.r, CAMP_POSITION.c, true);
    boardEl.appendChild(el);
    pieceElements.set(state.board.camp.id, el);
  }
}

function createPieceElement(piece, r, c, inCamp = false) {
  const el = document.createElement('div');
  el.className = `piece owner-${piece.owner}`;
  el.style.setProperty('--r', r);
  el.style.setProperty('--c', c);
  el.dataset.id = piece.id;
  el.dataset.r = r;
  el.dataset.c = c;
  if (inCamp) {
    el.dataset.camp = 'true';
    el.classList.add('in-camp');
  }
  if (piece.revealed) el.classList.add('flipped');
  const inner = document.createElement('div');
  inner.className = 'piece-inner';
  const back = document.createElement('div');
  back.className = 'piece-face back';
  const front = document.createElement('div');
  front.className = 'piece-face front';
  front.textContent = PIECE_TYPES[piece.type].char;
  inner.appendChild(back);
  inner.appendChild(front);
  el.appendChild(inner);
  return el;
}

// -------------------- 选中 / 走法提示 --------------------
function selectPiece(r, c) {
  clearSelection();
  const owner = state.playerOwners[state.currentPlayerId];
  const position = isCamp(r, c) ? { ...CAMP_POSITION } : { r, c };
  state.selected = position;
  state.validMoves = getPieceMoves(state.board, r, c, owner);
  const piece = getPieceAt(state.board, position);
  const el = pieceElements.get(piece.id);
  if (el) el.classList.add('selected');
  showHints(state.validMoves);
}

function clearSelection() {
  if (state && state.selected) {
    const piece = getPieceAt(state.board, state.selected);
    if (piece) {
      const el = pieceElements.get(piece.id);
      if (el) el.classList.remove('selected');
    }
  }
  if (state) { state.selected = null; state.validMoves = []; }
  clearHints();
}

function showHints(moves) {
  clearHints();
  for (const move of moves) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    if (move.outcome === 'eat') hint.classList.add('capture');
    else if (move.outcome === 'tie') hint.classList.add('tie');
    hint.style.setProperty('--r', move.to.r);
    hint.style.setProperty('--c', move.to.c);
    hint.dataset.r = move.to.r;
    hint.dataset.c = move.to.c;
    if (move.to.camp) {
      hint.classList.add('camp-hint');
      hint.dataset.camp = 'true';
    }
    boardEl.appendChild(hint);
  }
}

function clearHints() {
  boardEl.querySelectorAll('.hint').forEach((el) => el.remove());
}

// -------------------- 点击处理 --------------------
boardEl.addEventListener('click', (e) => {
  if (!state || state.gameOver) return;
  if (isAnimating || aiThinking) return;
  const isHumanTurn = state.mode === 'pvp' || state.currentPlayerId !== state.aiPlayerId;
  if (!isHumanTurn) return;

  // 双路径命中：点到交叉点(dot)或点到棋子(piece)本身都可解析坐标
  let r = null, c = null;
  const campTarget = e.target.closest('.camp-hint, .camp-box, .piece.in-camp');
  const dot = e.target.closest('.dot');
  if (campTarget) {
    r = Number(campTarget.dataset.r);
    c = Number(campTarget.dataset.c);
  } else if (dot) {
    r = Number(dot.dataset.r);
    c = Number(dot.dataset.c);
  } else {
    const pieceEl = e.target.closest('.piece');
    if (pieceEl) {
      r = Number(pieceEl.dataset.r);
      c = Number(pieceEl.dataset.c);
    }
  }
  if (r == null || c == null || Number.isNaN(r) || Number.isNaN(c)) return;
  handleDotClick(r, c);
});

function handleDotClick(r, c) {
  const position = isCamp(r, c) ? { ...CAMP_POSITION } : { r, c };
  const piece = getPieceAt(state.board, position);
  const playerId = state.currentPlayerId;
  const myOwner = state.playerOwners[playerId];

  // 情况 A：有选中棋子（想走/吃/对死）
  if (state.selected) {
    const move = state.validMoves.find((m) => m.to.r === r && m.to.c === c);
    if (move) { executeAction(move); return; }
    // 点击己方另一已翻棋子 → 改选
    if (piece && piece.revealed && myOwner != null && piece.owner === myOwner) { selectPiece(r, c); return; }
    clearSelection();
    return;
  }

  // 情况 B：无选中
  // 未确定阵营时：可以翻任何牌
  // 已确定阵营时：可以翻任何牌 + 选己方棋子
  if (piece && !piece.revealed) {
    executeAction({ type: 'reveal', r, c, piece });
    return;
  }
  if (piece && piece.revealed && myOwner != null && piece.owner === myOwner) {
    selectPiece(r, c);
    return;
  }
}

// -------------------- 执行动作 --------------------
let isAnimating = false;
let aiThinking = false;

function executeAction(action) {
  isAnimating = true;
  clearSelection();

  const playerId = state.currentPlayerId;
  const histEntry = {
    action,
    revertCtx: null,
    prevPlayerId: playerId,
    prevPlayerOwners: [state.playerOwners[0], state.playerOwners[1]],
    prevTurn: state.turnCount,
    captured: [],
    prevLastRevealedOwner: state.lastRevealedOwner,
  };

  if (action.type === 'reveal') {
    execReveal(action, histEntry);
  } else if (action.type === 'move') {
    if (action.outcome === 'tie') execTie(action, histEntry);
    else execMoveOrEat(action, histEntry);
  }
}

function finishAfterAction(histEntry) {
  // 调用 afterAction 更新阵营和回合
  afterAction(state, histEntry.action);

  // 保存历史（此时 playerOwners 已更新）
  histEntry.currPlayerOwners = [state.playerOwners[0], state.playerOwners[1]];
  histEntry.revertPlayerOwners = [histEntry.prevPlayerOwners[0], histEntry.prevPlayerOwners[1]];
  state.history.push(histEntry);

  setTimeout(() => {
    isAnimating = false;
    updatePanel();
    if (state.gameOver) {
      showGameOver(state.winner);
      return;
    }
    if (state.mode === 'pve' && state.currentPlayerId === state.aiPlayerId) triggerAI();
  }, 400);
}

function execReveal(action, histEntry) {
  const ctx = applyAction(state.board, action);
  histEntry.revertCtx = ctx;
  const piece = state.board[action.r][action.c];
  const el = pieceElements.get(piece.id);
  if (el) el.classList.add('flipped');
  finishAfterAction(histEntry);
}

function execMoveOrEat(action, histEntry) {
  const ctx = applyAction(state.board, action);
  histEntry.revertCtx = ctx;
  const moverPiece = ctx.info.mover;
  const targetPiece = ctx.info.target;

  const moverEl = pieceElements.get(moverPiece.id);
  if (moverEl) {
    moverEl.style.setProperty('--r', action.to.r);
    moverEl.style.setProperty('--c', action.to.c);
    moverEl.dataset.r = action.to.r;
    moverEl.dataset.c = action.to.c;
    moverEl.classList.toggle('in-camp', !!action.to.camp);
    if (action.to.camp) moverEl.dataset.camp = 'true';
    else delete moverEl.dataset.camp;
  }
  if (targetPiece) {
    state.captured[targetPiece.owner].push({ ...targetPiece });
    histEntry.captured.push({ piece: targetPiece, owner: targetPiece.owner });
    const tEl = pieceElements.get(targetPiece.id);
    if (tEl) {
      setTimeout(() => {
        tEl.classList.add('captured');
        setTimeout(() => { tEl.remove(); }, 320);
      }, 220);
      pieceElements.delete(targetPiece.id);
    }
  }
  finishAfterAction(histEntry);
}

function execTie(action, histEntry) {
  const ctx = applyAction(state.board, action);
  histEntry.revertCtx = ctx;
  const moverPiece = ctx.info.mover;
  const targetPiece = ctx.info.target;

  state.captured[moverPiece.owner].push({ ...moverPiece });
  state.captured[targetPiece.owner].push({ ...targetPiece });
  histEntry.captured.push({ piece: moverPiece, owner: moverPiece.owner });
  histEntry.captured.push({ piece: targetPiece, owner: targetPiece.owner });

  const moverEl = pieceElements.get(moverPiece.id);
  if (moverEl) {
    moverEl.style.setProperty('--r', action.to.r);
    moverEl.style.setProperty('--c', action.to.c);
    moverEl.dataset.r = action.to.r;
    moverEl.dataset.c = action.to.c;
    moverEl.classList.toggle('in-camp', !!action.to.camp);
    if (action.to.camp) moverEl.dataset.camp = 'true';
    else delete moverEl.dataset.camp;
    moverEl.classList.add('tie-attacker');
  }
  const tEl = pieceElements.get(targetPiece.id);
  if (tEl) {
    setTimeout(() => {
      tEl.classList.add('captured', 'tie-victim');
      if (moverEl) moverEl.classList.add('captured', 'tie-victim');
      setTimeout(() => {
        if (moverEl) moverEl.remove();
        if (tEl) tEl.remove();
      }, 360);
    }, 220);
  }
  pieceElements.delete(moverPiece.id);
  pieceElements.delete(targetPiece.id);

  finishAfterAction(histEntry);
}

// -------------------- AI --------------------
function triggerAI() {
  aiThinking = true;
  $('ai-thinking').classList.remove('hidden');
  AI.findBestMove(state, (action) => {
    $('ai-thinking').classList.add('hidden');
    aiThinking = false;
    if (action) executeAction(action);
    else {
      state.gameOver = true;
      const aiOwner = state.playerOwners[state.aiPlayerId];
      state.winner = 3 - aiOwner;
      showGameOver(state.winner);
    }
  });
}

// -------------------- 悔棋 --------------------
function undo() {
  if (!state || isAnimating || aiThinking || state.history.length === 0) return;
  if (state.mode === 'pve' && !state.gameOver && state.currentPlayerId === state.aiPlayerId) return;
  if (state.gameOver) {
    state.gameOver = false;
    state.winner = null;
    $('game-over').classList.add('hidden');
  }
  // 悔棋需要回退玩家 + AI 两步
  const steps = (state.mode === 'pve' && state.history.length >= 2) ? 2 : 1;
  for (let i = 0; i < steps; i++) {
    if (state.history.length === 0) break;
    const rec = state.history.pop();
    revertAction(state.board, rec.revertCtx);
    for (const cap of rec.captured) {
      const list = state.captured[cap.owner];
      const idx = list.findIndex((p) => p.id === cap.piece.id);
      if (idx >= 0) list.splice(idx, 1);
    }
    // 恢复玩家状态
    state.playerOwners = [rec.prevPlayerOwners[0], rec.prevPlayerOwners[1]];
    state.currentPlayerId = rec.prevPlayerId;
    state.turnCount = rec.prevTurn;
    state.lastRevealedOwner = rec.prevLastRevealedOwner;
  }
  clearSelection();
  renderPieces();
  updatePanel();
  if (state.mode === 'pve' && !state.gameOver && state.currentPlayerId === state.aiPlayerId) triggerAI();
}

// -------------------- 面板更新 --------------------
function updatePanel() {
  const playerId = state.currentPlayerId;
  const owner = state.playerOwners[playerId];
  const ownerLabel = owner == null ? '（未确定）' : (owner === 1 ? '红方' : '黑方');
  const ownerClass = owner == null ? 'neutral' : (owner === 1 ? 'red' : 'black');

  // 显示当前玩家是谁
  const isHumanTurn = state.mode === 'pvp' || playerId !== state.aiPlayerId;
  const playerLabel = state.mode === 'pvp'
    ? (playerId === 0 ? '玩家1' : '玩家2')
    : (playerId === state.aiPlayerId ? 'AI' : '你');

  // 更新回合指示
  const dotEl = $('turn-dot');
  dotEl.className = 'turn-dot ' + (owner == null ? 'neutral' : ownerClass);
  $('turn-text').textContent = `${playerLabel}(${ownerLabel})行棋`;

  $('move-count').textContent = state.turnCount + 1;

  // 操作提示
  const hintEl = $('action-hint');
  if (owner == null) {
    hintEl.textContent = '阵营未确定：翻开一张牌以决定你的颜色';
  } else {
    hintEl.textContent = `可选：翻一张未知牌 / 移动己方${ownerLabel}棋子（豹可斜飞 / 同级对死）`;
  }

  // 更新俘获列表
  renderCaptured(1);
  renderCaptured(2);
  $('alive-1').textContent = countAlive(state.board, 1);
  $('alive-2').textContent = countAlive(state.board, 2);

  // 更新双方阵营显示
  const p1Label = state.playerOwners[0] == null
    ? '玩家1：未确定'
    : `玩家1：${state.playerOwners[0] === 1 ? '红方' : '黑方'}`;
  const p2Label = state.playerOwners[1] == null
    ? '玩家2：未确定'
    : `玩家2：${state.playerOwners[1] === 1 ? '红方' : '黑方'}`;
  // 简单地在面板上显示
  if (playerId === 0) {
    $('turn-info').title = p1Label;
  } else {
    $('turn-info').title = p2Label;
  }
}

function renderCaptured(owner) {
  const el = $('captured-' + owner);
  el.innerHTML = '';
  for (const piece of state.captured[owner]) {
    const cap = document.createElement('div');
    cap.className = 'cap-piece ' + (owner === 1 ? 'red' : 'black');
    cap.textContent = PIECE_TYPES[piece.type].char;
    el.appendChild(cap);
  }
}

// -------------------- 结算 --------------------
function showGameOver(winner) {
  const el = $('winner-text');
  el.textContent = winner === 1 ? '红方胜' : '黑方胜';
  el.className = 'winner-text ' + (winner === 1 ? 'red' : 'black');
  $('game-over').classList.remove('hidden');
}

// -------------------- 开局 / 重开 / 返回菜单 --------------------
function startGame(mode, aiPlayerId, aiDepth) {
  state = createState(mode, aiPlayerId, aiDepth);
  isAnimating = false;
  aiThinking = false;
  $('start-screen').classList.add('hidden');
  $('game-over').classList.add('hidden');
  $('ai-thinking').classList.add('hidden');
  $('game-screen').classList.remove('hidden');
  renderBoard();
  updatePanel();
  if (mode === 'pve' && state.currentPlayerId === state.aiPlayerId) triggerAI();
}

function returnToMenu() {
  $('game-screen').classList.add('hidden');
  $('game-over').classList.add('hidden');
  $('ai-thinking').classList.add('hidden');
  $('start-screen').classList.remove('hidden');
  state = null;
}

// -------------------- 事件绑定 --------------------
function init() {
  document.querySelectorAll('input[name=mode]').forEach((input) => {
    input.addEventListener('change', () => {
      const pve = document.querySelector('input[name=mode]:checked').value === 'pve';
      $('pve-options').classList.toggle('hidden', !pve);
    });
  });
  $('btn-start').addEventListener('click', () => {
    const mode = document.querySelector('input[name=mode]:checked').value;
    let aiPlayerId = 1;
    let aiDepth = 2;
    if (mode === 'pve') {
      aiDepth = parseInt(document.querySelector('input[name=diff]:checked').value, 10);
    }
    startGame(mode, aiPlayerId, aiDepth);
  });
  $('btn-undo').addEventListener('click', undo);
  $('btn-restart').addEventListener('click', () => {
    if (state) startGame(state.mode, state.aiPlayerId, state.aiDepth);
  });
  $('btn-menu').addEventListener('click', returnToMenu);
  $('btn-again').addEventListener('click', () => {
    if (state) startGame(state.mode, state.aiPlayerId, state.aiDepth);
  });
  $('btn-back-menu').addEventListener('click', returnToMenu);
}

init();
