import {
  COLORS,
  COLOR_LABELS,
  type ChatMessage,
  type GameResult,
  type HanabiColor,
  type HanabiRank,
  type PlayedFirework,
  type PresentationEvent,
  type RoomCommand,
  type RoomPhase,
  type RoomView,
  type TimelineEntry,
} from "./protocol";

const COPIES_BY_RANK: Record<HanabiRank, number> = {
  1: 3,
  2: 2,
  3: 2,
  4: 2,
  5: 1,
};

export const MAX_CLUES = 8;
export const MAX_MISTAKES = 3;
export const HAND_SIZE = 5;

export interface InternalCard {
  id: string;
  color: HanabiColor;
  rank: HanabiRank;
  possibleColors: HanabiColor[];
  possibleRanks: HanabiRank[];
}

export interface InternalPlayer {
  id: string;
  token: string;
  name: string;
  connected: boolean;
  hand: InternalCard[];
  joinedAt: number;
}

export interface HanabiRoom {
  code: string;
  revision: number;
  phase: RoomPhase;
  hostId: string;
  players: InternalPlayer[];
  deck: InternalCard[];
  fireworks: Record<HanabiColor, number>;
  playedFireworks: PlayedFirework[];
  discards: InternalCard[];
  clues: number;
  mistakes: number;
  turnPlayerId: string | null;
  finalTurnsRemaining: number | null;
  timeline: TimelineEntry[];
  presentationEvent: PresentationEvent | null;
  chat: ChatMessage[];
  result: GameResult | null;
  round: number;
  createdAt: number;
  updatedAt: number;
}

export class HanabiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "INVALID_ACTION") {
    super(message);
    this.name = "HanabiError";
    this.status = status;
    this.code = code;
  }
}

function emptyFireworks(): Record<HanabiColor, number> {
  return { red: 0, yellow: 0, green: 0, blue: 0, white: 0 };
}

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function secureRandom(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] / 0x1_0000_0000;
}

export function cleanPlayerName(value: unknown): string {
  if (typeof value !== "string") {
    throw new HanabiError("请输入你的称呼");
  }

  const name = value.replace(/\s+/g, " ").trim();
  if (name.length < 1) {
    throw new HanabiError("请输入你的称呼");
  }
  if (name.length > 16) {
    throw new HanabiError("称呼最多 16 个字符");
  }
  return name;
}

export function cleanChatMessage(value: unknown): string {
  if (typeof value !== "string") {
    throw new HanabiError("消息不能为空");
  }
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) {
    throw new HanabiError("消息不能为空");
  }
  if (text.length > 240) {
    throw new HanabiError("单条消息最多 240 个字符");
  }
  return text;
}

export function createRoomState(
  code: string,
  host: Pick<InternalPlayer, "id" | "token" | "name" | "joinedAt">,
  now = Date.now(),
): HanabiRoom {
  const player: InternalPlayer = {
    ...host,
    connected: false,
    hand: [],
  };

  return {
    code,
    revision: 0,
    phase: "waiting",
    hostId: host.id,
    players: [player],
    deck: [],
    fireworks: emptyFireworks(),
    playedFireworks: [],
    discards: [],
    clues: MAX_CLUES,
    mistakes: 0,
    turnPlayerId: null,
    finalTurnsRemaining: null,
    timeline: [
      {
        id: makeId("event"),
        kind: "system",
        text: `${host.name} 点亮了今晚的第一盏灯`,
        createdAt: now,
      },
    ],
    presentationEvent: null,
    chat: [],
    result: null,
    round: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function addPlayer(
  room: HanabiRoom,
  player: Pick<InternalPlayer, "id" | "token" | "name" | "joinedAt">,
  now = Date.now(),
): void {
  if (room.players.length >= 2) {
    throw new HanabiError("房间已经坐满了", 409, "ROOM_FULL");
  }
  if (room.phase !== "waiting") {
    throw new HanabiError("这局已经开始了", 409, "GAME_STARTED");
  }

  room.players.push({
    ...player,
    connected: false,
    hand: [],
  });
  pushTimeline(room, "system", `${player.name} 来到了花火台`, now);
  room.updatedAt = now;
}

export function removePlayer(
  room: HanabiRoom,
  playerId: string,
  now = Date.now(),
): InternalPlayer {
  const playerIndex = room.players.findIndex((player) => player.id === playerId);
  if (playerIndex < 0) {
    throw new HanabiError("你不在这个房间里", 403, "NOT_IN_ROOM");
  }

  const [removedPlayer] = room.players.splice(playerIndex, 1);
  if (room.players.length === 0) {
    return removedPlayer;
  }

  if (room.hostId === playerId) {
    room.hostId = room.players[0].id;
  }

  for (const player of room.players) {
    player.hand = [];
  }
  room.phase = "waiting";
  room.deck = [];
  room.fireworks = emptyFireworks();
  room.playedFireworks = [];
  room.discards = [];
  room.clues = MAX_CLUES;
  room.mistakes = 0;
  room.turnPlayerId = null;
  room.finalTurnsRemaining = null;
  room.result = null;
  room.presentationEvent = null;
  pushTimeline(
    room,
    "system",
    `${removedPlayer.name} 离开了花火台，房间已回到等待状态`,
    now,
  );
  room.updatedAt = now;
  return removedPlayer;
}

export function buildDeck(
  random: () => number = secureRandom,
): InternalCard[] {
  const deck: InternalCard[] = [];

  for (const color of COLORS) {
    for (const rank of [1, 2, 3, 4, 5] as HanabiRank[]) {
      for (let copy = 0; copy < COPIES_BY_RANK[rank]; copy += 1) {
        deck.push({
          // The ID must be fully opaque: any color/rank-derived prefix would
          // let a player decode their own hidden card from the browser payload.
          id: makeId("card"),
          color,
          rank,
          possibleColors: [...COLORS],
          possibleRanks: [1, 2, 3, 4, 5],
        });
      }
    }
  }

  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(random() * (index + 1));
    [deck[index], deck[swapWith]] = [deck[swapWith], deck[index]];
  }
  return deck;
}

export function startRound(
  room: HanabiRoom,
  actorId: string,
  now = Date.now(),
  random: () => number = secureRandom,
): void {
  if (actorId !== room.hostId) {
    throw new HanabiError("只有房主可以开始", 403, "HOST_ONLY");
  }
  if (room.players.length !== 2) {
    throw new HanabiError("需要两位玩家才能开始");
  }
  if (!room.players.every((player) => player.connected)) {
    throw new HanabiError("请等两位玩家都在线后再开始");
  }
  if (room.phase === "playing") {
    throw new HanabiError("游戏已经开始");
  }

  room.deck = buildDeck(random);
  room.fireworks = emptyFireworks();
  room.playedFireworks = [];
  room.discards = [];
  room.clues = MAX_CLUES;
  room.mistakes = 0;
  room.finalTurnsRemaining = null;
  room.result = null;
  room.round += 1;
  room.phase = "playing";
  for (const player of room.players) {
    player.hand = [];
  }

  // One card at a time, just like dealing around a physical table.
  for (let cardIndex = 0; cardIndex < HAND_SIZE; cardIndex += 1) {
    for (const player of room.players) {
      const card = room.deck.pop();
      if (card) player.hand.push(card);
    }
  }

  room.turnPlayerId = room.hostId;
  room.presentationEvent = {
    id: makeId("motion"),
    kind: "deal",
    actorId,
    dealtCardIds: Object.fromEntries(
      room.players.map((player) => [
        player.id,
        player.hand.map((card) => card.id),
      ]),
    ),
    createdAt: now,
  };
  pushTimeline(
    room,
    "system",
    `第 ${room.round} 场花火开始，${playerName(room, room.hostId)} 先行`,
    now,
  );
  room.updatedAt = now;
}

export function applyCommand(
  room: HanabiRoom,
  actorId: string,
  commandValue: RoomCommand | unknown,
  now = Date.now(),
): void {
  const command = parseRoomCommand(commandValue);
  const actor = room.players.find((player) => player.id === actorId);
  if (!actor) {
    throw new HanabiError("你不在这个房间里", 403, "NOT_IN_ROOM");
  }

  if (command.type === "chat") {
    const text = cleanChatMessage(command.text);
    room.chat.push({
      id: makeId("chat"),
      playerId: actor.id,
      playerName: actor.name,
      text,
      createdAt: now,
    });
    room.chat = room.chat.slice(-100);
    room.updatedAt = now;
    return;
  }

  if (command.type === "start" || command.type === "restart") {
    if (command.type === "restart" && room.phase !== "ended") {
      throw new HanabiError("当前牌局还没有结束");
    }
    startRound(room, actorId, now);
    return;
  }

  requireActiveTurn(room, actorId);

  if (command.type === "clue") {
    giveClue(room, actor, command, now);
    finishTurn(room, false, now);
    return;
  }

  if (command.type === "discard") {
    if (room.clues >= MAX_CLUES) {
      throw new HanabiError("提示标记已满，当前不能弃牌");
    }
    const fromIndex = actor.hand.findIndex((card) => card.id === command.cardId);
    const card = takeCard(actor, command.cardId);
    room.discards.push(card);
    room.clues = Math.min(MAX_CLUES, room.clues + 1);
    pushTimeline(
      room,
      "discard",
      `${actor.name} 弃掉了 ${COLOR_LABELS[card.color]}色 ${card.rank}，收回 1 枚提示标记`,
      now,
    );
    if (maximumReachableScore(room) === fireworksScore(room)) {
      room.presentationEvent = {
        id: makeId("motion"),
        kind: "discard",
        actorId: actor.id,
        cardId: card.id,
        card: { color: card.color, rank: card.rank },
        fromIndex,
        drawnCardId: null,
        createdAt: now,
      };
      endGame(room, "ceiling", now);
      return;
    }
    const draw = drawReplacement(room, actor);
    room.presentationEvent = {
      id: makeId("motion"),
      kind: "discard",
      actorId: actor.id,
      cardId: card.id,
      card: { color: card.color, rank: card.rank },
      fromIndex,
      drawnCardId: draw.drawnCardId,
      createdAt: now,
    };
    finishTurn(room, draw.triggeredFinalRound, now);
    return;
  }

  if (command.type !== "play") {
    throw new HanabiError("未知的牌局操作");
  }

  const fromIndex = actor.hand.findIndex((item) => item.id === command.cardId);
  const card = takeCard(actor, command.cardId);
  const isPlayable = room.fireworks[card.color] + 1 === card.rank;
  const expectedRank = Math.min(
    room.fireworks[card.color] + 1,
    5,
  ) as HanabiRank;

  if (isPlayable) {
    room.fireworks[card.color] = card.rank;
    room.playedFireworks.push({
      id: makeId("played"),
      actorId: actor.id,
      color: card.color,
      rank: card.rank,
      createdAt: now,
    });
    if (card.rank === 5 && room.clues < MAX_CLUES) {
      room.clues += 1;
    }
    pushTimeline(
      room,
      "play",
      `${actor.name} 成功打出 ${COLOR_LABELS[card.color]}色 ${card.rank}${
        card.rank === 5 ? "，完成一束花火" : ""
      }`,
      now,
    );
  } else {
    room.discards.push(card);
    room.mistakes += 1;
    pushTimeline(
      room,
      "misfire",
      `${actor.name} 打出的 ${COLOR_LABELS[card.color]}色 ${card.rank} 未能接上，失去 1 次机会`,
      now,
    );
  }

  if (room.mistakes >= MAX_MISTAKES) {
    room.presentationEvent = {
      id: makeId("motion"),
      kind: "misfire",
      actorId: actor.id,
      cardId: card.id,
      card: { color: card.color, rank: card.rank },
      fromIndex,
      drawnCardId: null,
      expectedRank,
      createdAt: now,
    };
    endGame(room, "misfires", now);
    return;
  }
  if (fireworksScore(room) === 25) {
    room.presentationEvent = {
      id: makeId("motion"),
      kind: "play",
      actorId: actor.id,
      cardId: card.id,
      card: { color: card.color, rank: card.rank },
      fromIndex,
      drawnCardId: null,
      createdAt: now,
    };
    endGame(room, "perfect", now);
    return;
  }
  if (maximumReachableScore(room) === fireworksScore(room)) {
    room.presentationEvent = {
      id: makeId("motion"),
      kind: isPlayable ? "play" : "misfire",
      actorId: actor.id,
      cardId: card.id,
      card: { color: card.color, rank: card.rank },
      fromIndex,
      drawnCardId: null,
      ...(isPlayable ? {} : { expectedRank }),
      createdAt: now,
    } as PresentationEvent;
    endGame(room, "ceiling", now);
    return;
  }
  const draw = drawReplacement(room, actor);
  room.presentationEvent = {
    id: makeId("motion"),
    kind: isPlayable ? "play" : "misfire",
    actorId: actor.id,
    cardId: card.id,
    card: { color: card.color, rank: card.rank },
    fromIndex,
    drawnCardId: draw.drawnCardId,
    ...(isPlayable ? {} : { expectedRank }),
    createdAt: now,
  } as PresentationEvent;
  finishTurn(room, draw.triggeredFinalRound, now);
}

export function parseRoomCommand(value: unknown): RoomCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HanabiError("缺少有效的操作内容");
  }

  const record = value as Record<string, unknown>;
  if (typeof record.type !== "string") {
    throw new HanabiError("缺少有效的操作类型");
  }

  if (record.type === "start" || record.type === "restart") {
    return { type: record.type };
  }

  if (record.type === "chat") {
    if (typeof record.text !== "string") {
      throw new HanabiError("消息不能为空");
    }
    return { type: "chat", text: record.text };
  }

  if (record.type === "play" || record.type === "discard") {
    if (
      typeof record.cardId !== "string" ||
      record.cardId.length < 1 ||
      record.cardId.length > 96
    ) {
      throw new HanabiError("缺少有效的手牌");
    }
    return { type: record.type, cardId: record.cardId };
  }

  if (record.type === "clue") {
    if (
      typeof record.targetPlayerId !== "string" ||
      record.targetPlayerId.length < 1 ||
      record.targetPlayerId.length > 96
    ) {
      throw new HanabiError("没有找到要提示的玩家");
    }
    if (record.clueType === "color") {
      if (
        typeof record.value !== "string" ||
        !COLORS.includes(record.value as HanabiColor)
      ) {
        throw new HanabiError("无效的颜色提示");
      }
      return {
        type: "clue",
        targetPlayerId: record.targetPlayerId,
        clueType: "color",
        value: record.value as HanabiColor,
      };
    }
    if (record.clueType === "rank") {
      if (
        typeof record.value !== "number" ||
        ![1, 2, 3, 4, 5].includes(record.value)
      ) {
        throw new HanabiError("无效的数字提示");
      }
      return {
        type: "clue",
        targetPlayerId: record.targetPlayerId,
        clueType: "rank",
        value: record.value as HanabiRank,
      };
    }
    throw new HanabiError("提示必须选择颜色或数字");
  }

  throw new HanabiError("未知的牌局操作");
}

function giveClue(
  room: HanabiRoom,
  actor: InternalPlayer,
  command: Extract<RoomCommand, { type: "clue" }>,
  now: number,
): void {
  if (room.clues <= 0) {
    throw new HanabiError("已经没有可用的提示标记");
  }
  if (command.targetPlayerId === actor.id) {
    throw new HanabiError("不能给自己提示");
  }

  const target = room.players.find(
    (player) => player.id === command.targetPlayerId,
  );
  if (!target) {
    throw new HanabiError("没有找到要提示的玩家");
  }

  if (
    command.clueType === "color" &&
    !COLORS.includes(command.value as HanabiColor)
  ) {
    throw new HanabiError("无效的颜色提示");
  }
  if (
    command.clueType === "rank" &&
    ![1, 2, 3, 4, 5].includes(command.value as number)
  ) {
    throw new HanabiError("无效的数字提示");
  }

  const matches: number[] = [];
  target.hand.forEach((card, index) => {
    const matchesClue =
      command.clueType === "color"
        ? card.color === command.value
        : card.rank === command.value;
    if (matchesClue) {
      matches.push(index + 1);
      if (command.clueType === "color") {
        card.possibleColors = [command.value as HanabiColor];
      }
      if (command.clueType === "rank") {
        card.possibleRanks = [command.value as HanabiRank];
      }
    } else {
      if (command.clueType === "color") {
        card.possibleColors = card.possibleColors.filter(
          (color) => color !== command.value,
        );
      }
      if (command.clueType === "rank") {
        card.possibleRanks = card.possibleRanks.filter(
          (rank) => rank !== command.value,
        );
      }
    }
  });

  room.clues -= 1;
  const clueText =
    command.clueType === "color"
      ? `${COLOR_LABELS[command.value as HanabiColor]}色`
      : `数字 ${command.value}`;
  pushTimeline(
    room,
    "clue",
    matches.length > 0
      ? `${actor.name} 告诉 ${target.name}：第 ${matches.join("、")} 张牌是${clueText}`
      : `${actor.name} 告诉 ${target.name}：你的手牌里没有${clueText}`,
    now,
  );
  room.presentationEvent = {
    id: makeId("motion"),
    kind: "clue",
    actorId: actor.id,
    targetPlayerId: target.id,
    clueType: command.clueType,
    clueValue: command.value,
    affectedCardIds: target.hand
      .filter((_, index) => matches.includes(index + 1))
      .map((card) => card.id),
    createdAt: now,
  } as PresentationEvent;
}

function requireActiveTurn(room: HanabiRoom, actorId: string): void {
  if (room.phase !== "playing") {
    throw new HanabiError("当前没有进行中的牌局");
  }
  if (!room.players.every((player) => player.connected)) {
    throw new HanabiError("搭档暂时离线，牌局会等待重连");
  }
  if (room.turnPlayerId !== actorId) {
    throw new HanabiError("还没轮到你");
  }
}

function takeCard(player: InternalPlayer, cardId: string): InternalCard {
  const cardIndex = player.hand.findIndex((card) => card.id === cardId);
  if (cardIndex < 0) {
    throw new HanabiError("这张牌已经不在你的手中了");
  }
  const [card] = player.hand.splice(cardIndex, 1);
  return card;
}

function drawReplacement(
  room: HanabiRoom,
  player: InternalPlayer,
): { triggeredFinalRound: boolean; drawnCardId: string | null } {
  if (room.deck.length === 0) {
    return { triggeredFinalRound: false, drawnCardId: null };
  }

  const card = room.deck.pop();
  if (card) player.hand.push(card);

  if (room.deck.length === 0 && room.finalTurnsRemaining === null) {
    // The action that drew the final card is not one of the final turns.
    room.finalTurnsRemaining = room.players.length;
    return { triggeredFinalRound: true, drawnCardId: card?.id ?? null };
  }
  return { triggeredFinalRound: false, drawnCardId: card?.id ?? null };
}

function finishTurn(
  room: HanabiRoom,
  triggeredFinalRound: boolean,
  now: number,
): void {
  if (
    room.finalTurnsRemaining !== null &&
    !triggeredFinalRound
  ) {
    room.finalTurnsRemaining -= 1;
    if (room.finalTurnsRemaining <= 0) {
      endGame(room, "deck", now);
      return;
    }
  }

  const currentIndex = room.players.findIndex(
    (player) => player.id === room.turnPlayerId,
  );
  const nextIndex = (currentIndex + 1) % room.players.length;
  room.turnPlayerId = room.players[nextIndex].id;
  room.updatedAt = now;
}

function endGame(
  room: HanabiRoom,
  reason: GameResult["reason"],
  now: number,
): void {
  const achievedScore = fireworksScore(room);
  const score = achievedScore;
  const copy: Record<
    GameResult["reason"],
    Pick<GameResult, "title" | "description">
  > = {
    perfect: {
      title: "漫天华彩",
      description: "五色花火全部绽放，这是一次完美演出。",
    },
    deck: {
      title: score >= 21 ? "余辉不散" : score >= 16 ? "掌声如潮" : "夜空留痕",
      description: "牌堆耗尽，最后一轮已经结束。",
    },
    ceiling: {
      title: score >= 21 ? "华彩已尽" : score >= 16 ? "此夜圆满" : "花火定格",
      description: "所有仍有可能完成的花火都已点亮，继续行动已无法提高分数。",
    },
    misfires: {
      title: "引线熄灭",
      description: "三次失误让演出提前结束，已点亮的花火仍计入本局得分。",
    },
  };

  room.phase = "ended";
  room.turnPlayerId = null;
  room.result = {
    reason,
    score,
    fireworksScore: achievedScore,
    ...copy[reason],
  };
  pushTimeline(room, "system", `${copy[reason].title} · 本局 ${score} 分`, now);
  room.updatedAt = now;
}

export function fireworksScore(room: HanabiRoom): number {
  return COLORS.reduce((sum, color) => sum + room.fireworks[color], 0);
}

export function maximumReachableScore(room: HanabiRoom): number {
  const remainingCards = [
    ...room.deck,
    ...room.players.flatMap((player) => player.hand),
  ];

  return COLORS.reduce((total, color) => {
    let reachableRank = room.fireworks[color];
    for (
      let rank = reachableRank + 1;
      rank <= 5;
      rank += 1
    ) {
      const nextRank = rank as HanabiRank;
      if (
        !remainingCards.some(
          (card) => card.color === color && card.rank === nextRank,
        )
      ) {
        break;
      }
      reachableRank = nextRank;
    }
    return total + reachableRank;
  }, 0);
}

function playerName(room: HanabiRoom, playerId: string): string {
  return (
    room.players.find((player) => player.id === playerId)?.name ?? "未知玩家"
  );
}

function pushTimeline(
  room: HanabiRoom,
  kind: TimelineEntry["kind"],
  text: string,
  createdAt: number,
): void {
  room.timeline.push({ id: makeId("event"), kind, text, createdAt });
  room.timeline = room.timeline.slice(-120);
}

export function roomViewFor(room: HanabiRoom, viewerId: string): RoomView {
  if (!room.players.some((player) => player.id === viewerId)) {
    throw new HanabiError("你不在这个房间里", 403, "NOT_IN_ROOM");
  }

  return {
    code: room.code,
    revision: room.revision,
    phase: room.phase,
    selfId: viewerId,
    hostId: room.hostId,
    players: room.players.map((player) => {
      const isSelf = player.id === viewerId;
      return {
        id: player.id,
        name: player.name,
        isSelf,
        isHost: player.id === room.hostId,
        connected: player.connected,
        hand: player.hand.map((card, index) => ({
          id: card.id,
          color: isSelf ? null : card.color,
          rank: isSelf ? null : card.rank,
          knownColor:
            card.possibleColors.length === 1 ? card.possibleColors[0] : null,
          knownRank:
            card.possibleRanks.length === 1 ? card.possibleRanks[0] : null,
          excludedColors: COLORS.filter(
            (color) => !card.possibleColors.includes(color),
          ),
          excludedRanks: ([1, 2, 3, 4, 5] as HanabiRank[]).filter(
            (rank) => !card.possibleRanks.includes(rank),
          ),
          isNewest: index === player.hand.length - 1 && room.round > 0,
        })),
      };
    }),
    turnPlayerId: room.turnPlayerId,
    clues: room.clues,
    maxClues: MAX_CLUES,
    mistakes: room.mistakes,
    maxMistakes: MAX_MISTAKES,
    deckCount: room.deck.length,
    fireworks: { ...room.fireworks },
    playedFireworks: room.playedFireworks.map((firework) => ({ ...firework })),
    discards: room.discards.map(({ color, rank }) => ({ color, rank })),
    finalTurnsRemaining: room.finalTurnsRemaining,
    timeline: [...room.timeline],
    presentationEvent: room.presentationEvent
      ? structuredClone(room.presentationEvent)
      : null,
    chat: [...room.chat],
    result: room.result ? { ...room.result } : null,
    round: room.round,
    updatedAt: room.updatedAt,
  };
}
