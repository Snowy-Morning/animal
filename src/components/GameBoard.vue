<script setup lang="ts">
import { PIECE_TYPES, type GameState } from '@/game/rules';

defineProps<{ state: GameState; gameVersion: number }>();
const emit = defineEmits<{ cell: [r: number, c: number] }>();

const classicPieceImage = (type: string): string => {
  const iconName = type === 'lion' ? 'lion-face' : type;
  return `/animal/emojione--${iconName}.svg`;
};

const positionStyle = (r: number, c: number): Record<string, string> => {
  return { '--r': String(r), '--c': String(c) };
};
</script>

<template>
  <div class="board-wrap">
    <div class="board-intersection">
      <div v-for="r in 4" :key="`row-${r}`">
        <button
          v-for="c in 4"
          :key="`${r}-${c}`"
          class="dot"
          :style="positionStyle(r - 1, c - 1)"
          @click="emit('cell', r - 1, c - 1)"
        />
      </div>
      <div class="camp-box" @click="emit('cell', 1.5, 1.5)"></div>
      <div
        v-if="state.board.camp"
        :key="`camp-${gameVersion}-${state.board.camp.id}`"
        class="piece in-camp"
        :class="[`owner-${state.board.camp.owner}`, { flipped: state.board.camp.revealed, selected: state.selected?.camp }]"
        :style="positionStyle(1.5, 1.5)"
        @click.stop="emit('cell', 1.5, 1.5)"
      >
        <div class="piece-inner">
          <div class="piece-face back"></div>
          <div class="piece-face front">
            <img class="piece-icon classic-icon" :src="classicPieceImage(state.board.camp.type)" :alt="PIECE_TYPES[state.board.camp.type].char">
            <span class="piece-name">{{ PIECE_TYPES[state.board.camp.type].char }}</span>
          </div>
        </div>
      </div>
      <span
        v-for="move in state.validMoves"
        :key="`hint-${move.to.r}-${move.to.c}`"
        class="hint"
        :class="move.outcome"
        :style="positionStyle(move.to.r, move.to.c)"
        @click.stop="emit('cell', move.to.r, move.to.c)"
      ></span>
      <template v-for="(row, r) in state.board" :key="r">
        <template v-for="(piece, c) in row" :key="`${r}-${c}`">
          <div
            v-if="piece"
            :key="`piece-${gameVersion}-${piece.id}`"
            class="piece"
            :class="[`owner-${piece.owner}`, { flipped: piece.revealed, selected: state.selected?.r === r && state.selected?.c === c }]"
            :style="positionStyle(r, c)"
            @click.stop="emit('cell', r, c)"
          >
            <div class="piece-inner">
              <div class="piece-face back"></div>
              <div class="piece-face front">
                <img class="piece-icon classic-icon" :src="classicPieceImage(piece.type)" :alt="PIECE_TYPES[piece.type].char">
                <span class="piece-name">{{ PIECE_TYPES[piece.type].char }}</span>
              </div>
            </div>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>
