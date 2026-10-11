import { describe, expect, it } from "vitest";
import { orderDiscards } from "../lib/ordered-discards";

describe("orderDiscards", () => {
  it("orders discards by the fixed color order, then rank, then discard time", () => {
    const ordered = orderDiscards([
      { color: "white", rank: 2 },
      { color: "red", rank: 3 },
      { color: "blue", rank: 1 },
      { color: "red", rank: 1 },
      { color: "red", rank: 1 },
      { color: "yellow", rank: 5 },
    ]);

    expect(ordered).toEqual([
      { color: "red", rank: 1, discardedAt: 3 },
      { color: "red", rank: 1, discardedAt: 4 },
      { color: "red", rank: 3, discardedAt: 1 },
      { color: "yellow", rank: 5, discardedAt: 5 },
      { color: "blue", rank: 1, discardedAt: 2 },
      { color: "white", rank: 2, discardedAt: 0 },
    ]);
  });
});
