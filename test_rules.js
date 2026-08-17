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

const { ROWS, COLS, PIECE_TYPES, CAMP_POSITION, isCamp, isCampEntrance, campPieceCount, createBoard, canCapture, getPieceMoves,
        applyAction, revertAction, checkWinner, countAlive,
        getAllLegalActions, createState, afterAction } = sandbox.window.Game;

let PASS = 0, FAIL = 0;
function test(name, cond, info) {
  if (cond) { PASS++; console.log('  ✓ ' + name); }
  else { FAIL++; console.log('  ✗ ' + name + (info ? ' — ' + info : '')); }
}

function makeBoard(pieces, camp = null) {
  const b = Array.from({length: ROWS}, () => Array(COLS).fill(null));
  b.camp = camp;
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

console.log('\n[2] 大本营判定（中央方格内的独立营位）');
{
  test('CAMP_POSITION 是 (1.5,1.5)', CAMP_POSITION.r === 1.5 && CAMP_POSITION.c === 1.5);
  test('(1.5,1.5) 是唯一大本营', isCamp(1.5, 1.5));
  test('(1,1) 是入口而非营位', isCampEntrance(1, 1) && !isCamp(1, 1));
  test('(1,2) 是入口而非营位', isCampEntrance(1, 2) && !isCamp(1, 2));
  test('(2,1) 是入口而非营位', isCampEntrance(2, 1) && !isCamp(2, 1));
  test('(2,2) 是入口而非营位', isCampEntrance(2, 2) && !isCamp(2, 2));
  test('(0,0) 不是大本营或入口', !isCamp(0, 0) && !isCampEntrance(0, 0));
  test('(3,3) 不是大本营或入口', !isCamp(3, 3) && !isCampEntrance(3, 3));
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

console.log('\n[8] 走法 — 普通棋子在入口正交移动并可入营');
{
  const b = makeBoard([
    { r:1,c:1, owner:1, type:'wolf', rank:4, revealed:true },
  ]);
  const moves = getPieceMoves(b, 1, 1);
  test('狼在入口有 4 个正交走法加 1 个入营走法', moves.length === 5, `实际 ${moves.length}`);
  const dirs = moves.map(m => `${m.to.r},${m.to.c}`).sort();
  test('狼走法含上下左右', ['0,1','1,0','1,2','2,1'].every(pos => dirs.includes(pos)));
  test('狼可从入口进入独立营位', !!findMove(moves, CAMP_POSITION.r, CAMP_POSITION.c));
}

console.log('\n[9] 走法 — 豹在入口可走 8 个棋盘方向并入营');
{
  const b = makeBoard([
    { r:1,c:1, owner:1, type:'leopard', rank:5, revealed:true },
  ]);
  const moves = getPieceMoves(b, 1, 1);
  test('豹在入口有 8 个棋盘方向加 1 个入营走法', moves.length === 9, `实际 ${moves.length}`);
  const dirs = moves.map(m => `${m.to.r},${m.to.c}`).sort();
  test('豹走法含 4 斜向', dirs.includes('0,0') && dirs.includes('0,2') && dirs.includes('2,0') && dirs.includes('2,2'));
  test('豹可从入口进入独立营位', !!findMove(moves, CAMP_POSITION.r, CAMP_POSITION.c));
}

console.log('\n[9b] 豹在大本营周围的斜飞规则');
{
  const leopard = { r:1,c:1, owner:1, type:'leopard', rank:5, revealed:true };
  const occupiedCamp = { owner:2, type:'cat', rank:2, revealed:true };
  const occupiedBoard = makeBoard([leopard], occupiedCamp);
  const occupiedMoves = getPieceMoves(occupiedBoard, 1, 1);
  test('营内有棋时豹不能进入大本营', !findMove(occupiedMoves, CAMP_POSITION.r, CAMP_POSITION.c));
  test('营内有棋时豹不能从入口斜飞穿过大本营', !findMove(occupiedMoves, 2, 2));
  test('营内有棋不影响未穿过大本营的斜飞', ['0,0','0,2','2,0'].every(pos => {
    const [r, c] = pos.split(',').map(Number);
    return !!findMove(occupiedMoves, r, c);
  }));
  const otherDiagonalBoard = makeBoard([
    { r:1,c:2, owner:1, type:'leopard', rank:5, revealed:true },
  ], occupiedCamp);
  const otherDiagonalMoves = getPieceMoves(otherDiagonalBoard, 1, 2);
  test('营内有棋时另一条中央对角线也被阻挡', !findMove(otherDiagonalMoves, 2, 1));

  const emptyBoard = makeBoard([leopard]);
  const emptyMoves = getPieceMoves(emptyBoard, 1, 1);
  test('营内无棋时豹可以选择进入大本营', !!findMove(emptyMoves, CAMP_POSITION.r, CAMP_POSITION.c));
  test('营内无棋时豹仍可斜飞其他方块', ['0,0','0,2','2,0','2,2'].every(pos => {
    const [r, c] = pos.split(',').map(Number);
    return !!findMove(emptyMoves, r, c);
  }));
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
  test('鼠在入口有 4 个正交走法加 1 个入营走法', moves.length === 5, `实际 ${moves.length}`);
  const boardMoves = moves.filter(m => !isCamp(m.to.r, m.to.c));
  const hasDiag = boardMoves.some(m => Math.abs(m.to.r - 1) === 1 && Math.abs(m.to.c - 1) === 1);
  test('鼠在棋盘上不能斜走', boardMoves.length === 4 && !hasDiag);
  test('鼠可从入口进入独立营位', !!findMove(moves, CAMP_POSITION.r, CAMP_POSITION.c));
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

console.log('\n[25] 大本营内棋子从独立营位正常行动');
{
  const campWolf = { owner:1, type:'wolf', rank:4, revealed:true };
  const b = makeBoard([], campWolf);
  test('狼存储在 board.camp', b.camp === campWolf);
  test('狼位于独立营位 (1.5,1.5)', isCamp(CAMP_POSITION.r, CAMP_POSITION.c));
  const moves = getPieceMoves(b, CAMP_POSITION.r, CAMP_POSITION.c);
  const exits = moves.map(m => `${m.to.r},${m.to.c}`).sort();
  test('营内狼有 4 个出口走法', moves.length === 4, `实际 ${moves.length}`);
  test('营内狼可去四个入口', JSON.stringify(exits) === JSON.stringify(['1,1','1,2','2,1','2,2']));
}

console.log('\n[25b] ★★ 大本营容量限制（一次最多 1 颗）');
{
  const b1 = makeBoard([
    { r:1,c:1, owner:1, type:'wolf', rank:4, revealed:true },
  ]);
  test('空大本营计数=0', campPieceCount(b1) === 0);
  const moves1 = getPieceMoves(b1, 1, 1);
  test('入口狼可进入空大本营', !!findMove(moves1, CAMP_POSITION.r, CAMP_POSITION.c));

  const campCat = { owner:1, type:'cat', rank:2, revealed:true };
  const b2 = makeBoard([
    { r:1,c:1, owner:1, type:'wolf', rank:4, revealed:true },
  ], campCat);
  test('board.camp 有棋子时大本营计数=1', campPieceCount(b2) === 1);
  const moves2 = getPieceMoves(b2, 1, 1);
  test('营位已有1颗时入口棋子不可再进入', !findMove(moves2, CAMP_POSITION.r, CAMP_POSITION.c));
  test('营位棋子仍可从独立营位离开', getPieceMoves(b2, CAMP_POSITION.r, CAMP_POSITION.c).length === 3);
}

console.log('\n[25c] ★★ 大本营内棋子受保护（外围敌棋不能攻击）');
{
  const campCat = { owner:1, type:'cat', rank:2, revealed:true };
  const b = makeBoard([
    { r:1,c:1, owner:2, type:'elephant', rank:8, revealed:true },
  ], campCat);
  test('象原本能吃营内猫', canCapture(b[1][1], b.camp) === 'eat');
  const elephantMoves = getPieceMoves(b, 1, 1);
  test('外围敌象不能攻击已占用营位', !findMove(elephantMoves, CAMP_POSITION.r, CAMP_POSITION.c));

  const campWolf = { owner:1, type:'wolf', rank:4, revealed:true };
  const b2 = makeBoard([
    { r:2,c:2, owner:2, type:'wolf', rank:4, revealed:true },
  ], campWolf);
  test('外围狼与营内狼原本会同级对死', canCapture(b2[2][2], b2.camp) === 'tie');
  const wolfMoves = getPieceMoves(b2, 2, 2);
  test('外围敌狼不能与营内狼对死', !findMove(wolfMoves, CAMP_POSITION.r, CAMP_POSITION.c));
}

console.log('\n[25d] ★★ 大本营内棋子可攻击四个入口上的敌棋');
{
  const campElephant = { owner:1, type:'elephant', rank:8, revealed:true };
  const b = makeBoard([
    { r:1,c:1, owner:2, type:'lion', rank:7, revealed:true },
    { r:1,c:2, owner:2, type:'tiger', rank:6, revealed:true },
    { r:2,c:1, owner:2, type:'leopard', rank:5, revealed:true },
    { r:2,c:2, owner:2, type:'wolf', rank:4, revealed:true },
  ], campElephant);
  const moves = getPieceMoves(b, CAMP_POSITION.r, CAMP_POSITION.c);
  const entranceTargets = [[1,1], [1,2], [2,1], [2,2]];
  test('营内象对四个入口均生成吃子走法', entranceTargets.every(([r, c]) => {
    const move = findMove(moves, r, c);
    return move && move.outcome === 'eat';
  }));

  const campRat = { owner:1, type:'rat', rank:1, revealed:true };
  const b2 = makeBoard([
    { r:1,c:1, owner:2, type:'elephant', rank:8, revealed:true },
  ], campRat);
  const moves2 = getPieceMoves(b2, CAMP_POSITION.r, CAMP_POSITION.c);
  const eatElephant = findMove(moves2, 1, 1);
  test('营内鼠可吃入口象(小博大)', eatElephant && eatElephant.outcome === 'eat');
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