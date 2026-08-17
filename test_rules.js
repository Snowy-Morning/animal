/* test_rules.js — 暗兽棋规则单元测试（Node，vm 加载 game.js）
 * 棋盘：3×3 方格的 4×4 交叉点（共 16 点）
 * 暗棋阵营：无固定先手，谁先翻牌谁获该颜色阵营
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const gameSrc = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8');
const sandbox = { window: {}, console, Math, Object };
vm.createContext(sandbox);
vm.runInContext(gameSrc, sandbox);

const { ROWS, COLS, PIECE_TYPES, isCamp, campPieceCount, createBoard, canCapture, getPieceMoves,
        applyAction, revertAction, checkWinner, countAlive,
        getAllLegalActions, createState, afterAction } = sandbox.window.Game;

let PASS = 0, FAIL = 0;
function test(name, cond, info) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; console.log('  ✗ ' + name + (info ? ' — ' + info : '')); }
}

function makeBoard(pieces) {
  const b = Array.from({length: ROWS}, () => Array(COLS).fill(null));
  for (const p of pieces) b[p.r][p.c] = p;
  return b;
}
function findMove(moves, r, c) { return moves.find(m => m.to.r === r && m.to.c === c); }

console.log('\n[1] 棋盘与初始散子（4×4 交叉点）');
{
  const b = createBoard();
  let pc = 0, hidden = 0;
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) {
    if (b[r][c]) { pc++; if (!b[r][c].revealed) hidden++; }
  }
  test('4×4=16 个交叉点', ROWS === 4 && COLS === 4);
  test('初始 16 颗棋子散布', pc === 16);
  test('全部背面朝上', hidden === 16);
  test('红黑各 8 子', countAlive(b, 1) === 8 && countAlive(b, 2) === 8);
}

console.log('\n[2] 大本营判定（中央 1 方格 = 4 交叉点）');
{
  test('(0,0) 不是大本营', !isCamp(0, 0));
  test('(0,3) 不是大本营', !isCamp(0, 3));
  test('(3,0) 不是大本营', !isCamp(3, 0));
  test('(3,3) 不是大本营', !isCamp(3, 3));
  test('(1,1) 是大本营(左上)', isCamp(1, 1));
  test('(1,2) 是大本营(右上)', isCamp(1, 2));
  test('(2,1) 是大本营(左下)', isCamp(2, 1));
  test('(2,2) 是大本营(右下)', isCamp(2, 2));
  test('(0,1) 不是大本营', !isCamp(0, 1));
  test('(2,3) 不是大本营', !isCamp(2, 3));
  test('大本营共 4 个交叉点', (() => {
    let n = 0;
    for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) if (isCamp(r,c)) n++;
    return n === 4;
  })());
}

console.log('\n[3] 翻牌规则');
{
  const b = createBoard();
  let pr = 0, pc = 0;
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) if (b[r][c]) { pr=r; pc=c; break; }
  const piece = b[pr][pc];
  test('初始未翻开', !piece.revealed);
  const prev = piece.revealed;
  applyAction(b, { type: 'reveal', r: pr, c: pc, piece });
  test('翻牌后已翻开', piece.revealed === true);
  const ctx = { info: { type:'reveal', r: pr, c: pc, wasRevealed: prev } };
  revertAction(b, ctx);
  test('回退后恢复未翻开', !piece.revealed);
}

console.log('\n[4] 吃子规则 — 等级制');
{
  const b = makeBoard([
    { r:0,c:0, owner:1, type:'elephant', rank:8, revealed:true },
    { r:0,c:1, owner:2, type:'lion',     rank:7, revealed:true },
  ]);
  test('象能吃狮', canCapture(b[0][0], b[0][1]) === 'eat');

  const b3 = makeBoard([
    { r:0,c:0, owner:1, type:'dog', rank:3, revealed:true },
    { r:0,c:1, owner:2, type:'tiger', rank:6, revealed:true },
  ]);
  test('狗不能吃虎', canCapture(b3[0][0], b3[0][1]) === 'no');
}

console.log('\n[5] ★ 同级对死（核心新规则）');
{
  const b = makeBoard([
    { r:0,c:0, owner:1, type:'wolf', rank:4, revealed:true },
    { r:0,c:1, owner:2, type:'wolf', rank:4, revealed:true },
  ]);
  test('狼vs狼 → 对死(tie)', canCapture(b[0][0], b[0][1]) === 'tie');

  const b2 = makeBoard([
    { r:0,c:0, owner:1, type:'elephant', rank:8, revealed:true },
    { r:0,c:1, owner:2, type:'elephant', rank:8, revealed:true },
  ]);
  test('象vs象 → 对死(tie)', canCapture(b2[0][0], b2[0][1]) === 'tie');

  const b3 = makeBoard([
    { r:0,c:0, owner:1, type:'rat', rank:1, revealed:true },
    { r:0,c:1, owner:2, type:'rat', rank:1, revealed:true },
  ]);
  test('鼠vs鼠 → 对死(tie)', canCapture(b3[0][0], b3[0][1]) === 'tie');

  const moves = getPieceMoves(b, 0, 0);
  const tieMove = findMove(moves, 0, 1);
  test('狼走法含对死走法', tieMove && tieMove.outcome === 'tie');
  test('同级不再返回 eat', canCapture(b[0][0], b[0][1]) !== 'eat');
}

console.log('\n[6] 特殊规则 — 只有猫能吃鼠');
{
  const b = makeBoard([
    { r:0,c:0, owner:1, type:'cat', rank:2, revealed:true },
    { r:0,c:1, owner:2, type:'rat', rank:1, revealed:true },
  ]);
  test('猫能吃鼠', canCapture(b[0][0], b[0][1]) === 'eat');

  const b2 = makeBoard([
    { r:0,c:0, owner:1, type:'elephant', rank:8, revealed:true },
    { r:0,c:1, owner:2, type:'rat', rank:1, revealed:true },
  ]);
  test('象不能吃鼠', canCapture(b2[0][0], b2[0][1]) === 'no');

  const b3 = makeBoard([
    { r:0,c:0, owner:1, type:'lion', rank:7, revealed:true },
    { r:0,c:1, owner:2, type:'rat', rank:1, revealed:true },
  ]);
  test('狮不能吃鼠', canCapture(b3[0][0], b3[0][1]) === 'no');

  const b4 = makeBoard([
    { r:0,c:0, owner:1, type:'leopard', rank:5, revealed:true },
    { r:0,c:1, owner:2, type:'rat', rank:1, revealed:true },
  ]);
  test('豹不能吃鼠', canCapture(b4[0][0], b4[0][1]) === 'no');

  const b5 = makeBoard([
    { r:0,c:0, owner:1, type:'wolf', rank:4, revealed:true },
    { r:0,c:1, owner:2, type:'rat', rank:1, revealed:true },
  ]);
  test('狼不能吃鼠', canCapture(b5[0][0], b5[0][1]) === 'no');
}

console.log('\n[7] 特殊规则 — 鼠能吃象');
{
  const b = makeBoard([
    { r:0,c:0, owner:1, type:'rat', rank:1, revealed:true },
    { r:0,c:1, owner:2, type:'elephant', rank:8, revealed:true },
  ]);
  test('鼠能吃象', canCapture(b[0][0], b[0][1]) === 'eat');
  test('鼠不能吃未翻的象', (() => {
    b[0][1].revealed = false;
    return canCapture(b[0][0], b[0][1]) === 'no';
  })());
}

console.log('\n[8] 走法 — 普通棋子正交 4 方向');
{
  const b = makeBoard([
    { r:1,c:1, owner:1, type:'wolf', rank:4, revealed:true },
  ]);
  const moves = getPieceMoves(b, 1, 1);
  test('狼在大本营有 4 个方向走法', moves.length === 4, `实际 ${moves.length}`);
  const dirs = moves.map(m => `${m.to.r},${m.to.c}`).sort();
  test('狼走法为上下左右', JSON.stringify(dirs) === JSON.stringify(['0,1','1,0','1,2','2,1']));
}

console.log('\n[9] 走法 — 豹可斜向飞（8 方向）');
{
  const b = makeBoard([
    { r:1,c:1, owner:1, type:'leopard', rank:5, revealed:true },
  ]);
  const moves = getPieceMoves(b, 1, 1);
  test('豹在中心有 8 个方向走法', moves.length === 8, `实际 ${moves.length}`);
  const dirs = moves.map(m => `${m.to.r},${m.to.c}`).sort();
  test('豹走法含 4 斜向', dirs.includes('0,0') && dirs.includes('0,2') && dirs.includes('2,0') && dirs.includes('2,2'));
}

console.log('\n[10] 走法 — 边界截断');
{
  const b = makeBoard([
    { r:0,c:0, owner:1, type:'wolf', rank:4, revealed:true },
  ]);
  const moves = getPieceMoves(b, 0, 0);
  test('左上角狼只有 2 个走法', moves.length === 2, `实际 ${moves.length}`);

  const b2 = makeBoard([
    { r:0,c:0, owner:1, type:'leopard', rank:5, revealed:true },
  ]);
  const moves2 = getPieceMoves(b2, 0, 0);
  test('左上角豹只有 3 个走法(2正+1斜)', moves2.length === 3, `实际 ${moves2.length}`);

  const b3 = makeBoard([
    { r:3,c:3, owner:1, type:'leopard', rank:5, revealed:true },
  ]);
  const moves3 = getPieceMoves(b3, 3, 3);
  test('右下角豹只有 3 个走法', moves3.length === 3, `实际 ${moves3.length}`);
}

console.log('\n[11] 走法 — 吃子走法');
{
  const b = makeBoard([
    { r:1,c:1, owner:1, type:'elephant', rank:8, revealed:true },
    { r:1,c:2, owner:2, type:'lion', rank:7, revealed:true },
    { r:2,c:1, owner:2, type:'rat', rank:1, revealed:true },
  ]);
  const moves = getPieceMoves(b, 1, 1);
  const eatLion = findMove(moves, 1, 2);
  test('象能吃狮(eat)', eatLion && eatLion.outcome === 'eat');
  const ratMove = findMove(moves, 2, 1);
  test('象不能吃鼠(无走法)', !ratMove);
}

console.log('\n[12] 走法 — 豹斜吃');
{
  const b = makeBoard([
    { r:1,c:1, owner:1, type:'leopard', rank:5, revealed:true },
    { r:2,c:2, owner:2, type:'dog', rank:3, revealed:true },
  ]);
  const moves = getPieceMoves(b, 1, 1);
  const diagEat = findMove(moves, 2, 2);
  test('豹能斜吃对角弱子', diagEat && diagEat.outcome === 'eat');
}

console.log('\n[13] 走法 — 鼠不能斜走');
{
  const b = makeBoard([
    { r:1,c:1, owner:1, type:'rat', rank:1, revealed:true },
  ]);
  const moves = getPieceMoves(b, 1, 1);
  test('鼠只有 4 个方向', moves.length === 4, `实际 ${moves.length}`);
  const hasDiag = moves.some(m => Math.abs(m.to.r - 1) === 1 && Math.abs(m.to.c - 1) === 1);
  test('鼠不能斜走', !hasDiag);
}

console.log('\n[14] 执行与回退 — move');
{
  const b = makeBoard([
    { r:1,c:1, owner:1, type:'wolf', rank:4, revealed:true },
  ]);
  const action = { type:'move', from:{r:1,c:1}, to:{r:1,c:2}, capture:null, outcome:'move' };
  const ctx = applyAction(b, action);
  test('移动后原位置空', b[1][1] === null);
  test('移动后新位置有狼', b[1][2] && b[1][2].type === 'wolf');
  revertAction(b, ctx);
  test('回退后原位置有狼', b[1][1] && b[1][1].type === 'wolf');
  test('回退后新位置空', b[1][2] === null);
}

console.log('\n[15] 执行与回退 — eat');
{
  const b = makeBoard([
    { r:1,c:1, owner:1, type:'elephant', rank:8, revealed:true },
    { r:1,c:2, owner:2, type:'tiger', rank:6, revealed:true },
  ]);
  const action = { type:'move', from:{r:1,c:1}, to:{r:1,c:2}, capture:b[1][2], outcome:'eat' };
  const ctx = applyAction(b, action);
  test('吃子后原位置空', b[1][1] === null);
  test('吃子后象在新位置', b[1][2] && b[1][2].type === 'elephant');
  revertAction(b, ctx);
  test('回退后原位置有象', b[1][1] && b[1][1].type === 'elephant');
  test('回退后虎在原位', b[1][2] && b[1][2].type === 'tiger');
}

console.log('\n[16] ★ 执行与回退 — tie（对死）');
{
  const b = makeBoard([
    { r:1,c:1, owner:1, type:'wolf', rank:4, revealed:true },
    { r:1,c:2, owner:2, type:'wolf', rank:4, revealed:true },
  ]);
  const action = { type:'move', from:{r:1,c:1}, to:{r:1,c:2}, capture:b[1][2], outcome:'tie' };
  const ctx = applyAction(b, action);
  test('对死后攻击方位置空', b[1][1] === null);
  test('对死后防御方位置也空', b[1][2] === null);
  let aliveWolves = 0;
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) if (b[r][c]?.type === 'wolf') aliveWolves++;
  test('对死后双方狼都消失', aliveWolves === 0);
  revertAction(b, ctx);
  test('回退后攻击方狼复活', b[1][1] && b[1][1].type === 'wolf' && b[1][1].owner === 1);
  test('回退后防御方狼复活', b[1][2] && b[1][2].type === 'wolf' && b[1][2].owner === 2);
}

console.log('\n[17] 胜负 — 吃光对方');
{
  const b = makeBoard([
    { r:1,c:1, owner:1, type:'elephant', rank:8, revealed:true },
  ]);
  test('只有红方存活', countAlive(b, 1) === 1 && countAlive(b, 2) === 0);
  const w = checkWinner(b, 1, 2);
  test('红方胜', w === 1);
}

console.log('\n[18] 鼠的特殊保护 — 综合验证');
{
  const b = makeBoard([
    { r:1,c:1, owner:2, type:'rat', rank:1, revealed:true },
    { r:0,c:1, owner:1, type:'elephant', rank:8, revealed:true },
    { r:1,c:0, owner:1, type:'lion', rank:7, revealed:true },
    { r:1,c:2, owner:1, type:'tiger', rank:6, revealed:true },
    { r:2,c:1, owner:1, type:'leopard', rank:5, revealed:true },
  ]);
  test('象不能吃鼠(综合)', canCapture(b[0][1], b[1][1]) === 'no');
  test('狮不能吃鼠(综合)', canCapture(b[1][0], b[1][1]) === 'no');
  test('虎不能吃鼠(综合)', canCapture(b[1][2], b[1][1]) === 'no');
  test('豹不能吃鼠(综合)', canCapture(b[2][1], b[1][1]) === 'no');
}

console.log('\n[19] 对死 vs 普通吃子 — 区分');
{
  const b = makeBoard([
    { r:0,c:0, owner:1, type:'wolf', rank:4, revealed:true },
    { r:0,c:1, owner:2, type:'wolf', rank:4, revealed:true },
  ]);
  test('狼vs狼=tie', canCapture(b[0][0], b[0][1]) === 'tie');

  const b2 = makeBoard([
    { r:0,c:0, owner:1, type:'wolf', rank:4, revealed:true },
    { r:0,c:1, owner:2, type:'cat', rank:2, revealed:true },
  ]);
  test('狼吃猫=eat(非tie)', canCapture(b2[0][0], b2[0][1]) === 'eat');

  const b3 = makeBoard([
    { r:0,c:0, owner:1, type:'rat', rank:1, revealed:true },
    { r:0,c:1, owner:2, type:'rat', rank:1, revealed:true },
  ]);
  test('鼠vs鼠=tie(同级对死)', canCapture(b3[0][0], b3[0][1]) === 'tie');
}

console.log('\n[20] 合法动作枚举');
{
  const b = createBoard();
  const acts = getAllLegalActions(b, 1);
  const reveals = acts.filter(a => a.type === 'reveal');
  const moves = acts.filter(a => a.type === 'move');
  test('初始只有翻牌动作(16)', reveals.length === 16 && moves.length === 0, `reveals=${reveals.length} moves=${moves.length}`);
}

console.log('\n[21] 象不能吃鼠 — 走法生成验证');
{
  const b = makeBoard([
    { r:1,c:1, owner:1, type:'elephant', rank:8, revealed:true },
    { r:1,c:2, owner:2, type:'rat', rank:1, revealed:true },
  ]);
  const moves = getPieceMoves(b, 1, 1);
  const ratMove = findMove(moves, 1, 2);
  test('象走法中不含吃鼠', !ratMove);
  const otherMoves = moves.filter(m => m.outcome === 'move');
  test('象仍有其他走法', otherMoves.length > 0);
}

console.log('\n[22] 只有猫能吃鼠 — 走法生成验证');
{
  const b = makeBoard([
    { r:1,c:1, owner:1, type:'cat', rank:2, revealed:true },
    { r:1,c:2, owner:2, type:'rat', rank:1, revealed:true },
  ]);
  const catMoves = getPieceMoves(b, 1, 1);
  test('猫走法含吃鼠', !!findMove(catMoves, 1, 2));
}

console.log('\n[23] 鼠能吃象 — 走法生成验证');
{
  const b = makeBoard([
    { r:1,c:1, owner:1, type:'rat', rank:1, revealed:true },
    { r:1,c:2, owner:2, type:'elephant', rank:8, revealed:true },
  ]);
  const moves = getPieceMoves(b, 1, 1);
  test('鼠走法含吃象', !!findMove(moves, 1, 2));
}

console.log('\n[24] 对死走法生成验证');
{
  const b = makeBoard([
    { r:1,c:1, owner:1, type:'elephant', rank:8, revealed:true },
    { r:1,c:2, owner:2, type:'elephant', rank:8, revealed:true },
  ]);
  const moves = getPieceMoves(b, 1, 1);
  const tieMove = findMove(moves, 1, 2);
  test('象走法含对死', tieMove && tieMove.outcome === 'tie');
}

console.log('\n[25] 大本营内棋子正常行动');
{
  const b = makeBoard([
    { r:1,c:1, owner:1, type:'wolf', rank:4, revealed:true },
  ]);
  test('狼在大本营(1,1)', isCamp(1, 1));
  const moves = getPieceMoves(b, 1, 1);
  test('大本营内狼有 4 个走法', moves.length === 4, `实际 ${moves.length}`);
  const toCamp = moves.filter(m => isCamp(m.to.r, m.to.c));
  test('其中 2 个走法去大本营内', toCamp.length === 2);
}

console.log('\n[25b] ★★ 大本营容量限制（一次最多 1 颗）');
{
  // 空大本营：外围狼可以进入
  const b1 = makeBoard([
    { r:0,c:1, owner:1, type:'wolf', rank:4, revealed:true },  // 大本营上方
  ]);
  test('空大本营计数=0', campPieceCount(b1) === 0);
  const moves1 = getPieceMoves(b1, 0, 1);
  const enterCamp = moves1.find(m => m.to.r === 1 && m.to.c === 1);
  test('外围狼可进入空大本营', !!enterCamp, '应该能进入');

  // 大本营已有1颗棋子：外围棋子不能再进入
  const b2 = makeBoard([
    { r:0,c:1, owner:1, type:'wolf', rank:4, revealed:true },  // 外围
    { r:1,c:1, owner:1, type:'cat', rank:2, revealed:true },   // 大本营内已有1颗
  ]);
  test('大本营计数=1', campPieceCount(b2) === 1);
  const moves2 = getPieceMoves(b2, 0, 1);
  const enterCamp2 = moves2.find(m => isCamp(m.to.r, m.to.c));
  test('大本营已有1颗时外围棋子不可进入', !enterCamp2, '应该被阻止');

  // 大本营内棋子可以在大本营4个交叉点间移动（总数不变）
  const moves3 = getPieceMoves(b2, 1, 1);
  const withinCamp = moves3.filter(m => isCamp(m.to.r, m.to.c));
  test('大本营内棋子可移到大本营其他交叉点', withinCamp.length > 0, `实际 ${withinCamp.length}`);
}

console.log('\n[25c] ★★ 大本营内棋子受保护（敌方不能吃/碰）');
{
  // 大本营内红方象，大本营外黑方狮：黑方狮不能吃大本营内的象
  const b = makeBoard([
    { r:1,c:1, owner:1, type:'elephant', rank:8, revealed:true },  // 大本营内红方象
    { r:0,c:1, owner:2, type:'lion', rank:7, revealed:true },      // 大本营上方黑方狮
  ]);
  test('象在大本营内', isCamp(1, 1));
  test('狮在大本营外', !isCamp(0, 1));
  test('狮等级低于象(象吃狮)', canCapture(b[1][1], b[0][1]) === 'eat');
  test('狮不能吃象(等级低)', canCapture(b[0][1], b[1][1]) === 'no');

  // 黑方狮走法：不能进入大本营吃象（即使能吃也不能）
  const lionMoves = getPieceMoves(b, 0, 1);
  const attackCamp = lionMoves.find(m => m.to.r === 1 && m.to.c === 1);
  test('敌方狮不能攻击大本营内象', !attackCamp, '应该被保护');

  // 同级对死也被阻止：大本营内狼 vs 大本营外狼
  const b2 = makeBoard([
    { r:1,c:1, owner:1, type:'wolf', rank:4, revealed:true },  // 大本营内红狼
    { r:0,c:1, owner:2, type:'wolf', rank:4, revealed:true },  // 大本营外黑狼
  ]);
  test('狼vs狼=tie(同级)', canCapture(b2[0][1], b2[1][1]) === 'tie');
  const wolfMoves = getPieceMoves(b2, 0, 1);
  const tieCamp = wolfMoves.find(m => m.to.r === 1 && m.to.c === 1);
  test('敌方狼不能对死大本营内狼', !tieCamp, '应该被保护');
}

console.log('\n[25d] ★★ 大本营内棋子可吃大本营四周敌方');
{
  // 大本营内红方象，四周有黑方狮（大本营外）：象可以出击吃狮
  const b = makeBoard([
    { r:1,c:1, owner:1, type:'elephant', rank:8, revealed:true },  // 大本营内红象
    { r:0,c:1, owner:2, type:'lion', rank:7, revealed:true },      // 大本营上方黑狮
    { r:1,c:0, owner:2, type:'tiger', rank:6, revealed:true },      // 大本营左侧黑虎
  ]);
  const moves = getPieceMoves(b, 1, 1);
  const eatLion = moves.find(m => m.to.r === 0 && m.to.c === 1);
  const eatTiger = moves.find(m => m.to.r === 1 && m.to.c === 0);
  test('大本营内象可吃上方狮', eatLion && eatLion.outcome === 'eat');
  test('大本营内象可吃左侧虎', eatTiger && eatTiger.outcome === 'eat');

  // 大本营内鼠可以吃大本营外的象
  const b2 = makeBoard([
    { r:1,c:1, owner:1, type:'rat', rank:1, revealed:true },       // 大本营内红鼠
    { r:0,c:1, owner:2, type:'elephant', rank:8, revealed:true },  // 大本营上方黑象
  ]);
  const moves2 = getPieceMoves(b2, 1, 1);
  const eatElephant = moves2.find(m => m.to.r === 0 && m.to.c === 1);
  test('大本营内鼠可吃外方象(小博大)', eatElephant && eatElephant.outcome === 'eat');
}

console.log('\n[26] ★ 暗棋阵营机制 — 初始无阵营');
{
  const st = createState('pvp', 1, 2);
  test('初始 player1 阵营为 null', st.playerOwners[0] === null);
  test('初始 player2 阵营为 null', st.playerOwners[1] === null);
  test('初始 currentPlayerId 为 0', st.currentPlayerId === 0);
}

console.log('\n[27] ★ 暗棋阵营 — 翻牌决定阵营');
{
  const st = createState('pvp', 1, 2);
  const b = st.board;

  // 找到红方棋子
  let redPos = null;
  for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) {
    if (b[r][c] && b[r][c].owner === 1 && !b[r][c].revealed) { redPos = {r, c}; break; }
  }
  test('找到红方棋子位置', redPos !== null);

  // 玩家0翻红方棋子 → 玩家0获红方
  applyAction(b, { type:'reveal', r:redPos.r, c:redPos.c, piece:b[redPos.r][redPos.c] });
  afterAction(st, { type:'reveal', r:redPos.r, c:redPos.c, piece:b[redPos.r][redPos.c] });

  test('玩家0获红方(owner=1)', st.playerOwners[0] === 1);
  test('玩家1获黑方(owner=2)', st.playerOwners[1] === 2);
  test('currentPlayerId 切换为 1', st.currentPlayerId === 1);
}

console.log('\n[28] ★ 暗棋阵营 — 翻牌后只能操作己方棋子');
{
  // 创建有空位和未翻牌的棋盘，模拟实战局面
  const b = makeBoard([
    { r:0,c:0, owner:1, type:'elephant', rank:8, revealed:true },   // 红方已翻
    { r:1,c:1, owner:2, type:'wolf', rank:4, revealed:true },       // 黑方已翻
    { r:2,c:0, owner:1, type:'tiger', rank:6, revealed:true },     // 红方已翻
    { r:3,c:3, owner:2, type:'leopard', rank:5, revealed:false },  // 黑方未翻
    { r:0,c:3, owner:1, type:'cat', rank:2, revealed:false },     // 红方未翻
    // 其他位置为空
  ]);

  // 黑方(owner=2) 只能操作自己的棋子
  const actions = getAllLegalActions(b, 2);
  const reveals = actions.filter(a => a.type === 'reveal');
  const moves = actions.filter(a => a.type === 'move');
  test('黑方可翻牌', reveals.length > 0, `reveals=${reveals.length}`);
  test('黑方可移动自己的棋子', moves.length > 0, `实际 ${moves.length}`);

  // 验证黑方不能移动红方的棋子
  const wolfMoves = getPieceMoves(b, 1, 1, 2);  // wolf at (1,1), owner filter=2
  test('黑方狼有合法走法', wolfMoves.length > 0, `实际 ${wolfMoves.length}`);
  test('红方象不在黑方走法中', !wolfMoves.some(m => m.to.r === 0 && m.to.c === 0));

  // 验证红方(owner=1)能操作自己的棋子
  const redActions = getAllLegalActions(b, 1);
  const redMoves = redActions.filter(a => a.type === 'move');
  test('红方也能走棋', redMoves.length > 0, `实际 ${redMoves.length}`);
}

console.log('\n[29] ★ 暗棋阵营 — 阵营未确定时只能翻牌');
{
  const st = createState('pvp', 1, 2);
  const b = st.board;
  // 阵营未确定时传入 null
  const actions = getAllLegalActions(b, null);
  const moves = actions.filter(a => a.type === 'move');
  test('阵营未确定时无走棋动作', moves.length === 0);
  test('阵营未确定时有翻牌动作', actions.length === 16);
}

console.log('\n========================================');
console.log(`结果：通过 ${PASS} 项，失败 ${FAIL} 项`);
console.log('========================================');
process.exit(FAIL > 0 ? 1 : 0);