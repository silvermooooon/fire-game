import { COLORS, type RoomView } from "./protocol";

const COLOR_ORDER = new Map(COLORS.map((color, index) => [color, index]));

export function orderDiscards(discards: RoomView["discards"]) {
  return discards
    .map((card, discardedAt) => ({ ...card, discardedAt }))
    .sort(
      (left, right) =>
        (COLOR_ORDER.get(left.color) ?? 0) -
          (COLOR_ORDER.get(right.color) ?? 0) ||
        left.rank - right.rank ||
        left.discardedAt - right.discardedAt,
    );
}
