"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import type { CardView } from "@/lib/protocol";
import { ProgressiveOwnCard } from "@/components/progressive-own-card";

export type CardDropKind = "discard" | "play";

type DragPhase = "dragging" | "committing";

type DragVisual = {
  left: number;
  top: number;
  width: number;
  height: number;
  target: CardDropKind | null;
  phase: DragPhase;
};

type Gesture = {
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  dragging: boolean;
};

const DRAG_THRESHOLD = 10;

function artwork(card: CardView) {
  return card.knownColor
    ? `url("/art/card-face-${card.knownColor}-v2.webp")`
    : `url("/art/hanabi-card-back.webp")`;
}

export function findCardDropTarget(
  clientX: number,
  clientY: number,
): CardDropKind | null {
  const targets = document.querySelectorAll<HTMLElement>(
    "[data-card-drop-target]",
  );
  for (const target of targets) {
    if (target.getAttribute("aria-disabled") === "true") continue;
    const bounds = target.getBoundingClientRect();
    if (
      clientX >= bounds.left &&
      clientX <= bounds.right &&
      clientY >= bounds.top &&
      clientY <= bounds.bottom
    ) {
      const kind = target.dataset.cardDropTarget;
      if (kind === "discard" || kind === "play") return kind;
    }
  }
  return null;
}

export function DragActionCard({
  card,
  index,
  total,
  selected,
  cluePulse,
  disabled,
  discardAllowed,
  menuOpen,
  onSelect,
  onAction,
}: {
  card: CardView;
  index: number;
  total: number;
  selected: boolean;
  cluePulse: boolean;
  disabled: boolean;
  discardAllowed: boolean;
  menuOpen: boolean;
  onSelect: () => void;
  onAction: (kind: CardDropKind, cardId: string) => Promise<void>;
}) {
  const [drag, setDrag] = useState<DragVisual | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const targetRef = useRef<CardDropKind | null>(null);
  const suppressClickRef = useRef(false);
  const commitTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (commitTimerRef.current !== null) {
        window.clearTimeout(commitTimerRef.current);
      }
    },
    [],
  );

  const resetDrag = () => {
    gestureRef.current = null;
    targetRef.current = null;
    setDrag(null);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
      width: bounds.width,
      height: bounds.height,
      dragging: false,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is an enhancement; document-level touch cancellation still
      // leaves the gesture in a safe, non-committed state.
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const distance = Math.hypot(
      event.clientX - gesture.startX,
      event.clientY - gesture.startY,
    );
    if (!gesture.dragging && distance < DRAG_THRESHOLD) return;

    event.preventDefault();
    gesture.dragging = true;
    suppressClickRef.current = true;
    const target = findCardDropTarget(event.clientX, event.clientY);
    targetRef.current = target;
    setDrag({
      left: event.clientX - gesture.offsetX,
      top: event.clientY - gesture.offsetY,
      width: gesture.width,
      height: gesture.height,
      target,
      phase: "dragging",
    });
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const wasDragging = gesture.dragging;
    const target = wasDragging
      ? findCardDropTarget(event.clientX, event.clientY) ?? targetRef.current
      : null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    gestureRef.current = null;

    if (!wasDragging || !target) {
      if (wasDragging) suppressClickRef.current = true;
      targetRef.current = null;
      setDrag(null);
      return;
    }

    suppressClickRef.current = true;
    targetRef.current = target;
    setDrag((current) =>
      current ? { ...current, target, phase: "committing" } : current,
    );
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
      setDrag(null);
      targetRef.current = null;
      void onAction(target, card.id);
    }, target === "play" ? 360 : 300);
  };

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (gestureRef.current?.pointerId !== event.pointerId) return;
    if (gestureRef.current.dragging) suppressClickRef.current = true;
    resetDrag();
  };

  const handleSelect = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onSelect();
  };

  const ghostStyle = drag
    ? ({
        left: `${drag.left}px`,
        top: `${drag.top}px`,
        width: `${drag.width}px`,
        height: `${drag.height}px`,
        "--drag-card-art": artwork(card),
      } as CSSProperties)
    : undefined;

  return (
    <div
      className={`card-motion-shell drag-action-card-shell ${drag ? "is-dragging" : ""}`}
      data-card-id={card.id}
      data-card-dragging={drag ? "true" : "false"}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={(event) => {
        if (gestureRef.current?.pointerId === event.pointerId) resetDrag();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <ProgressiveOwnCard
        card={card}
        index={index}
        total={total}
        selected={selected}
        cluePulse={cluePulse}
        disabled={disabled}
        menuOpen={menuOpen}
        onSelect={handleSelect}
      />
      {drag && typeof document !== "undefined"
        ? createPortal(
            <div
              className={`card-drag-overlay phase-${drag.phase} ${
                drag.target ? `target-${drag.target}` : "target-none"
              }`}
              aria-hidden="true"
            >
              <div
                className={`card-drop-target discard-drop-target ${
                  drag.target === "discard" ? "is-active" : ""
                } ${discardAllowed ? "" : "is-disabled"}`}
                data-card-drop-target="discard"
                aria-disabled={!discardAllowed}
              >
                <span className="drop-target-art drop-token-art" />
                <span>
                  <small>{discardAllowed ? "拖到这里松手" : "提示筹码已满"}</small>
                  <strong>弃牌换筹码</strong>
                </span>
              </div>
              <div
                className={`card-drop-target play-drop-target ${
                  drag.target === "play" ? "is-active" : ""
                }`}
                data-card-drop-target="play"
              >
                <span className="drop-target-art drop-fire-art" />
                <span>
                  <small>拖到这里松手</small>
                  <strong>点燃这张牌</strong>
                </span>
              </div>
              <div className="drag-release-hint">
                {drag.target === "play"
                  ? "松手点燃"
                  : drag.target === "discard"
                    ? "松手弃牌"
                    : "拖回手牌或在空白处松手即可取消"}
              </div>
              <div className="drag-card-ghost" style={ghostStyle}>
                {card.knownRank && <b>{card.knownRank}</b>}
                <i className="drag-card-burn" />
                <i className="drag-card-token" />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
