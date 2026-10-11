import {
  addPlayer,
  applyCommand,
  cleanPlayerName,
  createRoomState,
  HanabiError,
  removePlayer,
  roomViewFor,
  type HanabiRoom,
  type InternalPlayer,
} from "./hanabi";
import type { RoomCommand, RoomSession, RoomView } from "./protocol";

type RoomListener = (view: RoomView) => void;

interface StoreState {
  rooms: Map<string, HanabiRoom>;
  listeners: Map<string, Map<string, Set<RoomListener>>>;
  connectionCounts: Map<string, number>;
  disconnectTimers: Map<string, ReturnType<typeof setTimeout>>;
}

const globalStore = globalThis as typeof globalThis & {
  __hanabiStore?: StoreState;
};

const store: StoreState =
  globalStore.__hanabiStore ??
  {
    rooms: new Map(),
    listeners: new Map(),
    connectionCounts: new Map(),
    disconnectTimers: new Map(),
  };

globalStore.__hanabiStore = store;

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeToken(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function makeRoomCode(): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "";
    for (let index = 0; index < 5; index += 1) {
      const randomValue = new Uint32Array(1);
      crypto.getRandomValues(randomValue);
      code += ROOM_ALPHABET[randomValue[0] % ROOM_ALPHABET.length];
    }
    if (!store.rooms.has(code)) return code;
  }
  throw new HanabiError("暂时无法生成房间号，请稍后重试", 503);
}

function normalizeCode(code: unknown): string {
  if (typeof code !== "string") {
    throw new HanabiError("请输入房间号");
  }
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (normalized.length !== 5) {
    throw new HanabiError("房间号应为 5 位");
  }
  return normalized;
}

function newPlayer(name: string): InternalPlayer {
  return {
    id: makeToken("player"),
    token: makeToken("session"),
    name,
    connected: false,
    hand: [],
    joinedAt: Date.now(),
  };
}

export function createRoom(nameValue: unknown): RoomSession {
  const name = cleanPlayerName(nameValue);
  const player = newPlayer(name);
  const code = makeRoomCode();
  const room = createRoomState(code, player);
  store.rooms.set(code, room);
  return {
    roomCode: code,
    token: player.token,
    view: roomViewFor(room, player.id),
  };
}

export function joinRoom(codeValue: unknown, nameValue: unknown): RoomSession {
  const code = normalizeCode(codeValue);
  const name = cleanPlayerName(nameValue);
  const room = getRoom(code);
  const player = newPlayer(name);
  addPlayer(room, player);
  room.revision += 1;
  broadcast(room);
  return {
    roomCode: code,
    token: player.token,
    view: roomViewFor(room, player.id),
  };
}

export function getRoomView(codeValue: unknown, token: unknown): RoomView {
  const room = getRoom(normalizeCode(codeValue));
  const player = authenticate(room, token);
  return roomViewFor(room, player.id);
}

export function runRoomCommand(
  codeValue: unknown,
  token: unknown,
  command: RoomCommand,
): RoomView {
  const room = getRoom(normalizeCode(codeValue));
  const player = authenticate(room, token);
  applyCommand(room, player.id, command);
  room.revision += 1;
  broadcast(room);
  return roomViewFor(room, player.id);
}

export function leaveRoom(codeValue: unknown, token: unknown): void {
  const room = getRoom(normalizeCode(codeValue));
  const player = authenticate(room, token);
  const connectionKey = `${room.code}:${player.id}`;

  const disconnectTimer = store.disconnectTimers.get(connectionKey);
  if (disconnectTimer) clearTimeout(disconnectTimer);
  store.disconnectTimers.delete(connectionKey);
  store.connectionCounts.delete(connectionKey);

  const roomListeners = store.listeners.get(room.code);
  roomListeners?.delete(player.id);
  if (roomListeners?.size === 0) store.listeners.delete(room.code);

  removePlayer(room, player.id);
  if (room.players.length === 0) {
    store.rooms.delete(room.code);
    store.listeners.delete(room.code);
    return;
  }

  room.revision += 1;
  broadcast(room);
}

export function subscribeToRoom(
  codeValue: unknown,
  token: unknown,
  listener: RoomListener,
): () => void {
  const room = getRoom(normalizeCode(codeValue));
  const player = authenticate(room, token);
  const roomListeners =
    store.listeners.get(room.code) ?? new Map<string, Set<RoomListener>>();
  const playerListeners = roomListeners.get(player.id) ?? new Set<RoomListener>();
  playerListeners.add(listener);
  roomListeners.set(player.id, playerListeners);
  store.listeners.set(room.code, roomListeners);

  const connectionKey = `${room.code}:${player.id}`;
  const existingTimer = store.disconnectTimers.get(connectionKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
    store.disconnectTimers.delete(connectionKey);
  }
  store.connectionCounts.set(
    connectionKey,
    (store.connectionCounts.get(connectionKey) ?? 0) + 1,
  );
  const connectionChanged = !player.connected;
  if (connectionChanged) {
    player.connected = true;
    room.updatedAt = Date.now();
    room.revision += 1;
  }

  listener(roomViewFor(room, player.id));
  if (connectionChanged) broadcast(room, player.id);

  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    playerListeners.delete(listener);
    if (playerListeners.size === 0) roomListeners.delete(player.id);
    if (roomListeners.size === 0) store.listeners.delete(room.code);

    const remaining = Math.max(
      0,
      (store.connectionCounts.get(connectionKey) ?? 1) - 1,
    );
    store.connectionCounts.set(connectionKey, remaining);
    if (!room.players.some((roomPlayer) => roomPlayer.id === player.id)) {
      store.connectionCounts.delete(connectionKey);
      return;
    }
    if (remaining === 0) {
      const timer = setTimeout(() => {
        if ((store.connectionCounts.get(connectionKey) ?? 0) === 0) {
          player.connected = false;
          room.updatedAt = Date.now();
          room.revision += 1;
          broadcast(room);
        }
        store.disconnectTimers.delete(connectionKey);
      }, 1800);
      store.disconnectTimers.set(connectionKey, timer);
    }
  };
}

function getRoom(code: string): HanabiRoom {
  const room = store.rooms.get(code);
  if (!room) {
    throw new HanabiError("没有找到这个房间", 404, "ROOM_NOT_FOUND");
  }
  return room;
}

function authenticate(room: HanabiRoom, tokenValue: unknown): InternalPlayer {
  if (typeof tokenValue !== "string" || !tokenValue) {
    throw new HanabiError("会话已失效，请重新进入房间", 401, "BAD_SESSION");
  }
  const player = room.players.find((item) => item.token === tokenValue);
  if (!player) {
    throw new HanabiError("会话已失效，请重新进入房间", 401, "BAD_SESSION");
  }
  return player;
}

function broadcast(room: HanabiRoom, excludedPlayerId?: string): void {
  const roomListeners = store.listeners.get(room.code);
  if (!roomListeners) return;
  for (const [playerId, listeners] of roomListeners) {
    if (playerId === excludedPlayerId) continue;
    const view = roomViewFor(room, playerId);
    for (const listener of listeners) {
      try {
        listener(view);
      } catch {
        // A broken stream cleans itself up through its abort handler.
      }
    }
  }
}

export function asApiError(error: unknown): {
  message: string;
  status: number;
  code: string;
} {
  if (error instanceof HanabiError) {
    return { message: error.message, status: error.status, code: error.code };
  }
  console.error(error);
  return {
    message: "花火台暂时出了点问题，请重试",
    status: 500,
    code: "INTERNAL_ERROR",
  };
}
