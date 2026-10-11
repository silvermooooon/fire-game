import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CardView, HanabiColor, HanabiRank } from "../lib/protocol";
import {
  getOwnCardKnowledgeState,
  ProgressiveOwnCard,
} from "./progressive-own-card";

function makeCard(
  knownColor: HanabiColor | null,
  knownRank: HanabiRank | null,
): CardView {
  return {
    id: "opaque-card-id",
    color: null,
    rank: null,
    knownColor,
    knownRank,
    excludedColors: [],
    excludedRanks: [],
    isNewest: false,
  };
}

describe("ProgressiveOwnCard", () => {
  it.each([
    [null, null, "unknown"],
    ["red", null, "color-only"],
    [null, 3, "rank-only"],
    ["red", 3, "complete"],
  ] as const)(
    "derives %s / %s as %s",
    (knownColor, knownRank, expectedState) => {
      expect(
        getOwnCardKnowledgeState(makeCard(knownColor, knownRank)),
      ).toBe(expectedState);
    },
  );

  it("does not print a number when only the color is known", () => {
    const markup = renderToStaticMarkup(
      <ProgressiveOwnCard
        card={makeCard("red", null)}
        index={0}
        total={5}
        onSelect={() => {}}
      />,
    );

    expect(markup).toContain('data-knowledge="color-only"');
    expect(markup.match(/>3<\/span>/g)).toBeNull();
  });

  it.each([
    [null, 3, "rank-only"],
    ["red", 3, "complete"],
  ] as const)(
    "prints a known number exactly once in the %s / %s state",
    (knownColor, knownRank, expectedState) => {
      const markup = renderToStaticMarkup(
        <ProgressiveOwnCard
          card={makeCard(knownColor, knownRank)}
          index={0}
          total={5}
          onSelect={() => {}}
        />,
      );

      expect(markup).toContain(`data-knowledge="${expectedState}"`);
      expect(markup.match(/>3<\/span>/g)).toHaveLength(1);
      expect(markup).not.toContain("knowledge-chip");
    },
  );

  it("keeps the known rank visible when a later clue reveals white", () => {
    const markup = renderToStaticMarkup(
      <ProgressiveOwnCard
        card={makeCard("white", 4)}
        index={1}
        total={5}
        onSelect={() => {}}
      />,
    );

    expect(markup).toContain('data-knowledge="complete"');
    expect(markup.match(/>4<\/span>/g)).toHaveLength(1);
  });

  it("keeps exclusions and selection state in the accessible name", () => {
    const card = {
      ...makeCard(null, 2),
      excludedColors: ["red", "blue"] as HanabiColor[],
      excludedRanks: [4, 5] as HanabiRank[],
      isNewest: true,
    };
    const markup = renderToStaticMarkup(
      <ProgressiveOwnCard
        card={card}
        index={4}
        total={5}
        selected
        onSelect={() => {}}
      />,
    );

    expect(markup).toContain("已排除赤色、青色");
    expect(markup).toContain("已排除数字 4、5");
    expect(markup).toContain("这是本回合最新摸到的牌");
    expect(markup).toContain("当前已选择");
  });
});
