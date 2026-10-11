"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  COLORS,
  COLOR_LABELS,
  type ApiErrorShape,
  type CardView,
  type HanabiColor,
  type HanabiRank,
  type PlayerView,
  type PresentationEvent,
  type RoomCommand,
  type RoomSession,
  type RoomView,
} from "@/lib/protocol";
import { HanabiTableau } from "@/components/hanabi-tableau";
import { DragActionCard } from "@/components/drag-action-card";
import {
  ClueTokenTransfer,
  type ClueTokenMotion,
  type MotionRect,
} from "@/components/clue-token-transfer";
import {
  FireworkParticleEffect,
  PerfectFinale,
  SmokeParticleEffect,
} from "@/components/particle-effects";

type SessionIdentity = { roomCode: string; token: string };
type ConnectionState = "connecting" | "online" | "reconnecting";
type SidePanel = "chat" | "timeline";
type LobbyMode = "create" | "join";
type CardMenuState =
  | { owner: "self" | "teammate"; cardId: string }
  | null;
type CluePreview =
  | { clueType: "color"; value: HanabiColor }
  | { clueType: "rank"; value: HanabiRank }
  | null;
type CardFlightMotion = {
  eventId: string;
  origin: MotionRect;
  target: MotionRect;
};
type QueuedPresentation = {
  event: PresentationEvent;
  flightMotion: CardFlightMotion | null;
  clueTokenMotion: ClueTokenMotion | null;
};

function presentationDuration(event: PresentationEvent) {
  if (event.kind === "play") return event.card.rank === 5 ? 7_200 : 5_200;
  if (event.kind === "misfire") return 3_600;
  if (event.kind === "deal") return 3_200;
  if (event.kind === "clue") return 3_400;
  return 2_850;
}

const COLOR_NAMES: Record<HanabiColor, string> = {
  red: "赤色",
  yellow: "金色",
  green: "翠色",
  blue: "青色",
  white: "白色",
};

function storageKey(roomCode: string) {
  return `hanabi:session:${roomCode}`;
}

function roomUrl(roomCode: string) {
  return `${window.location.origin}${window.location.pathname}?room=${roomCode}&join=1`;
}

const subscribeToHydration = () => () => {};

function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

function captureCardFlight(event: PresentationEvent): CardFlightMotion | null {
  if (
    typeof document === "undefined" ||
    (event.kind !== "play" && event.kind !== "misfire" && event.kind !== "discard")
  ) {
    return null;
  }

  const originNode = document.querySelector<HTMLElement>(
    `[data-card-id="${event.cardId}"]`,
  );
  const targetSelector =
    event.kind === "play"
      ? `[data-flight-anchor="firework-${event.card.color}"]`
      : `[data-flight-anchor="discard"]`;
  const targetNode = document.querySelector<HTMLElement>(targetSelector);
  if (!originNode || !targetNode) return null;

  const originRect = originNode.getBoundingClientRect();
  const targetRect = targetNode.getBoundingClientRect();
  return {
    eventId: event.id,
    origin: {
      left: originRect.left,
      top: originRect.top,
      width: originRect.width,
      height: originRect.height,
    },
    target: {
      left: targetRect.left,
      top: targetRect.top,
      width: targetRect.width,
      height: targetRect.height,
    },
  };
}

function captureClueTokenMotion(
  event: PresentationEvent,
): ClueTokenMotion | null {
  if (typeof document === "undefined" || event.kind !== "clue") return null;

  const availableTokens = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-clue-token][data-token-state="available"]',
    ),
  );
  const sourceNode = availableTokens.at(-1);
  if (!sourceNode) return null;

  const targets = event.affectedCardIds.flatMap((cardId) => {
    const node = document.querySelector<HTMLElement>(
      `[data-card-id="${cardId}"]`,
    );
    if (!node) return [];
    const rect = node.getBoundingClientRect();
    return [
      {
        cardId,
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
      },
    ];
  });
  if (targets.length === 0) return null;

  const origin = sourceNode.getBoundingClientRect();
  return {
    eventId: event.id,
    origin: {
      left: origin.left,
      top: origin.top,
      width: origin.width,
      height: origin.height,
    },
    targets,
  };
}

function initialRoomCode() {
  if (typeof window === "undefined") return "";
  const queryCode =
    new URLSearchParams(window.location.search)
      .get("room")
      ?.toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 5) ?? "";
  if (queryCode) return queryCode;
  return (
    window.localStorage
      .getItem("hanabi:last-room")
      ?.toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 5) ?? ""
  );
}

function initialSession(): SessionIdentity | null {
  if (typeof window === "undefined") return null;
  const roomCode = initialRoomCode();
  if (!roomCode) return null;
  const token =
    window.sessionStorage.getItem(storageKey(roomCode)) ??
    window.localStorage.getItem(storageKey(roomCode));
  return token ? { roomCode, token } : null;
}

function rememberSession(roomCode: string, token: string) {
  window.sessionStorage.setItem(storageKey(roomCode), token);
  window.localStorage.setItem(storageKey(roomCode), token);
  window.localStorage.setItem("hanabi:last-room", roomCode);
}

function forgetSession(roomCode: string) {
  window.sessionStorage.removeItem(storageKey(roomCode));
  window.localStorage.removeItem(storageKey(roomCode));
  if (window.localStorage.getItem("hanabi:last-room") === roomCode) {
    window.localStorage.removeItem("hanabi:last-room");
  }
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // LAN pages use plain HTTP, where the modern clipboard API may be blocked.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard unavailable");
}

function useDialogFocus<T extends HTMLElement>(
  open: boolean,
  onEscape?: () => void,
) {
  const dialogRef = useRef<T | null>(null);
  const escapeRef = useRef(onEscape);

  useEffect(() => {
    escapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!open || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const selector =
      'button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])';

    const focusables = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(selector)).filter(
        (element) => element.getClientRects().length > 0,
      );
    (focusables()[0] ?? dialog).focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && escapeRef.current) {
        event.preventDefault();
        escapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [open]);

  return dialogRef;
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T | ApiErrorShape;
  if (!response.ok) {
    throw new Error(
      "error" in (payload as ApiErrorShape)
        ? (payload as ApiErrorShape).error
        : "操作没有成功，请重试",
    );
  }
  return payload as T;
}

export function HanabiApp() {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const [session, setSession] = useState<SessionIdentity | null>(initialSession);
  const [view, setView] = useState<RoomView | null>(null);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [lobbyMode, setLobbyMode] = useState<LobbyMode>(() =>
    initialRoomCode() ? "join" : "create",
  );
  const [name, setName] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (window.localStorage.getItem("hanabi:player-name") ?? ""),
  );
  const [roomCodeInput, setRoomCodeInput] = useState(initialRoomCode);
  const [lobbyBusy, setLobbyBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [selectedOwnCard, setSelectedOwnCard] = useState<string | null>(null);
  const [sidePanel, setSidePanel] = useState<SidePanel>("chat");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [presentationEvent, setPresentationEvent] =
    useState<PresentationEvent | null>(null);
  const [cardFlightMotion, setCardFlightMotion] =
    useState<CardFlightMotion | null>(null);
  const [clueTokenMotion, setClueTokenMotion] =
    useState<ClueTokenMotion | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const turnContextRef = useRef<string | null>(null);
  const latestRevisionRef = useRef(-1);
  const pendingActionRef = useRef(false);
  const seenPresentationEventsRef = useRef(new Set<string>());
  const presentationTimerRef = useRef<number | null>(null);
  const activePresentationRef = useRef<PresentationEvent | null>(null);
  const presentationQueueRef = useRef<QueuedPresentation[]>([]);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => {
      setNotice((current) => (current === message ? null : current));
    }, 3200);
  }, []);

  const showNextPresentation = useCallback(function showNextPresentation() {
    const next = presentationQueueRef.current.shift();
    if (!next) {
      activePresentationRef.current = null;
      presentationTimerRef.current = null;
      setPresentationEvent(null);
      setCardFlightMotion(null);
      setClueTokenMotion(null);
      return;
    }

    activePresentationRef.current = next.event;
    setPresentationEvent(next.event);
    setCardFlightMotion(next.flightMotion);
    setClueTokenMotion(next.clueTokenMotion);
    presentationTimerRef.current = window.setTimeout(
      showNextPresentation,
      presentationDuration(next.event),
    );
  }, []);

  const acceptView = useCallback((nextView: RoomView) => {
    if (nextView.revision <= latestRevisionRef.current) return;
    latestRevisionRef.current = nextView.revision;

    if (
      nextView.presentationEvent &&
      !seenPresentationEventsRef.current.has(nextView.presentationEvent.id)
    ) {
      const event = nextView.presentationEvent;
      seenPresentationEventsRef.current.add(event.id);
      const age = Date.now() - event.createdAt;
      if (age < 4_000) {
        presentationQueueRef.current.push({
          event,
          flightMotion: captureCardFlight(event),
          clueTokenMotion: captureClueTokenMotion(event),
        });
        if (!activePresentationRef.current) showNextPresentation();
      }
      if (seenPresentationEventsRef.current.size > 80) {
        const recentIds = Array.from(
          seenPresentationEventsRef.current,
        ).slice(-40);
        seenPresentationEventsRef.current = new Set(recentIds);
      }
    }

    const nextTurnContext = `${nextView.round}:${nextView.turnPlayerId ?? "none"}:${
      nextView.timeline.at(-1)?.id ?? "empty"
    }`;
    if (
      turnContextRef.current !== null &&
      turnContextRef.current !== nextTurnContext
    ) {
      setSelectedOwnCard(null);
    }
    turnContextRef.current = nextTurnContext;
    if (nextView.phase === "ended") setRulesOpen(false);
    setView(nextView);
  }, [showNextPresentation]);

  useEffect(
    () => () => {
      if (presentationTimerRef.current !== null) {
        window.clearTimeout(presentationTimerRef.current);
      }
      presentationQueueRef.current = [];
      activePresentationRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!session) {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      return;
    }

    const url = `/api/rooms/${session.roomCode}/events?token=${encodeURIComponent(
      session.token,
    )}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => setConnectionState("online");
    eventSource.onmessage = (event) => {
      const nextView = JSON.parse(event.data) as RoomView;
      acceptView(nextView);
      setConnectionState("online");
    };
    eventSource.onerror = () => {
      if (eventSource.readyState !== EventSource.CLOSED) {
        setConnectionState("reconnecting");
      }
    };
    eventSource.addEventListener("room-error", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as ApiErrorShape;
      showNotice(payload.error);
      forgetSession(session.roomCode);
      setSession(null);
      setView(null);
      latestRevisionRef.current = -1;
      setLobbyMode("join");
      setRoomCodeInput(session.roomCode);
    });

    return () => {
      eventSource.close();
      if (eventSourceRef.current === eventSource) {
        eventSourceRef.current = null;
      }
    };
  }, [acceptView, session, showNotice]);

  const enterSession = useCallback((roomSession: RoomSession) => {
    const identity = {
      roomCode: roomSession.roomCode,
      token: roomSession.token,
    };
    rememberSession(roomSession.roomCode, roomSession.token);
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}?room=${roomSession.roomCode}`,
    );
    setConnectionState("connecting");
    turnContextRef.current = null;
    latestRevisionRef.current = roomSession.view.revision;
    pendingActionRef.current = false;
    seenPresentationEventsRef.current.clear();
    presentationQueueRef.current = [];
    activePresentationRef.current = null;
    if (presentationTimerRef.current !== null) {
      window.clearTimeout(presentationTimerRef.current);
      presentationTimerRef.current = null;
    }
    setPresentationEvent(null);
    setCardFlightMotion(null);
    setClueTokenMotion(null);
    setSession(identity);
    setView(roomSession.view);
  }, []);

  const submitLobby = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      showNotice("先留下你的称呼");
      return;
    }
    if (lobbyMode === "join" && roomCodeInput.length !== 5) {
      showNotice("请输入 5 位房间号");
      return;
    }

    setLobbyBusy(true);
    try {
      window.localStorage.setItem("hanabi:player-name", trimmedName);
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: lobbyMode,
          name: trimmedName,
          code: roomCodeInput,
        }),
      });
      enterSession(await readJson<RoomSession>(response));
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setLobbyBusy(false);
    }
  };

  const sendCommand = useCallback(
    async (command: RoomCommand, actionName: string) => {
      if (!session || pendingActionRef.current) return false;
      pendingActionRef.current = true;
      setPendingAction(actionName);
      try {
        const response = await fetch(`/api/rooms/${session.roomCode}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: session.token, command }),
        });
        const nextView = await readJson<RoomView>(response);
        acceptView(nextView);
        if (command.type === "play" || command.type === "discard") {
          setSelectedOwnCard(null);
        }
        return true;
      } catch (error) {
        showNotice(error instanceof Error ? error.message : "操作没有成功");
        return false;
      } finally {
        pendingActionRef.current = false;
        setPendingAction(null);
      }
    },
    [acceptView, session, showNotice],
  );

  const copyInvite = useCallback(async () => {
    if (!view) return;
    try {
      let invite = roomUrl(view.code);
      let copiedLink = true;
      if (
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "::1"
      ) {
        const response = await fetch("/api/network");
        const payload = await readJson<{ origins: string[] }>(response);
        if (payload.origins[0]) {
          invite = `${payload.origins[0]}${window.location.pathname}?room=${view.code}&join=1`;
        } else {
          invite = `花火房间号：${view.code}`;
          copiedLink = false;
        }
      }
      await copyText(invite);
      showNotice(copiedLink ? "局域网邀请链接已复制" : "房间号已复制");
    } catch {
      showNotice(`房间号：${view.code}`);
    }
  }, [showNotice, view]);

  const leaveCurrentRoom = useCallback(async () => {
    if (!session || !view || pendingAction) return;
    if (
      view.phase === "playing" &&
      !window.confirm("现在离开会取消这场牌局，并让房间回到等待状态。确定离开吗？")
    ) {
      return;
    }

    setPendingAction("leave");
    try {
      const response = await fetch(`/api/rooms/${session.roomCode}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: session.token }),
      });
      await readJson<{ ok: true }>(response);
      forgetSession(session.roomCode);
      eventSourceRef.current?.close();
      latestRevisionRef.current = -1;
      turnContextRef.current = null;
      pendingActionRef.current = false;
      seenPresentationEventsRef.current.clear();
      presentationQueueRef.current = [];
      activePresentationRef.current = null;
      if (presentationTimerRef.current !== null) {
        window.clearTimeout(presentationTimerRef.current);
        presentationTimerRef.current = null;
      }
      setPresentationEvent(null);
      setCardFlightMotion(null);
      setClueTokenMotion(null);
      setView(null);
      setSession(null);
      setLobbyMode("join");
      setRoomCodeInput(session.roomCode);
      window.history.replaceState({}, "", window.location.pathname);
      showNotice("已离开房间");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "暂时无法离开房间");
    } finally {
      setPendingAction(null);
    }
  }, [pendingAction, session, showNotice, view]);

  if (!hydrated) {
    return <LoadingScene />;
  }

  if (session && !view) {
    return <LoadingScene />;
  }

  if (!session || !view) {
    return (
      <>
        <Lobby
          mode={lobbyMode}
          setMode={setLobbyMode}
          name={name}
          setName={setName}
          roomCode={roomCodeInput}
          setRoomCode={setRoomCodeInput}
          busy={lobbyBusy}
          onSubmit={submitLobby}
          onOpenRules={() => setRulesOpen(true)}
        />
        <RulesDialog open={rulesOpen} onClose={() => setRulesOpen(false)} />
        <Toast message={notice} />
      </>
    );
  }

  return (
    <main className={`app-shell app-shell--${view.phase}`}>
      <AmbientSky />
      <RoomHeader
        view={view}
        connectionState={connectionState}
        busy={pendingAction !== null}
        leaving={pendingAction === "leave"}
        onCopy={copyInvite}
        onOpenRules={() => setRulesOpen(true)}
        onLeave={leaveCurrentRoom}
      />

      {view.phase === "waiting" ? (
        <WaitingRoom
          view={view}
          pending={pendingAction}
          onStart={() => sendCommand({ type: "start" }, "start")}
          onCopy={copyInvite}
          sidePanel={sidePanel}
          setSidePanel={setSidePanel}
          onChat={(text) => sendCommand({ type: "chat", text }, "chat")}
        />
      ) : (
        <GameRoom
          view={view}
          pending={pendingAction}
          selectedOwnCard={selectedOwnCard}
          setSelectedOwnCard={setSelectedOwnCard}
          sidePanel={sidePanel}
          setSidePanel={setSidePanel}
          presentationEvent={presentationEvent}
          cardFlightMotion={cardFlightMotion}
          clueTokenMotion={clueTokenMotion}
          onCommand={sendCommand}
          onLeave={leaveCurrentRoom}
        />
      )}

      <RulesDialog open={rulesOpen} onClose={() => setRulesOpen(false)} />
      <Toast message={notice} />
    </main>
  );
}

function LoadingScene() {
  return (
    <main className="loading-scene">
      <AmbientSky />
      <div className="brand-spark brand-spark--large" aria-hidden="true">
        <span />
      </div>
      <p>正在点亮花火台…</p>
    </main>
  );
}

function AmbientSky() {
  return (
    <div className="ambient-sky" aria-hidden="true">
      <i className="sky-glow sky-glow--one" />
      <i className="sky-glow sky-glow--two" />
      <i className="sky-star sky-star--one" />
      <i className="sky-star sky-star--two" />
      <i className="sky-star sky-star--three" />
    </div>
  );
}

interface LobbyProps {
  mode: LobbyMode;
  setMode: (mode: LobbyMode) => void;
  name: string;
  setName: (name: string) => void;
  roomCode: string;
  setRoomCode: (code: string) => void;
  busy: boolean;
  onSubmit: (event: FormEvent) => void;
  onOpenRules: () => void;
}

function Lobby({
  mode,
  setMode,
  name,
  setName,
  roomCode,
  setRoomCode,
  busy,
  onSubmit,
  onOpenRules,
}: LobbyProps) {
  return (
    <main className="lobby-shell">
      <AmbientSky />
      <section className="lobby-hero">
        <nav className="lobby-nav">
          <Brand />
          <button className="text-button" type="button" onClick={onOpenRules}>
            游戏规则
          </button>
        </nav>

        <div className="hero-copy">
          <p className="eyebrow">
            <span /> 双人默契合作桌游
          </p>
          <h1>
            看见彼此，
            <br />
            <em>却看不见自己。</em>
          </h1>
          <p className="hero-lead">
            用有限的提示，在夜空中依次点亮五色花火。
            <br className="desktop-break" />
            你们共享胜负，也共享那一刻的心照不宣。
          </p>

          <div className="game-pillars" aria-label="游戏特点">
            <div>
              <span className="pillar-number">02</span>
              <span>位玩家</span>
            </div>
            <i />
            <div>
              <span className="pillar-number">25</span>
              <span>满分</span>
            </div>
            <i />
            <div>
              <span className="pillar-number">∞</span>
              <span>种默契</span>
            </div>
          </div>
        </div>
      </section>

      <section className="entry-panel">
        <div className="entry-topline">
          <span>今夜 · 花火台</span>
          <span className="live-mark">
            <i /> 本地联机
          </span>
        </div>
        <div className="entry-heading">
          <span className="mini-spark" aria-hidden="true">
            ✦
          </span>
          <div>
            <h2>{mode === "create" ? "点亮一间房" : "循着花火而来"}</h2>
            <p>
              {mode === "create"
                ? "创建后，把房间号交给你的搭档"
                : "输入搭档发来的五位房间号"}
            </p>
          </div>
        </div>

        <div className="segmented-control" role="group" aria-label="进入方式">
          <button
            type="button"
            aria-pressed={mode === "create"}
            className={mode === "create" ? "is-active" : ""}
            onClick={() => setMode("create")}
          >
            创建房间
          </button>
          <button
            type="button"
            aria-pressed={mode === "join"}
            className={mode === "join" ? "is-active" : ""}
            onClick={() => setMode("join")}
          >
            加入房间
          </button>
        </div>

        <form onSubmit={onSubmit} className="entry-form">
          <label>
            <span>你的称呼</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={16}
              autoComplete="nickname"
              placeholder="例如：小夏"
              autoFocus
            />
          </label>
          {mode === "join" && (
            <label>
              <span>房间号</span>
              <input
                className="room-code-input"
                value={roomCode}
                onChange={(event) =>
                  setRoomCode(
                    event.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, "")
                      .slice(0, 5),
                  )
                }
                maxLength={5}
                autoComplete="off"
                placeholder="A7K2M"
                aria-label="五位房间号"
              />
            </label>
          )}
          <button className="primary-button" type="submit" disabled={busy}>
            <span>{busy ? "正在准备…" : mode === "create" ? "创建房间" : "进入房间"}</span>
            <b aria-hidden="true">→</b>
          </button>
        </form>

        <p className="entry-footnote">
          <span aria-hidden="true">◇</span>
          无需注册 · 房间仅保存在本机服务中
        </p>
      </section>

      <p className="lobby-quote">
        “最好的提示，往往只有彼此才懂。”
        <span>— 花火手札</span>
      </p>
    </main>
  );
}

function Brand() {
  return (
    <div className="brand-lockup" aria-label="花火 Hanabi">
      <span className="brand-spark" aria-hidden="true">
        <i />
      </span>
      <span>
        <strong>花火</strong>
        <small>HANABI</small>
      </span>
    </div>
  );
}

interface RoomHeaderProps {
  view: RoomView;
  connectionState: ConnectionState;
  busy: boolean;
  leaving: boolean;
  onCopy: () => void;
  onOpenRules: () => void;
  onLeave: () => void;
}

function RoomHeader({
  view,
  connectionState,
  busy,
  leaving,
  onCopy,
  onOpenRules,
  onLeave,
}: RoomHeaderProps) {
  return (
    <header className="room-header">
      <Brand />
      <div className="room-header-actions">
        <div
          className={`connection-chip connection-chip--${connectionState}`}
          role="status"
          aria-live="polite"
        >
          <i />
          {connectionState === "online"
            ? "已同步"
            : connectionState === "connecting"
              ? "连接中"
              : "重连中"}
        </div>
        <button className="room-code-chip" type="button" onClick={onCopy}>
          房间 <strong>{view.code}</strong>
          <span aria-hidden="true">⧉</span>
        </button>
        <button className="icon-button" type="button" onClick={onOpenRules}>
          <span aria-hidden="true">?</span>
          <span className="sr-only">查看规则</span>
        </button>
        <button
          className="leave-button"
          type="button"
          onClick={onLeave}
          disabled={busy}
        >
          {leaving ? "离开中…" : "离开"}
        </button>
      </div>
    </header>
  );
}

interface WaitingRoomProps {
  view: RoomView;
  pending: string | null;
  onStart: () => void;
  onCopy: () => void;
  sidePanel: SidePanel;
  setSidePanel: (panel: SidePanel) => void;
  onChat: (text: string) => Promise<boolean>;
}

function WaitingRoom({
  view,
  pending,
  onStart,
  onCopy,
  sidePanel,
  setSidePanel,
  onChat,
}: WaitingRoomProps) {
  const self = view.players.find((player) => player.isSelf)!;
  const ready = view.players.length === 2 && view.players.every((p) => p.connected);
  const isHost = self.id === view.hostId;
  const waitingForReconnect =
    view.players.length === 2 && !view.players.every((player) => player.connected);

  return (
    <div className="waiting-layout">
      <section className="waiting-main panel">
        <div className="waiting-visual" aria-hidden="true">
          <span className="waiting-ring waiting-ring--one" />
          <span className="waiting-ring waiting-ring--two" />
          <span className="waiting-center">
            <i />
          </span>
        </div>
        <p className="eyebrow centered">
          <span /> 花火尚未升空
        </p>
        <h1 aria-live="polite">
          {view.players.length === 1
            ? "等待另一位花火师"
            : waitingForReconnect
              ? "等待花火师重新连线"
              : "两位花火师已就位"}
        </h1>
        <p className="waiting-copy">
          {view.players.length === 1
            ? "把房间号或邀请链接发给你的搭档。页面可以保持打开，TA 到来时会自动出现。"
            : waitingForReconnect
              ? "座位会为离线的玩家保留；重新打开邀请页面即可恢复这间房。"
            : isHost
              ? "你们都已连上花火台。准备好后，由你点燃第一束引线。"
              : "你们都已连上花火台，等待房主点燃第一束引线。"}
        </p>

        <button className="invite-code" type="button" onClick={onCopy}>
          <span>房间号</span>
          <strong>{view.code}</strong>
          <small>点击复制邀请链接</small>
        </button>

        <div className="seat-row">
          {[0, 1].map((seat) => {
            const player = view.players[seat];
            return player ? (
              <div className="seat-card" key={player.id}>
                <PlayerAvatar name={player.name} online={player.connected} />
                <div>
                  <strong>
                    {player.name}
                    {player.isSelf && <em>你</em>}
                  </strong>
                  <span>
                    {player.isHost ? "房主" : "搭档"} ·{" "}
                    {player.connected ? "已就位" : "暂时离线"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="seat-card seat-card--empty" key="empty">
                <span className="empty-avatar">+</span>
                <div>
                  <strong>等待加入</strong>
                  <span>第二位花火师</span>
                </div>
              </div>
            );
          })}
        </div>

        {isHost ? (
          <button
            className="primary-button waiting-start"
            type="button"
            disabled={!ready || pending !== null}
            onClick={onStart}
          >
            <span>{pending === "start" ? "正在点燃…" : "开始这场花火"}</span>
            <b aria-hidden="true">✦</b>
          </button>
        ) : (
          <div className="host-waiting">
            <i />
            房主准备好后即可开始
          </div>
        )}
      </section>

      <aside className="waiting-side panel">
        <SidePanelTabs active={sidePanel} onChange={setSidePanel} view={view} />
        {sidePanel === "chat" ? (
          <ChatPanel
            view={view}
            disabled={pending !== null}
            onSend={onChat}
          />
        ) : (
          <Timeline view={view} />
        )}
      </aside>
    </div>
  );
}

function PlayerAvatar({
  name,
  online,
  compact = false,
}: {
  name: string;
  online: boolean;
  compact?: boolean;
}) {
  return (
    <span className={`player-avatar ${compact ? "player-avatar--compact" : ""}`}>
      {name.slice(0, 1).toUpperCase()}
      <i className={online ? "is-online" : ""} />
    </span>
  );
}

interface GameRoomProps {
  view: RoomView;
  pending: string | null;
  selectedOwnCard: string | null;
  setSelectedOwnCard: (cardId: string | null) => void;
  sidePanel: SidePanel;
  setSidePanel: (panel: SidePanel) => void;
  presentationEvent: PresentationEvent | null;
  cardFlightMotion: CardFlightMotion | null;
  clueTokenMotion: ClueTokenMotion | null;
  onCommand: (command: RoomCommand, actionName: string) => Promise<boolean>;
  onLeave: () => void;
}

type ChatFabOffset = { x: number; y: number };
type ChatFabDragSession = {
  pointerId: number;
  pointerX: number;
  pointerY: number;
  originLeft: number;
  originTop: number;
  width: number;
  height: number;
  offset: ChatFabOffset;
  moved: boolean;
};

function clampToRange(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function viewportDragBounds(width: number, height: number) {
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  const viewportWidth = viewport?.width ?? window.innerWidth;
  const viewportHeight = viewport?.height ?? window.innerHeight;
  const gutter = 8;
  return {
    minLeft: left + gutter,
    maxLeft: left + viewportWidth - width - gutter,
    minTop: top + gutter,
    maxTop: top + viewportHeight - height - gutter,
  };
}

function DraggableMobileChatFab({
  unreadCount,
  onOpen,
}: {
  unreadCount: number;
  onOpen: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dragSessionRef = useRef<ChatFabDragSession | null>(null);
  const suppressClickRef = useRef(false);
  const [offset, setOffset] = useState<ChatFabOffset>({ x: 0, y: 0 });

  const keepInsideViewport = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const bounds = viewportDragBounds(rect.width, rect.height);
    const left = clampToRange(rect.left, bounds.minLeft, bounds.maxLeft);
    const top = clampToRange(rect.top, bounds.minTop, bounds.maxTop);
    const deltaX = left - rect.left;
    const deltaY = top - rect.top;
    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;
    setOffset((current) => ({
      x: current.x + deltaX,
      y: current.y + deltaY,
    }));
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(keepInsideViewport);
    window.addEventListener("resize", keepInsideViewport);
    window.visualViewport?.addEventListener("resize", keepInsideViewport);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", keepInsideViewport);
      window.visualViewport?.removeEventListener("resize", keepInsideViewport);
    };
  }, [keepInsideViewport]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragSessionRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - drag.pointerX;
      const deltaY = event.clientY - drag.pointerY;
      if (!drag.moved && Math.hypot(deltaX, deltaY) >= 5) {
        drag.moved = true;
      }
      if (!drag.moved) return;

      event.preventDefault();
      const bounds = viewportDragBounds(drag.width, drag.height);
      const left = clampToRange(
        drag.originLeft + deltaX,
        bounds.minLeft,
        bounds.maxLeft,
      );
      const top = clampToRange(
        drag.originTop + deltaY,
        bounds.minTop,
        bounds.maxTop,
      );
      setOffset({
        x: drag.offset.x + left - drag.originLeft,
        y: drag.offset.y + top - drag.originTop,
      });
    };

    const finishPointer = (event: PointerEvent) => {
      const drag = dragSessionRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const button = buttonRef.current;
      if (button?.hasPointerCapture(event.pointerId)) {
        button.releasePointerCapture(event.pointerId);
      }
      dragSessionRef.current = null;
      if (drag.moved) {
        event.preventDefault();
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
    };

    window.addEventListener("pointermove", handlePointerMove, {
      passive: false,
    });
    window.addEventListener("pointerup", finishPointer, { passive: false });
    window.addEventListener("pointercancel", finishPointer, {
      passive: false,
    });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishPointer);
      window.removeEventListener("pointercancel", finishPointer);
    };
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragSessionRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      width: rect.width,
      height: rect.height,
      offset,
      moved: false,
    };
  };

  return (
    <button
      className="mobile-chat-fab"
      ref={buttonRef}
      type="button"
      aria-label={unreadCount > 0 ? `打开对话，${unreadCount} 条新消息` : "打开对话"}
      title="点击打开对话，按住拖动位置"
      style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }}
      onPointerDown={handlePointerDown}
      onClick={() => {
        if (!suppressClickRef.current) onOpen();
      }}
    >
      <span aria-hidden="true" />
      {unreadCount > 0 && <strong>{Math.min(unreadCount, 99)}</strong>}
    </button>
  );
}

function GameRoom({
  view,
  pending,
  selectedOwnCard,
  setSelectedOwnCard,
  sidePanel,
  setSidePanel,
  presentationEvent,
  cardFlightMotion,
  clueTokenMotion,
  onCommand,
  onLeave,
}: GameRoomProps) {
  const [cardMenu, setCardMenu] = useState<CardMenuState>(null);
  const [cluePreview, setCluePreview] = useState<CluePreview>(null);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [completedPerfectRound, setCompletedPerfectRound] = useState<
    number | null
  >(null);
  const isCompactChat = useMediaQuery("(max-width: 980px)");
  const seenChatIdsRef = useRef(
    new Set(view.chat.map((message) => message.id)),
  );
  const tableRef = useRef<HTMLElement | null>(null);
  const self = view.players.find((player) => player.isSelf)!;
  const teammate = view.players.find((player) => !player.isSelf)!;
  const resolvedCardMenu =
    cardMenu &&
    (cardMenu.owner === "self" ? self.hand : teammate.hand).some(
      (card) => card.id === cardMenu.cardId,
    )
      ? cardMenu
      : null;
  const isMyTurn = view.turnPlayerId === self.id;
  const canAct = isMyTurn && teammate.connected;
  const currentPlayer = view.players.find(
    (player) => player.id === view.turnPlayerId,
  );
  const clueEnabled =
    canAct &&
    view.phase === "playing" &&
    view.clues > 0 &&
    pending === null;
  const ownActionEnabled =
    canAct && view.phase === "playing" && pending === null;
  const discardAllowed = view.clues < view.maxClues;
  const previewCardIds = useMemo(() => {
    if (!cluePreview) return new Set<string>();
    return new Set(
      teammate.hand
        .filter((card) =>
          cluePreview.clueType === "color"
            ? card.color === cluePreview.value
            : card.rank === cluePreview.value,
        )
        .map((card) => card.id),
    );
  }, [cluePreview, teammate.hand]);
  const eventCardIds = useMemo(
    () =>
      new Set(
        presentationEvent?.kind === "clue"
          ? presentationEvent.affectedCardIds
          : [],
      ),
    [presentationEvent],
  );
  const isPerfectEnding =
    view.phase === "ended" && view.result?.reason === "perfect";
  const perfectFinaleComplete = completedPerfectRound === view.round;
  const perfectSequenceKey = view.playedFireworks
    .map((played) => played.id)
    .join("|");
  const perfectSequence = useMemo(
    () => view.playedFireworks,
    // The server sends a fresh array for every view. The stable id sequence
    // keeps an in-progress finale from restarting on an unrelated update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [perfectSequenceKey],
  );
  const finishPerfectFinale = useCallback(
    () => setCompletedPerfectRound(view.round),
    [view.round],
  );

  useEffect(() => {
    const seenChatIds = seenChatIdsRef.current;
    const incoming = view.chat
      .filter((message) => !seenChatIds.has(message.id))
      .filter((message) => message.playerId !== self.id).length;
    seenChatIdsRef.current = new Set(
      view.chat.map((message) => message.id),
    );
    const chatVisible = isCompactChat
      ? mobileChatOpen && sidePanel === "chat"
      : sidePanel === "chat";
    if (incoming > 0 && !chatVisible) {
      setUnreadChatCount((count) => count + incoming);
    } else if (chatVisible) {
      setUnreadChatCount(0);
    }
  }, [isCompactChat, mobileChatOpen, self.id, sidePanel, view.chat]);

  const showSidePanel = (panel: SidePanel) => {
    setSidePanel(panel);
    if (panel === "chat") setUnreadChatCount(0);
  };

  useEffect(() => {
    if (
      presentationEvent?.kind !== "misfire" ||
      !tableRef.current ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    tableRef.current.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-7px)" },
        { transform: "translateX(6px)" },
        { transform: "translateX(-4px)" },
        { transform: "translateX(3px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 460, delay: 410, easing: "ease-out" },
    );
  }, [presentationEvent]);

  const closeCardMenu = () => {
    setCardMenu(null);
    setCluePreview(null);
  };

  const sendClue = async (
    clueType: "color" | "rank",
    value: HanabiColor | HanabiRank,
  ) => {
    const succeeded = await onCommand(
      clueType === "color"
        ? {
            type: "clue",
            targetPlayerId: teammate.id,
            clueType,
            value: value as HanabiColor,
          }
        : {
            type: "clue",
            targetPlayerId: teammate.id,
            clueType,
            value: value as HanabiRank,
          },
      "clue",
    );
    if (succeeded) closeCardMenu();
  };

  const actOnOwnCard = async (kind: "play" | "discard", cardId: string) => {
    const succeeded = await onCommand({ type: kind, cardId }, kind);
    if (succeeded) closeCardMenu();
  };

  return (
    <div className="game-layout">
      <GameEventEffects
        event={presentationEvent}
        selfId={self.id}
        flightMotion={cardFlightMotion}
        clueTokenMotion={clueTokenMotion}
      />
      {isPerfectEnding && !perfectFinaleComplete && (
        <PerfectFinale
          sequence={perfectSequence}
          onComplete={finishPerfectFinale}
        />
      )}
      <section className="game-column">
        <GameStatusBar
          view={view}
          currentPlayer={currentPlayer}
        />

        {!teammate.connected && (
          <div className="offline-banner" role="status">
            <i />
            {teammate.name} 暂时离线，牌局会在这里等候重连
          </div>
        )}

        <section
          className={`table-panel panel ${
            presentationEvent ? `has-event event-${presentationEvent.kind}` : ""
          }`}
          ref={tableRef}
        >
          <div className="hand-section opponent-section">
            <HandHeading
              player={teammate}
              subtitle={
                !teammate.connected
                  ? "搭档离线，牌局已暂停"
                  : isMyTurn && view.phase === "playing"
                  ? "选择一种颜色或数字给出提示"
                  : "你能看见这组手牌"
              }
              turn={view.turnPlayerId === teammate.id}
            />
            <AnimatedCardRow
              className="card-row card-row--visible"
              presentationEvent={presentationEvent}
              ownerId={teammate.id}
            >
              {teammate.hand.map((card, index) => (
                <div
                  className="card-motion-shell"
                  data-card-id={card.id}
                  key={card.id}
                >
                  <VisibleCard
                    card={card}
                    index={index}
                    highlighted={previewCardIds.has(card.id)}
                    cluePulse={eventCardIds.has(card.id)}
                    menuOpen={
                      resolvedCardMenu?.owner === "teammate" &&
                      resolvedCardMenu.cardId === card.id
                    }
                    onOpen={() => {
                      setMobileChatOpen(false);
                      setCardMenu({ owner: "teammate", cardId: card.id });
                    }}
                  />
                </div>
              ))}
            </AnimatedCardRow>
            <p className="card-clue-instruction">
              {clueEnabled
                ? "点击任意一张搭档手牌，再选择提示它的颜色或数字"
                : view.clues === 0
                  ? "提示筹码已经用完"
                  : "轮到你行动时，可点击搭档手牌给出提示"}
            </p>
          </div>

          <div className="table-divider">
            <span />
            <p>
              {view.phase === "ended"
                ? "演出落幕"
                : isMyTurn
                  ? "轮到你了"
                  : `${currentPlayer?.name ?? "搭档"} 正在思考`}
            </p>
            <span />
          </div>

          <HanabiTableau view={view} />

          <div className="table-divider">
            <span />
            <p>你的手牌 · 看不见真实牌面</p>
            <span />
          </div>

          <div className="hand-section own-section">
            <HandHeading
              player={self}
              subtitle="直接拖牌：左侧弃牌，右侧点燃；空白处松手取消"
              turn={isMyTurn}
            />
            <AnimatedCardRow
              className="card-row card-row--hidden"
              presentationEvent={presentationEvent}
              ownerId={self.id}
            >
              {self.hand.map((card, index) => (
                <DragActionCard
                  key={card.id}
                  card={card}
                  index={index}
                  total={self.hand.length}
                  selected={selectedOwnCard === card.id}
                  cluePulse={eventCardIds.has(card.id)}
                  disabled={!ownActionEnabled}
                  discardAllowed={discardAllowed}
                  menuOpen={
                    resolvedCardMenu?.owner === "self" &&
                    resolvedCardMenu.cardId === card.id
                  }
                  onSelect={() => {
                    setMobileChatOpen(false);
                    setSelectedOwnCard(card.id);
                    setCardMenu({ owner: "self", cardId: card.id });
                  }}
                  onAction={actOnOwnCard}
                />
              ))}
            </AnimatedCardRow>
            <p className="own-drag-instruction">
              按住卡牌直接拖动：进入左侧弃牌区或右侧点燃区后松手即可执行
            </p>
          </div>
        </section>
      </section>

      {resolvedCardMenu && (
        <CardActionDialog
          menu={resolvedCardMenu}
          self={self}
          teammate={teammate}
          view={view}
          clueEnabled={clueEnabled}
          ownActionEnabled={ownActionEnabled}
          onClose={closeCardMenu}
          onPreview={setCluePreview}
          onClue={sendClue}
        />
      )}

      {isCompactChat && mobileChatOpen && (
        <button
          className="mobile-chat-scrim"
          type="button"
          aria-label="收起对话并返回牌桌"
          onClick={() => setMobileChatOpen(false)}
        />
      )}

      <aside
        className={`game-sidebar panel ${mobileChatOpen ? "is-mobile-open" : ""}`}
        aria-hidden={isCompactChat && !mobileChatOpen}
      >
        <button
          className="mobile-chat-close"
          type="button"
          onClick={() => setMobileChatOpen(false)}
        >
          收起对话
        </button>
        <SidePanelTabs
          active={sidePanel}
          onChange={showSidePanel}
          view={view}
          unreadChatCount={unreadChatCount}
        />
        {sidePanel === "chat" ? (
          <ChatPanel
            view={view}
            disabled={pending !== null}
            onSend={(text) => onCommand({ type: "chat", text }, "chat")}
          />
        ) : (
          <Timeline view={view} />
        )}
      </aside>

      {!resolvedCardMenu && view.phase !== "ended" && (
        <DraggableMobileChatFab
          unreadCount={unreadChatCount}
          onOpen={() => {
            setSidePanel("chat");
            setUnreadChatCount(0);
            setMobileChatOpen(true);
          }}
        />
      )}

      {view.phase === "ended" &&
        view.result &&
        (!isPerfectEnding || perfectFinaleComplete) && (
        <ResultOverlay
          view={view}
          pending={pending}
          onRestart={() => onCommand({ type: "restart" }, "restart")}
          onLeave={onLeave}
        />
      )}
    </div>
  );
}

function AnimatedCardRow({
  className,
  presentationEvent,
  ownerId,
  children,
}: {
  className: string;
  presentationEvent: PresentationEvent | null;
  ownerId: string;
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const previousPositionsRef = useRef(
    new Map<string, { left: number; top: number }>(),
  );
  const previousOrderRef = useRef("");

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;

    const cardNodes = Array.from(
      row.querySelectorAll<HTMLElement>("[data-card-id]"),
    );
    const nextPositions = new Map<string, { left: number; top: number }>();
    const nextOrder = cardNodes
      .map((node) => node.dataset.cardId)
      .filter(Boolean)
      .join("|");
    cardNodes.forEach((node) => {
      const cardId = node.dataset.cardId;
      if (cardId) {
        nextPositions.set(cardId, { left: node.offsetLeft, top: node.offsetTop });
      }
    });

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const orderChanged = previousOrderRef.current !== nextOrder;
    if (!reducedMotion && orderChanged) {
      cardNodes.forEach((node, index) => {
        const cardId = node.dataset.cardId;
        if (!cardId) return;
        const previousPosition = previousPositionsRef.current.get(cardId);
        const nextPosition = nextPositions.get(cardId);
        node.getAnimations().forEach((animation) => animation.cancel());

        if (previousPosition && nextPosition) {
          const deltaX = previousPosition.left - nextPosition.left;
          if (Math.abs(deltaX) > 1) {
            const animation = node.animate(
              [
                { transform: `translateX(${deltaX}px)` },
                { transform: "translateX(0)" },
              ],
              {
                duration: 520,
                easing: "cubic-bezier(.2,.85,.25,1)",
                fill: "none",
              },
            );
            void animation.finished
              .then(() => animation.cancel())
              .catch(() => undefined);
          }
          return;
        }

        const isDealt =
          presentationEvent?.kind === "deal" &&
          presentationEvent.dealtCardIds[ownerId]?.includes(cardId);
        const isDrawn =
          presentationEvent &&
          presentationEvent.kind !== "deal" &&
          presentationEvent.kind !== "clue" &&
          presentationEvent.actorId === ownerId &&
          presentationEvent.drawnCardId === cardId;

        if (isDealt || isDrawn) {
          const animation = node.animate(
            [
              {
                opacity: 0,
                transform: `translate(${
                  ownerId === presentationEvent?.actorId ? 0 : 24
                }px, ${isDealt ? (index % 2 === 0 ? 80 : -80) : 110}px) rotate(${
                  (index - 2) * 6
                }deg) scale(.72)`,
              },
              {
                opacity: 1,
                transform: "translate(0, 0) rotate(0) scale(1)",
              },
            ],
            {
              duration: isDealt ? 650 : 560,
              delay: isDealt ? index * 90 : 260,
              easing: "cubic-bezier(.16,.86,.28,1)",
              fill: "backwards",
            },
          );
          void animation.finished
            .then(() => animation.cancel())
            .catch(() => undefined);
        }
      });
    }

    previousPositionsRef.current = nextPositions;
    previousOrderRef.current = nextOrder;
  });

  return (
    <div className={className} ref={rowRef}>
      {children}
    </div>
  );
}

function GameEventEffects({
  event,
  selfId,
  flightMotion,
  clueTokenMotion,
}: {
  event: PresentationEvent | null;
  selfId: string;
  flightMotion: CardFlightMotion | null;
  clueTokenMotion: ClueTokenMotion | null;
}) {
  if (!event) return null;

  const isCardEvent =
    event.kind === "play" ||
    event.kind === "misfire" ||
    event.kind === "discard";
  const rankEffectCopy: Record<HanabiRank, string> = {
    1: "引线点燃",
    2: "初绽成环",
    3: "花开夜空",
    4: "华彩盛放",
    5: "终幕满天",
  };
  let eyebrow = "花火台";
  let message = "新一轮花火已经开始";
  const resolvedFlight =
    isCardEvent && flightMotion?.eventId === event.id ? flightMotion : null;
  const flightStyle =
    isCardEvent && resolvedFlight
      ? ({
          left: `${resolvedFlight.origin.left}px`,
          top: `${resolvedFlight.origin.top}px`,
          width: `${resolvedFlight.origin.width}px`,
          height: `${resolvedFlight.origin.height}px`,
          "--flight-dx": `${
            resolvedFlight.target.left +
            resolvedFlight.target.width / 2 -
            (resolvedFlight.origin.left + resolvedFlight.origin.width / 2)
          }px`,
          "--flight-dy": `${
            resolvedFlight.target.top +
            resolvedFlight.target.height / 2 -
            (resolvedFlight.origin.top + resolvedFlight.origin.height / 2)
          }px`,
          "--flight-card-art": `url("/art/card-face-${event.card.color}-v2.webp")`,
        } as CSSProperties)
      : undefined;

  if (event.kind === "deal") {
    eyebrow = "洗牌 · 发牌";
    message = "十张手牌依次入席";
  } else if (event.kind === "clue") {
    eyebrow = "提示已送达";
    message =
      event.clueType === "color"
        ? `${COLOR_NAMES[event.clueValue as HanabiColor]} · 命中 ${event.affectedCardIds.length} 张`
        : `数字 ${event.clueValue} · 命中 ${event.affectedCardIds.length} 张`;
  } else if (event.kind === "play") {
    eyebrow = `成功 · ${rankEffectCopy[event.card.rank]}`;
    message = `${COLOR_NAMES[event.card.color]} ${event.card.rank} 接续升空`;
  } else if (event.kind === "discard") {
    eyebrow = "弃牌 · 收回提示";
    message = `${COLOR_NAMES[event.card.color]} ${event.card.rank} 落入弃牌盘`;
  } else if (event.kind === "misfire") {
    eyebrow = "打出失败 · 引线熄灭";
    message = `${COLOR_NAMES[event.card.color]} ${event.card.rank} 无法接续；当前需要 ${
      event.expectedRank ?? "下一张"
    }`;
  }

  return (
    <div
      className={`game-event-effects effect-${event.kind} ${
        isCardEvent ? `effect-${event.card.color}` : ""
      } ${event.kind === "play" ? `effect-rank-${event.card.rank}` : ""}`}
      key={event.id}
      aria-live="assertive"
      aria-atomic="true"
    >
      <div className="event-screen-wash" aria-hidden="true" />
      {event.kind === "deal" && (
        <div className="deal-spectacle" aria-hidden="true">
          {Array.from({ length: 10 }).map((_, index) => (
            <i
              key={index}
              style={
                {
                  "--deal-index": index,
                  "--deal-x": `${31 + Math.floor(index / 2) * 9.5}%`,
                  "--deal-y": index % 2 === 0 ? "29%" : "75%",
                  "--deal-rotate": `${(Math.floor(index / 2) - 2) * 3}deg`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}
      {isCardEvent && (
        <div
          className={`motion-card ${
            event.actorId === selfId ? "from-self" : "from-teammate"
          } ${resolvedFlight ? "has-measured-flight" : ""}`}
          style={flightStyle}
          data-flight-kind={event.kind}
          aria-hidden="true"
        >
          <span className="motion-card-corner">
            <strong>{event.card.rank}</strong>
            <small>{COLOR_LABELS[event.card.color]}</small>
          </span>
        </div>
      )}
      {event.kind === "play" && (
        <FireworkParticleEffect color={event.card.color} rank={event.card.rank} />
      )}
      {event.kind === "misfire" && (
        <SmokeParticleEffect color={event.card.color} />
      )}
      {event.kind === "clue" && (
        <ClueTokenTransfer event={event} motion={clueTokenMotion} />
      )}
      <div className="event-callout">
        <small>{eyebrow}</small>
        <strong>{message}</strong>
      </div>
    </div>
  );
}

function CardActionDialog({
  menu,
  self,
  teammate,
  view,
  clueEnabled,
  ownActionEnabled,
  onClose,
  onPreview,
  onClue,
}: {
  menu: Exclude<CardMenuState, null>;
  self: PlayerView;
  teammate: PlayerView;
  view: RoomView;
  clueEnabled: boolean;
  ownActionEnabled: boolean;
  onClose: () => void;
  onPreview: (preview: CluePreview) => void;
  onClue: (
    clueType: "color" | "rank",
    value: HanabiColor | HanabiRank,
  ) => Promise<void>;
}) {
  const dialogRef = useDialogFocus<HTMLElement>(true, onClose);
  const owner = menu.owner === "self" ? self : teammate;
  const card = owner.hand.find((item) => item.id === menu.cardId);
  if (!card) return null;

  const discardAllowed = view.clues < view.maxClues;
  const color = card.color as HanabiColor | null;
  const rank = card.rank as HanabiRank | null;
  const colorAlreadyKnown = color !== null && card.knownColor === color;
  const rankAlreadyKnown = rank !== null && card.knownRank === rank;
  const matchingCards = (clueType: "color" | "rank") =>
    teammate.hand.filter((item) =>
      clueType === "color" ? item.color === color : item.rank === rank,
    );
  const matchingPositions = (clueType: "color" | "rank") =>
    teammate.hand
      .map((item, index) => ({
        matches:
          clueType === "color"
            ? item.color === color
            : item.rank === rank,
        position: index + 1,
      }))
      .filter((item) => item.matches)
      .map((item) => item.position);

  return (
    <div
      className="card-action-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className={`card-action-dialog dialog-${menu.owner}`}
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-action-title"
        onMouseDown={(event: ReactMouseEvent) => event.stopPropagation()}
      >
        <header>
          <div className="dialog-card-seal" aria-hidden="true">
            {menu.owner === "teammate" ? (
              <>
                <strong>{rank}</strong>
                <small>{color ? COLOR_LABELS[color] : ""}</small>
              </>
            ) : (
              <span>花</span>
            )}
          </div>
          <div>
            <p>
              {menu.owner === "teammate"
                ? `搭档的第 ${teammate.hand.indexOf(card) + 1} 张牌`
                : `自己的第 ${self.hand.indexOf(card) + 1} 张牌`}
            </p>
            <h2 id="card-action-title">
              {menu.owner === "teammate" ? "选择要给出的提示" : "选择这张牌的操作"}
            </h2>
          </div>
          <button
            className="card-dialog-close"
            type="button"
            onClick={onClose}
            aria-label="关闭卡片操作"
          >
            ×
          </button>
        </header>

        {menu.owner === "teammate" && color && rank ? (
          <>
            <p className="card-dialog-explainer">
              正式提示会消耗 1 枚提示标记，并同时标出所有同色或同数字的牌。
              桌面可右键，手机与桌面均可直接点牌打开这里。
            </p>
            <div className="card-dialog-memory" aria-label="搭档当前掌握的信息">
              <div className={colorAlreadyKnown ? "is-known" : "is-unknown"}>
                <i aria-hidden="true" />
                <span>
                  <small>颜色信息</small>
                  <strong>
                    {colorAlreadyKnown ? `搭档已知道${COLOR_NAMES[color]}` : "搭档尚不知道颜色"}
                  </strong>
                  {!colorAlreadyKnown && card.excludedColors.length > 0 && (
                    <em>
                      已排除 {card.excludedColors.map((item) => COLOR_LABELS[item]).join("、")}
                    </em>
                  )}
                </span>
              </div>
              <div className={rankAlreadyKnown ? "is-known" : "is-unknown"}>
                <i aria-hidden="true" />
                <span>
                  <small>数字信息</small>
                  <strong>
                    {rankAlreadyKnown ? `搭档已知道数字 ${rank}` : "搭档尚不知道数字"}
                  </strong>
                  {!rankAlreadyKnown && card.excludedRanks.length > 0 && (
                    <em>已排除 {card.excludedRanks.join("、")}</em>
                  )}
                </span>
              </div>
            </div>
            <div
              className="context-clue-options"
              onMouseLeave={() => onPreview(null)}
            >
              <button
                type="button"
                disabled={!clueEnabled}
                onMouseEnter={() =>
                  onPreview({ clueType: "color", value: color })
                }
                onFocus={() =>
                  onPreview({ clueType: "color", value: color })
                }
                onClick={() => onClue("color", color)}
              >
                <span className={`clue-option-emblem clue-${color}`}>
                  {COLOR_LABELS[color]}
                </span>
                <span>
                  <strong>
                    提示{COLOR_NAMES[color]}
                    <em className={`clue-option-memory ${colorAlreadyKnown ? "is-known" : ""}`}>
                      {colorAlreadyKnown ? "这张已知" : "尚未告知"}
                    </em>
                  </strong>
                  <small>
                    揭示第 {matchingPositions("color").join("、")} 张 ·{" "}
                    {matchingCards("color").every((item) => item.knownColor === color)
                      ? "同色牌均已知道，重复提示仍会消耗筹码"
                      : `${matchingCards("color").filter((item) => item.knownColor !== color).length} 张尚不知道颜色`}
                  </small>
                </span>
                <b aria-hidden="true">→</b>
              </button>
              <button
                type="button"
                disabled={!clueEnabled}
                onMouseEnter={() =>
                  onPreview({ clueType: "rank", value: rank })
                }
                onFocus={() => onPreview({ clueType: "rank", value: rank })}
                onClick={() => onClue("rank", rank)}
              >
                <span className="clue-option-emblem clue-number">{rank}</span>
                <span>
                  <strong>
                    提示数字 {rank}
                    <em className={`clue-option-memory ${rankAlreadyKnown ? "is-known" : ""}`}>
                      {rankAlreadyKnown ? "这张已知" : "尚未告知"}
                    </em>
                  </strong>
                  <small>
                    揭示第 {matchingPositions("rank").join("、")} 张 ·{" "}
                    {matchingCards("rank").every((item) => item.knownRank === rank)
                      ? "同数字牌均已知道，重复提示仍会消耗筹码"
                      : `${matchingCards("rank").filter((item) => item.knownRank !== rank).length} 张尚不知道数字`}
                  </small>
                </span>
                <b aria-hidden="true">→</b>
              </button>
            </div>
            {!clueEnabled && (
              <p className="card-dialog-status" role="status">
                {view.clues === 0
                  ? "提示标记已经用完"
                  : !teammate.connected
                    ? "搭档重连后才能继续"
                    : "轮到你时才可以给出提示"}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="own-card-reveal-copy">
              这张牌会随着搭档给出的提示逐步显现：
              {card.knownColor ? `颜色已揭示为${COLOR_NAMES[card.knownColor]}` : "颜色尚未揭示"}
              ，{card.knownRank ? `数字已揭示为 ${card.knownRank}` : "数字尚未揭示"}。
            </p>
            <div className="own-card-drag-guide" aria-label="卡牌拖拽操作说明">
              <span className="drag-guide-discard">
                <i aria-hidden="true" />
                <strong>向左拖动</strong>
                <small>{discardAllowed ? "弃牌并换回筹码" : "筹码已满，当前不可弃牌"}</small>
              </span>
              <b aria-hidden="true">← 卡牌 →</b>
              <span className="drag-guide-play">
                <i aria-hidden="true" />
                <strong>向右拖动</strong>
                <small>松手点燃这张牌</small>
              </span>
            </div>
            <p className="own-card-drag-copy">关闭此窗口后，直接拖动这张手牌；在两个目标以外松手会安全取消。</p>
            {!ownActionEnabled && (
              <p className="card-dialog-status" role="status">
                {!teammate.connected ? "搭档重连后才能继续" : "现在还没轮到你"}
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function GameStatusBar({
  view,
  currentPlayer,
}: {
  view: RoomView;
  currentPlayer?: PlayerView;
}) {
  const offlinePlayer = view.players.find((player) => !player.connected);
  return (
    <section className="status-bar panel" aria-label="牌局状态">
      <div className="turn-status">
        <span className="turn-orbit" aria-hidden="true">
          <i />
        </span>
        <div>
          <small>
            {view.finalTurnsRemaining !== null
              ? `最终轮 · 剩 ${view.finalTurnsRemaining} 回合`
              : `第 ${view.round} 场`}
          </small>
          <strong aria-live="polite" aria-atomic="true">
            {view.phase === "ended"
              ? "演出已经结束"
              : offlinePlayer
                ? `等待 ${offlinePlayer.name} 重连`
              : currentPlayer?.isSelf
                ? "轮到你行动"
                : `等待 ${currentPlayer?.name ?? "搭档"} 行动`}
          </strong>
        </div>
      </div>
    </section>
  );
}

function HandHeading({
  player,
  subtitle,
  turn,
}: {
  player: PlayerView;
  subtitle: string;
  turn: boolean;
}) {
  return (
    <div className="hand-heading">
      <div>
        <PlayerAvatar name={player.name} online={player.connected} compact />
        <span>
          <strong>
            {player.name}
            {player.isSelf && <em>你</em>}
          </strong>
          <small>{subtitle}</small>
        </span>
      </div>
      <span className={`turn-badge ${turn ? "is-active" : ""}`}>
        <i />
        {turn ? "行动中" : "等待"}
      </span>
    </div>
  );
}

function VisibleCard({
  card,
  index,
  highlighted,
  cluePulse,
  menuOpen,
  onOpen,
}: {
  card: CardView;
  index: number;
  highlighted: boolean;
  cluePulse: boolean;
  menuOpen: boolean;
  onOpen: () => void;
}) {
  const colorKnown = Boolean(card.knownColor);
  const rankKnown = Boolean(card.knownRank);
  const knowledgeDescription = [
    colorKnown
      ? `搭档已知道颜色是${COLOR_NAMES[card.knownColor!]}`
      : card.excludedColors.length > 0
        ? `搭档已排除${card.excludedColors.map((item) => COLOR_NAMES[item]).join("、")}`
        : "搭档尚不知道颜色",
    rankKnown
      ? `搭档已知道数字 ${card.knownRank}`
      : card.excludedRanks.length > 0
        ? `搭档已排除数字 ${card.excludedRanks.join("、")}`
        : "搭档尚不知道数字",
  ].join("；");
  const cardStyle = {
    "--card-face-art": `url("/art/card-face-${card.color}-v2.webp")`,
  } as CSSProperties;
  return (
    <button
      type="button"
      className={`hanabi-card visible-card color-${card.color} rank-${card.rank} ${
        highlighted ? "is-clue-preview" : ""
      } ${cluePulse ? "is-clue-hit" : ""} ${menuOpen ? "is-menu-open" : ""}`}
      style={cardStyle}
      onClick={onOpen}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpen();
      }}
      onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          onOpen();
        }
      }}
      aria-haspopup="dialog"
      aria-expanded={menuOpen}
      aria-label={`第 ${index + 1} 张，${COLOR_NAMES[card.color!]} ${card.rank}；${knowledgeDescription}。点击选择提示`}
    >
      <span className="card-corner">
        <strong>{card.rank}</strong>
        <small>{COLOR_LABELS[card.color!]}</small>
      </span>
      <span className="card-position">第 {index + 1} 张</span>
      {card.isNewest && <span className="new-card-tag">最新</span>}
      <span
        className={`teammate-card-memory ${colorKnown && rankKnown ? "is-complete" : ""}`}
        aria-hidden="true"
      >
        {colorKnown && (
          <span className={`card-knowledge-seal seal-color seal-${card.knownColor}`}>
            <i />
            <b>{COLOR_LABELS[card.knownColor!]}</b>
          </span>
        )}
        {rankKnown && (
          <span className="card-knowledge-seal seal-rank">
            <i />
            <b>数</b>
          </span>
        )}
        {!colorKnown && card.excludedColors.length > 0 && (
          <span
            className="card-exclusion-seal exclusion-color"
            data-count={card.excludedColors.length}
          >
            <i />
          </span>
        )}
        {!rankKnown && card.excludedRanks.length > 0 && (
          <span
            className="card-exclusion-seal exclusion-rank"
            data-count={card.excludedRanks.length}
          >
            <i />
          </span>
        )}
      </span>
      <span className="card-tap-affordance" aria-hidden="true">
        提示
      </span>
    </button>
  );
}

function SidePanelTabs({
  active,
  onChange,
  view,
  unreadChatCount = 0,
}: {
  active: SidePanel;
  onChange: (panel: SidePanel) => void;
  view: RoomView;
  unreadChatCount?: number;
}) {
  return (
    <div className="side-tabs" role="group" aria-label="侧栏内容">
      <button
        type="button"
        aria-pressed={active === "chat"}
        className={active === "chat" ? "is-active" : ""}
        onClick={() => onChange("chat")}
      >
        对话
        {unreadChatCount > 0 && (
          <span className="unread-count" aria-label={`${unreadChatCount} 条新消息`}>
            {Math.min(unreadChatCount, 99)}
          </span>
        )}
      </button>
      <button
        type="button"
        aria-pressed={active === "timeline"}
        className={active === "timeline" ? "is-active" : ""}
        onClick={() => onChange("timeline")}
      >
        记录
        <span>{view.timeline.length}</span>
      </button>
    </div>
  );
}

function ChatPanel({
  view,
  disabled,
  onSend,
}: {
  view: RoomView;
  disabled: boolean;
  onSend: (text: string) => Promise<boolean>;
}) {
  const [message, setMessage] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const shouldStickRef = useRef(true);
  const messages = view.chat;

  useEffect(() => {
    if (!shouldStickRef.current) return;
    const list = listRef.current;
    if (!list) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      list.scrollTop = list.scrollHeight;
    } else {
      list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    }
  }, [messages.length]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    if (!text || disabled) return;
    const sent = await onSend(text);
    if (sent) {
      shouldStickRef.current = true;
      setMessage((current) => (current.trim() === text ? "" : current));
    }
  };

  return (
    <div className="chat-panel">
      <p className="chat-house-rule">
        <span className="chat-rule-art" aria-hidden="true" />
        标准玩法只用提示沟通；聊天请勿直接透露牌面
      </p>
      <div
        className="message-list"
        ref={listRef}
        aria-live="polite"
        onScroll={(event) => {
          const element = event.currentTarget;
          shouldStickRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 60;
        }}
      >
        {messages.length === 0 ? (
          <div className="empty-messages">
            <span className="empty-message-art" aria-hidden="true" />
            <strong>说句“准备好了吗？”</strong>
            <p>聊天记录会留在本房间内</p>
          </div>
        ) : (
          messages.map((chat) => {
            const isSelf = chat.playerId === view.selfId;
            return (
              <div
                className={`chat-message ${isSelf ? "is-self" : ""}`}
                key={chat.id}
              >
                <span>
                  {chat.playerName}
                  <small>{formatTime(chat.createdAt)}</small>
                </span>
                <p>{chat.text}</p>
              </div>
            );
          })
        )}
      </div>
      <form className="chat-form" onSubmit={submit}>
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={240}
          placeholder="给搭档发句话…"
          aria-label="聊天消息"
        />
        <button type="submit" disabled={!message.trim() || disabled}>
          <span>发送</span>
        </button>
      </form>
    </div>
  );
}

function Timeline({ view }: { view: RoomView }) {
  const entries = useMemo(() => [...view.timeline].reverse(), [view.timeline]);
  return (
    <div className="timeline-list">
      {entries.map((entry) => (
        <div className={`timeline-entry event-${entry.kind}`} key={entry.id}>
          <i aria-hidden="true" />
          <div>
            <p>{entry.text}</p>
            <small>{formatTime(entry.createdAt)}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

function ResultOverlay({
  view,
  pending,
  onRestart,
  onLeave,
}: {
  view: RoomView;
  pending: string | null;
  onRestart: () => void;
  onLeave: () => void;
}) {
  const result = view.result!;
  const isHost = view.selfId === view.hostId;
  const everyoneOnline = view.players.every((player) => player.connected);
  const host = view.players.find((player) => player.id === view.hostId);
  const dialogRef = useDialogFocus<HTMLElement>(true);
  const isPerfect = result.reason === "perfect";

  return (
    <div
      className={`result-backdrop ${isPerfect ? "result-backdrop--perfect" : ""}`}
      role="presentation"
    >
      <section
        className={`result-card ${isPerfect ? "result-card--perfect" : ""}`}
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="result-title"
        aria-describedby="result-description"
      >
        {isPerfect ? (
          <div className="perfect-result-crown" aria-hidden="true">
            {COLORS.map((color) => <i data-color={color} key={color} />)}
            <strong>25</strong>
          </div>
        ) : (
          <div className="result-burst" aria-hidden="true">
            <i />
            <span>✦</span>
          </div>
        )}
        <p className="eyebrow centered">
          <span /> {isPerfect ? "完美共演 · 五色终章" : `第 ${view.round} 场演出`}
        </p>
        <h2 id="result-title">{isPerfect ? "五色同天" : result.title}</h2>
        <p id="result-description">
          {isPerfect
            ? "你们让二十五束花火依次升空，把整片夜色写成了共同的记忆。"
            : result.description}
        </p>
        <div className="result-score">
          <strong>{result.score}</strong>
          <span>
            <b>/ 25</b>
            本局得分
          </span>
        </div>
        <div className="result-stacks">
          {COLORS.map((color) => (
            <span className={`result-stack result-${color}`} key={color}>
              <i>{view.fireworks[color]}</i>
              {COLOR_LABELS[color]}
            </span>
          ))}
        </div>
        {isHost ? (
          <button
            className="primary-button"
            type="button"
            onClick={onRestart}
            disabled={pending !== null || !everyoneOnline}
            title={everyoneOnline ? "重新洗牌并开始下一场" : "两位玩家在线后才能再来一场"}
          >
            <span>{pending === "restart" ? "正在重新洗牌…" : "再来一场"}</span>
            <b aria-hidden="true">↻</b>
          </button>
        ) : (
          <div className="host-waiting">
            <i />
            {host?.connected ? "等待房主开启下一场" : "房主暂时离线，等待重新连线"}
          </div>
        )}
        {isHost && !everyoneOnline && (
          <p className="result-wait-note">搭档重新连线后即可再来一场</p>
        )}
        <button
          className="result-leave"
          type="button"
          onClick={onLeave}
          disabled={pending !== null}
        >
          离开房间
        </button>
      </section>
    </div>
  );
}

function RulesDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLElement>(open, onClose);

  if (!open) return null;
  return (
    <div className="rules-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="rules-dialog"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">
              <span /> 两分钟读懂
            </p>
            <h2 id="rules-title">如何点亮花火</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭规则"
            autoFocus
          >
            ×
          </button>
        </header>
        <div className="rules-body">
          <div className="rule-intro">
            <strong>你看得见搭档的牌，却看不见自己的。</strong>
            <p>
              两人合作把赤、金、翠、青、白五色牌，分别按 1 → 5
              的顺序打出。最终得分是五束花火的最高数字之和。
            </p>
          </div>
          <div className="rule-grid">
            <article>
              <span>01</span>
              <div>
                <h3>给提示</h3>
                <p>
                  消耗 1 枚提示标记，告诉搭档一种颜色或一个数字。系统会同时指出全部命中的牌。
                </p>
              </div>
            </article>
            <article>
              <span>02</span>
              <div>
                <h3>打出一张牌</h3>
                <p>
                  牌能接在同色花火后就成功；接不上会进入弃牌堆并记 1
                  次失误。成功打出 5 可补回 1 枚提示。
                </p>
              </div>
            </article>
            <article>
              <span>03</span>
              <div>
                <h3>弃掉一张牌</h3>
                <p>
                  公开弃掉自己的一张牌，补回 1 枚提示标记。提示已经满 8
                  枚时不能弃牌。
                </p>
              </div>
            </article>
            <article>
              <span>04</span>
              <div>
                <h3>游戏结束</h3>
                <p>
                  三次失误会立即结束对局，并以当时已点亮的花火层数结算；五色全到 5 获得 25
                  分。抽走最后一张后，两人各再行动一次。
                </p>
              </div>
            </article>
          </div>
          <aside className="edition-note">
            <span>本作口径</span>
            <p>
              采用五色基础版与新版“零命中提示”：可以告诉搭档“你没有红牌”。自由聊天属于房规功能；严格玩法请勿用聊天额外报牌或指挥。
            </p>
          </aside>
        </div>
        <footer>
          <span>每色牌数：1×3 · 2×2 · 3×2 · 4×2 · 5×1</span>
          <button className="primary-button" type="button" onClick={onClose}>
            <span>明白了</span>
            <b aria-hidden="true">✦</b>
          </button>
        </footer>
      </section>
    </div>
  );
}

function Toast({ message }: { message: string | null }) {
  return (
    <div className={`toast ${message ? "is-visible" : ""}`} role="status">
      <span>✦</span>
      {message}
    </div>
  );
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}
