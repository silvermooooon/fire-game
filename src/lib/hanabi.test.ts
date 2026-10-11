import { describe, expect, it } from "vitest";
import {
  MAX_CLUES,
  addPlayer,
  applyCommand,
  buildDeck,
  createRoomState,
  fireworksScore,
  maximumReachableScore,
  removePlayer,
  roomViewFor,
  startRound,
  type HanabiRoom,
} from "./hanabi";
import { COLORS, type HanabiColor, type HanabiRank } from "./protocol";

function startedRoom(): HanabiRoom {
  const room = createRoomState("ABCDE", {
    id: "p1",
    token: "secret-one",
    name: "小夏",
    joinedAt: 1,
  });
  addPlayer(room, {
    id: "p2",
    token: "secret-two",
    name: "阿岚",
    joinedAt: 2,
  });
  room.players.forEach((player) => {
    player.connected = true;
  });
  startRound(room, "p1", 10, () => 0.42);
  return room;
}

function totalCards(room: HanabiRoom) {
  return (
    room.deck.length +
    room.players.reduce((sum, player) => sum + player.hand.length, 0) +
    room.discards.length +
    fireworksScore(room)
  );
}

function clueValueFor(
  room: HanabiRoom,
  targetPlayerId: string,
): HanabiColor {
  return room.players.find((player) => player.id === targetPlayerId)!.hand[0]
    .color;
}

function moveDeckCardToFirstHand(
  room: HanabiRoom,
  color: HanabiColor,
  rank: HanabiRank,
) {
  const targetHand = room.players[0].hand;
  const existingIndex = targetHand.findIndex(
    (card) => card.color === color && card.rank === rank,
  );
  if (existingIndex >= 0) {
    [targetHand[0], targetHand[existingIndex]] = [
      targetHand[existingIndex],
      targetHand[0],
    ];
    return targetHand[0];
  }

  const deckIndex = room.deck.findIndex(
    (card) => card.color === color && card.rank === rank,
  );
  if (deckIndex >= 0) {
    const selected = room.deck[deckIndex];
    room.deck[deckIndex] = targetHand[0];
    targetHand[0] = selected;
    return selected;
  }

  for (const player of room.players.slice(1)) {
    const handIndex = player.hand.findIndex(
      (card) => card.color === color && card.rank === rank,
    );
    if (handIndex >= 0) {
      const selected = player.hand[handIndex];
      player.hand[handIndex] = targetHand[0];
      targetHand[0] = selected;
      return selected;
    }
  }

  throw new Error(`Could not find ${color} ${rank} in the active cards`);
}

function discardOtherCopies(
  room: HanabiRoom,
  color: HanabiColor,
  rank: HanabiRank,
  keepCardId?: string,
) {
  const shouldDiscard = (card: HanabiRoom["deck"][number]) =>
    card.id !== keepCardId && card.color === color && card.rank === rank;
  const deckDiscards = room.deck.filter(shouldDiscard);
  room.deck = room.deck.filter((card) => !shouldDiscard(card));
  room.discards.push(...deckDiscards);
  for (const player of room.players) {
    const handDiscards = player.hand.filter(shouldDiscard);
    player.hand = player.hand.filter((card) => !shouldDiscard(card));
    room.discards.push(...handDiscards);
  }
}

describe("Hanabi deck and setup", () => {
  it("builds the standard 50-card five-color deck", () => {
    const deck = buildDeck(() => 0.5);
    expect(deck).toHaveLength(50);

    for (const color of COLORS) {
      const colorCards = deck.filter((card) => card.color === color);
      expect(colorCards).toHaveLength(10);
      expect(
        [1, 2, 3, 4, 5].map(
          (rank) => colorCards.filter((card) => card.rank === rank).length,
        ),
      ).toEqual([3, 2, 2, 2, 1]);
    }
    expect(new Set(deck.map((card) => card.id)).size).toBe(50);
    expect(deck.every((card) => /^card_[0-9a-f]{32}$/.test(card.id))).toBe(
      true,
    );
  });

  it("deals five cards each and leaves forty in the deck", () => {
    const room = startedRoom();
    expect(room.players.map((player) => player.hand.length)).toEqual([5, 5]);
    expect(room.deck).toHaveLength(40);
    expect(room.clues).toBe(8);
    expect(room.mistakes).toBe(0);
    expect(room.turnPlayerId).toBe("p1");
    expect(totalCards(room)).toBe(50);
    expect(room.presentationEvent).toMatchObject({
      kind: "deal",
      actorId: "p1",
    });
    if (room.presentationEvent?.kind === "deal") {
      expect(room.presentationEvent.dealtCardIds.p1).toHaveLength(5);
      expect(room.presentationEvent.dealtCardIds.p2).toHaveLength(5);
    }
  });
});

describe("private player projections", () => {
  it("never sends a player their own true card faces", () => {
    const room = startedRoom();
    const p1View = roomViewFor(room, "p1");
    const p2View = roomViewFor(room, "p2");

    const p1Own = p1View.players.find((player) => player.isSelf)!;
    const p1Other = p1View.players.find((player) => !player.isSelf)!;
    const p2Own = p2View.players.find((player) => player.isSelf)!;

    expect(p1Own.hand.every((card) => card.color === null && card.rank === null))
      .toBe(true);
    expect(p2Own.hand.every((card) => card.color === null && card.rank === null))
      .toBe(true);
    expect(
      p1Other.hand.every((card) => card.color !== null && card.rank !== null),
    ).toBe(true);
    expect(JSON.stringify(p1View)).not.toContain("secret-one");
    expect(JSON.stringify(p1View)).not.toContain("secret-two");
    expect(p1View).not.toHaveProperty("deck");
  });
});

describe("clues and explicit memory", () => {
  it("marks every match and excludes the clue from every non-match", () => {
    const room = startedRoom();
    const target = room.players[1];
    const color = target.hand[0].color;
    const matchingIds = target.hand
      .filter((card) => card.color === color)
      .map((card) => card.id);

    applyCommand(
      room,
      "p1",
      {
        type: "clue",
        targetPlayerId: "p2",
        clueType: "color",
        value: color,
      },
      20,
    );

    expect(room.clues).toBe(7);
    for (const card of target.hand) {
      if (matchingIds.includes(card.id)) {
        expect(card.possibleColors).toEqual([color]);
      } else {
        expect(card.possibleColors).not.toContain(color);
        expect(card.possibleColors).toContain(card.color);
      }
    }
    expect(room.turnPlayerId).toBe("p2");
    expect(room.presentationEvent).toMatchObject({
      kind: "clue",
      actorId: "p1",
      targetPlayerId: "p2",
      clueType: "color",
      clueValue: color,
      affectedCardIds: matchingIds,
    });
  });

  it("supports the current-edition zero-match clue without corrupting knowledge", () => {
    const room = startedRoom();
    const target = room.players[1];
    target.hand.forEach((card) => {
      card.color = "red";
    });

    applyCommand(
      room,
      "p1",
      {
        type: "clue",
        targetPlayerId: "p2",
        clueType: "color",
        value: "blue",
      },
      20,
    );

    expect(target.hand.every((card) => !card.possibleColors.includes("blue")))
      .toBe(true);
    expect(room.timeline.at(-1)?.text).toContain("没有青色");
  });

  it("preserves a known rank when a later clue reveals that the card is white", () => {
    const room = startedRoom();
    const target = room.players[1];
    const card = target.hand[0];
    card.color = "white";
    card.rank = 4;

    applyCommand(room, "p1", {
      type: "clue",
      targetPlayerId: "p2",
      clueType: "rank",
      value: 4,
    });
    applyCommand(room, "p2", {
      type: "clue",
      targetPlayerId: "p1",
      clueType: "rank",
      value: room.players[0].hand[0].rank,
    });
    applyCommand(room, "p1", {
      type: "clue",
      targetPlayerId: "p2",
      clueType: "color",
      value: "white",
    });

    const cardView = roomViewFor(room, "p2")
      .players.find((player) => player.isSelf)!
      .hand.find((item) => item.id === card.id);
    expect(cardView).toMatchObject({ knownColor: "white", knownRank: 4 });
  });

  it("rejects malformed clue payloads atomically", () => {
    const room = startedRoom();
    const snapshot = JSON.stringify(room);

    expect(() =>
      applyCommand(room, "p1", {
        type: "clue",
        targetPlayerId: "p2",
        clueType: "bogus",
        value: { toString: null },
      }),
    ).toThrow("提示必须选择颜色或数字");
    expect(JSON.stringify(room)).toBe(snapshot);
  });
});

describe("plays, discards, and immediate endings", () => {
  it("pauses game actions while either player is offline", () => {
    const room = startedRoom();
    room.players[1].connected = false;
    const snapshot = JSON.stringify(room);

    expect(() =>
      applyCommand(
        room,
        "p1",
        { type: "play", cardId: room.players[0].hand[0].id },
        20,
      ),
    ).toThrow("搭档暂时离线");
    expect(JSON.stringify(room)).toBe(snapshot);
  });

  it("rejects a discard while all eight clue tokens are available", () => {
    const room = startedRoom();
    const cardId = room.players[0].hand[0].id;
    const snapshot = JSON.stringify(room);

    expect(() =>
      applyCommand(room, "p1", { type: "discard", cardId }, 20),
    ).toThrow("提示标记已满");
    expect(JSON.stringify(room)).toBe(snapshot);
  });

  it("discards at seven clues, restores one, and draws a replacement", () => {
    const room = startedRoom();
    room.clues = 7;
    const player = room.players[0];
    const cardId = player.hand[0].id;
    const deckBefore = room.deck.length;

    applyCommand(room, "p1", { type: "discard", cardId }, 20);

    expect(room.clues).toBe(MAX_CLUES);
    expect(player.hand).toHaveLength(5);
    expect(room.deck).toHaveLength(deckBefore - 1);
    expect(room.discards).toHaveLength(1);
    expect(totalCards(room)).toBe(50);
    expect(room.presentationEvent).toMatchObject({
      kind: "discard",
      actorId: "p1",
      cardId,
    });
    if (room.presentationEvent?.kind === "discard") {
      const discardEvent = room.presentationEvent;
      expect(discardEvent.drawnCardId).toBe(player.hand.at(-1)?.id);
      const selfView = roomViewFor(room, "p1");
      const drawnView = selfView.players
        .find((viewPlayer) => viewPlayer.isSelf)!
        .hand.find(
          (viewCard) => viewCard.id === discardEvent.drawnCardId,
        );
      expect(drawnView).toMatchObject({ color: null, rank: null });
    }
  });

  it("ends immediately at the third misfire, keeps the achieved score, and does not draw", () => {
    const room = startedRoom();
    const player = room.players[0];
    const card = player.hand[0];
    room.mistakes = 2;
    room.fireworks[card.color] = card.rank === 5 ? 5 : card.rank;
    const achievedScore = fireworksScore(room);
    const deckBefore = room.deck.length;
    const handBefore = player.hand.length;

    applyCommand(room, "p1", { type: "play", cardId: card.id }, 20);

    expect(room.phase).toBe("ended");
    expect(room.result?.reason).toBe("misfires");
    expect(room.result?.score).toBe(achievedScore);
    expect(room.result?.fireworksScore).toBe(achievedScore);
    expect(room.deck).toHaveLength(deckBefore);
    expect(player.hand).toHaveLength(handBefore - 1);
    expect(room.presentationEvent).toMatchObject({
      kind: "misfire",
      cardId: card.id,
      drawnCardId: null,
    });
  });

  it("ends a perfect 25 immediately without drawing a replacement", () => {
    const room = startedRoom();
    const player = room.players[0];
    const card = player.hand[0];
    card.color = "red";
    card.rank = 5;
    card.possibleColors = ["red"];
    card.possibleRanks = [5];
    room.fireworks = { red: 4, yellow: 5, green: 5, blue: 5, white: 5 };
    const deckBefore = room.deck.length;

    applyCommand(room, "p1", { type: "play", cardId: card.id }, 20);

    expect(room.phase).toBe("ended");
    expect(room.result?.reason).toBe("perfect");
    expect(room.result?.score).toBe(25);
    expect(room.deck).toHaveLength(deckBefore);
    expect(room.playedFireworks.at(-1)).toMatchObject({
      actorId: "p1",
      color: "red",
      rank: 5,
      createdAt: 20,
    });
    expect(roomViewFor(room, "p2").playedFireworks).toEqual(
      room.playedFireworks,
    );
  });

  it("restores a clue after a successful five without exceeding eight", () => {
    const room = startedRoom();
    const player = room.players[0];
    const card = player.hand[0];
    card.rank = 5;
    room.fireworks[card.color] = 4;
    room.clues = 6;

    applyCommand(room, "p1", { type: "play", cardId: card.id }, 20);
    expect(room.clues).toBe(7);
  });

  it("ends without drawing when discarding the final copy needed for any future point", () => {
    const room = startedRoom();
    const doomedThree = moveDeckCardToFirstHand(room, "red", 3);
    discardOtherCopies(room, "red", 3, doomedThree.id);
    room.fireworks = { red: 2, yellow: 5, green: 5, blue: 5, white: 5 };
    room.clues = 7;
    const deckBefore = room.deck.length;

    expect(maximumReachableScore(room)).toBeGreaterThan(fireworksScore(room));
    applyCommand(room, "p1", { type: "discard", cardId: doomedThree.id }, 20);

    expect(room.phase).toBe("ended");
    expect(room.result?.reason).toBe("ceiling");
    expect(room.result?.score).toBe(22);
    expect(room.result?.description).toContain("无法提高分数");
    expect(room.deck).toHaveLength(deckBefore);
    expect(room.presentationEvent).toMatchObject({
      kind: "discard",
      cardId: doomedThree.id,
      drawnCardId: null,
    });
  });

  it("ends after playing the final reachable point even while the deck has cards", () => {
    const room = startedRoom();
    const finalFive = moveDeckCardToFirstHand(room, "yellow", 5);
    discardOtherCopies(room, "red", 3);
    room.fireworks = { red: 2, yellow: 4, green: 5, blue: 5, white: 5 };
    const deckBefore = room.deck.length;

    expect(maximumReachableScore(room)).toBe(22);
    applyCommand(room, "p1", { type: "play", cardId: finalFive.id }, 20);

    expect(room.phase).toBe("ended");
    expect(room.result?.reason).toBe("ceiling");
    expect(room.result?.score).toBe(22);
    expect(room.deck).toHaveLength(deckBefore);
    expect(room.presentationEvent).toMatchObject({
      kind: "play",
      cardId: finalFive.id,
      drawnCardId: null,
    });
  });

  it("continues while at least one next required card still exists", () => {
    const room = startedRoom();
    const reachableThree = moveDeckCardToFirstHand(room, "red", 3);
    discardOtherCopies(room, "red", 3, reachableThree.id);
    room.fireworks = { red: 2, yellow: 5, green: 5, blue: 5, white: 5 };

    expect(maximumReachableScore(room)).toBeGreaterThan(fireworksScore(room));
    expect(room.phase).toBe("playing");
  });
});

describe("room lifecycle", () => {
  it("returns a room to waiting and transfers host when a player leaves", () => {
    const room = startedRoom();
    removePlayer(room, "p1", 30);

    expect(room.players.map((player) => player.id)).toEqual(["p2"]);
    expect(room.hostId).toBe("p2");
    expect(room.phase).toBe("waiting");
    expect(room.players[0].hand).toHaveLength(0);
    expect(room.deck).toHaveLength(0);
    expect(room.turnPlayerId).toBeNull();
    expect(room.playedFireworks).toEqual([]);
    expect(room.result).toBeNull();
    expect(room.timeline.at(-1)?.text).toContain("离开了花火台");
  });
});

describe("the final round", () => {
  it("gives the teammate and final-card drawer exactly one future turn each", () => {
    const room = startedRoom();
    room.clues = 7;
    room.deck = [room.deck[0]];
    const p1Card = room.players[0].hand[0];

    applyCommand(room, "p1", { type: "discard", cardId: p1Card.id }, 20);
    expect(room.deck).toHaveLength(0);
    expect(room.finalTurnsRemaining).toBe(2);
    expect(room.turnPlayerId).toBe("p2");

    applyCommand(
      room,
      "p2",
      {
        type: "clue",
        targetPlayerId: "p1",
        clueType: "color",
        value: clueValueFor(room, "p1"),
      },
      21,
    );
    expect(room.phase).toBe("playing");
    expect(room.finalTurnsRemaining).toBe(1);
    expect(room.turnPlayerId).toBe("p1");

    applyCommand(
      room,
      "p1",
      {
        type: "clue",
        targetPlayerId: "p2",
        clueType: "rank",
        value: room.players[1].hand[0].rank as HanabiRank,
      },
      22,
    );
    expect(room.phase).toBe("ended");
    expect(room.result?.reason).toBe("deck");
    expect(room.finalTurnsRemaining).toBe(0);
  });
});
