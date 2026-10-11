export const COLORS = ["red", "yellow", "green", "blue", "white"] as const;

export type HanabiColor = (typeof COLORS)[number];
export type HanabiRank = 1 | 2 | 3 | 4 | 5;
export type RoomPhase = "waiting" | "playing" | "ended";

export const COLOR_LABELS: Record<HanabiColor, string> = {
  red: "赤",
  yellow: "金",
  green: "翠",
  blue: "青",
  white: "白",
};

export interface CardView {
  id: string;
  color: HanabiColor | null;
  rank: HanabiRank | null;
  knownColor: HanabiColor | null;
  knownRank: HanabiRank | null;
  excludedColors: HanabiColor[];
  excludedRanks: HanabiRank[];
  isNewest: boolean;
}

export interface PlayerView {
  id: string;
  name: string;
  isSelf: boolean;
  isHost: boolean;
  connected: boolean;
  hand: CardView[];
}

export interface TimelineEntry {
  id: string;
  kind: "system" | "clue" | "play" | "discard" | "misfire";
  text: string;
  createdAt: number;
}

export interface PlayedFirework {
  id: string;
  actorId: string;
  color: HanabiColor;
  rank: HanabiRank;
  createdAt: number;
}

export type PresentationEvent =
  | {
      id: string;
      kind: "deal";
      actorId: string;
      dealtCardIds: Record<string, string[]>;
      createdAt: number;
    }
  | {
      id: string;
      kind: "clue";
      actorId: string;
      targetPlayerId: string;
      clueType: "color" | "rank";
      clueValue: HanabiColor | HanabiRank;
      affectedCardIds: string[];
      createdAt: number;
    }
  | {
      id: string;
      kind: "play" | "misfire" | "discard";
      actorId: string;
      cardId: string;
      card: { color: HanabiColor; rank: HanabiRank };
      fromIndex: number;
      drawnCardId: string | null;
      expectedRank?: HanabiRank;
      createdAt: number;
    };

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  createdAt: number;
}

export interface GameResult {
  reason: "perfect" | "deck" | "misfires" | "ceiling";
  score: number;
  fireworksScore: number;
  title: string;
  description: string;
}

export interface RoomView {
  code: string;
  revision: number;
  phase: RoomPhase;
  selfId: string;
  hostId: string;
  players: PlayerView[];
  turnPlayerId: string | null;
  clues: number;
  maxClues: number;
  mistakes: number;
  maxMistakes: number;
  deckCount: number;
  fireworks: Record<HanabiColor, number>;
  playedFireworks: PlayedFirework[];
  discards: Array<{ color: HanabiColor; rank: HanabiRank }>;
  finalTurnsRemaining: number | null;
  timeline: TimelineEntry[];
  presentationEvent: PresentationEvent | null;
  chat: ChatMessage[];
  result: GameResult | null;
  round: number;
  updatedAt: number;
}

export type RoomCommand =
  | { type: "start" }
  | { type: "restart" }
  | { type: "play"; cardId: string }
  | { type: "discard"; cardId: string }
  | {
      type: "clue";
      targetPlayerId: string;
      clueType: "color";
      value: HanabiColor;
    }
  | {
      type: "clue";
      targetPlayerId: string;
      clueType: "rank";
      value: HanabiRank;
    }
  | { type: "chat"; text: string };

export interface RoomSession {
  roomCode: string;
  token: string;
  view: RoomView;
}

export interface ApiErrorShape {
  error: string;
  code?: string;
}
