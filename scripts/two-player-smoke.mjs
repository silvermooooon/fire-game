import assert from "node:assert/strict";

const baseUrl = process.env.HANABI_BASE_URL ?? "http://localhost:3000";

async function jsonFetch(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${response.status}: ${payload.error ?? "Request failed"}`);
  }
  return payload;
}

async function createSseClient(roomCode, token) {
  const abortController = new AbortController();
  const response = await fetch(
    `${baseUrl}/api/rooms/${roomCode}/events?token=${encodeURIComponent(token)}`,
    { signal: abortController.signal },
  );
  assert.equal(response.status, 200);
  assert.ok(response.body);

  const snapshots = [];
  const waiters = [];
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";

  const publish = (snapshot) => {
    const waiter = waiters.shift();
    if (waiter) waiter(snapshot);
    else snapshots.push(snapshot);
  };

  const reading = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          const dataLine = event
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (dataLine) publish(JSON.parse(dataLine.slice(6)));
        }
      }
    } catch (error) {
      if (error?.name !== "AbortError") throw error;
    }
  })();

  const nextSnapshot = () =>
    snapshots.length > 0
      ? Promise.resolve(snapshots.shift())
      : new Promise((resolve) => waiters.push(resolve));

  await nextSnapshot();
  return {
    async waitFor(predicate, timeoutMs = 4_000) {
      const timeoutAt = Date.now() + timeoutMs;
      while (Date.now() < timeoutAt) {
        const remaining = timeoutAt - Date.now();
        let timeout;
        const snapshot = await Promise.race([
          nextSnapshot(),
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Timed out waiting for SSE snapshot")),
              remaining,
            );
          }),
        ]).finally(() => clearTimeout(timeout));
        if (predicate(snapshot)) return snapshot;
      }
      throw new Error("Timed out waiting for SSE snapshot");
    },
    abort() {
      abortController.abort();
      return reading.catch(() => {});
    },
  };
}

async function command(roomCode, token, value) {
  return jsonFetch(`/api/rooms/${roomCode}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, command: value }),
  });
}

const hostSession = await jsonFetch("/api/rooms", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "create", name: "联机甲" }),
});
const hostStream = await createSseClient(
  hostSession.roomCode,
  hostSession.token,
);

const guestSession = await jsonFetch("/api/rooms", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    action: "join",
    code: hostSession.roomCode,
    name: "联机乙",
  }),
});
let guestStream = await createSseClient(
  guestSession.roomCode,
  guestSession.token,
);

try {
  let hostView = await hostStream.waitFor(
    (snapshot) =>
      snapshot.players.length === 2 &&
      snapshot.players.every((player) => player.connected),
  );
  assert.equal(hostView.players.length, 2);
  assert.ok(hostView.players.every((player) => player.connected));

  const hostMirrorStream = await createSseClient(
    hostSession.roomCode,
    hostSession.token,
  );
  await hostMirrorStream.abort();
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const guestPresenceView = await jsonFetch(
    `/api/rooms/${hostSession.roomCode}?token=${encodeURIComponent(guestSession.token)}`,
  );
  assert.equal(
    guestPresenceView.players.find((player) => !player.isSelf).connected,
    true,
  );

  const fullRoomResponse = await fetch(`${baseUrl}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "join",
      code: hostSession.roomCode,
      name: "第三人",
    }),
  });
  assert.equal(fullRoomResponse.status, 409);

  await guestStream.abort();
  hostView = await hostStream.waitFor(
    (snapshot) =>
      snapshot.players.length === 2 &&
      snapshot.players.some((player) => !player.connected),
    5_000,
  );
  assert.ok(hostView.players.some((player) => !player.connected));

  const startWhileOffline = await fetch(
    `${baseUrl}/api/rooms/${hostSession.roomCode}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: hostSession.token,
        command: { type: "start" },
      }),
    },
  );
  assert.equal(startWhileOffline.status, 400);

  guestStream = await createSseClient(
    guestSession.roomCode,
    guestSession.token,
  );
  await hostStream.waitFor((snapshot) =>
    snapshot.players.every((player) => player.connected),
  );

  await command(hostSession.roomCode, hostSession.token, {
    type: "start",
  });
  hostView = await hostStream.waitFor(
    (snapshot) => snapshot.phase === "playing",
  );
  let guestView = await guestStream.waitFor(
    (snapshot) => snapshot.phase === "playing",
  );

  assert.equal(hostView.phase, "playing");
  assert.equal(hostView.deckCount, 40);
  assert.ok(
    hostView.players
      .find((player) => player.isSelf)
      .hand.every((card) => card.color === null && card.rank === null),
  );
  assert.ok(
    hostView.players
      .find((player) => !player.isSelf)
      .hand.every((card) => card.color !== null && card.rank !== null),
  );
  assert.ok(
    guestView.players
      .find((player) => player.isSelf)
      .hand.every((card) => card.color === null && card.rank === null),
  );

  await command(hostSession.roomCode, guestSession.token, {
    type: "chat",
    text: "烟火准备好了",
  });
  hostView = await hostStream.waitFor(
    (snapshot) => snapshot.chat.at(-1)?.text === "烟火准备好了",
  );
  assert.equal(hostView.chat.at(-1).text, "烟火准备好了");
  assert.equal(hostView.turnPlayerId, hostView.selfId);

  const visibleGuest = hostView.players.find((player) => !player.isSelf);
  const clueColor = visibleGuest.hand[0].color;
  const cluedCardIds = visibleGuest.hand
    .filter((card) => card.color === clueColor)
    .map((card) => card.id);
  await command(hostSession.roomCode, hostSession.token, {
    type: "clue",
    targetPlayerId: visibleGuest.id,
    clueType: "color",
    value: clueColor,
  });

  guestView = await guestStream.waitFor(
    (snapshot) =>
      snapshot.turnPlayerId === snapshot.selfId && snapshot.clues === 7,
  );
  const guestOwn = guestView.players.find((player) => player.isSelf);
  assert.ok(
    guestOwn.hand
      .filter((card) => cluedCardIds.includes(card.id))
      .every((card) => card.knownColor === clueColor),
  );
  assert.equal(guestView.clues, 7);
  assert.equal(guestView.turnPlayerId, guestView.selfId);

  const discardedId = guestOwn.hand[0].id;
  await command(hostSession.roomCode, guestSession.token, {
    type: "discard",
    cardId: discardedId,
  });
  guestView = await guestStream.waitFor(
    (snapshot) => snapshot.clues === 8 && snapshot.discards.length === 1,
  );
  assert.equal(guestView.clues, 8);
  assert.equal(guestView.discards.length, 1);
  assert.equal(
    guestView.players.find((player) => player.isSelf).hand.length,
    5,
  );

  await jsonFetch(`/api/rooms/${hostSession.roomCode}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: guestSession.token }),
  });
  await guestStream.abort();
  hostView = await hostStream.waitFor(
    (snapshot) => snapshot.phase === "waiting" && snapshot.players.length === 1,
  );
  assert.equal(hostView.players[0].isHost, true);

  const replacementSession = await jsonFetch("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "join",
      code: hostSession.roomCode,
      name: "联机丙",
    }),
  });
  assert.equal(replacementSession.roomCode, hostSession.roomCode);

  console.log(
    `Two-player SSE smoke test passed in room ${hostSession.roomCode}: create → join → disconnect → resume → start → chat → clue → discard → leave → refill seat`,
  );
} finally {
  await Promise.all([hostStream.abort(), guestStream.abort()]);
}
