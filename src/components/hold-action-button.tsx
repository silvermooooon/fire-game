"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { CardView } from "@/lib/protocol";

export type HoldActionKind = "play" | "discard";

const HOLD_DURATION: Record<HoldActionKind, number> = {
  play: 1_080,
  discard: 920,
};

function cardArtwork(card: CardView): string {
  return card.knownColor
    ? `url("/art/card-face-${card.knownColor}-v2.webp")`
    : `url("/art/hanabi-card-back.webp")`;
}

export function HoldActionButton({
  kind,
  card,
  disabled,
  busy,
  unavailableReason,
  onActivate,
}: {
  kind: HoldActionKind;
  card: CardView;
  disabled: boolean;
  busy: boolean;
  unavailableReason?: string;
  onActivate: () => Promise<void>;
}) {
  const [holding, setHolding] = useState(false);
  const [completed, setCompleted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<number | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const committedRef = useRef(false);
  const duration = HOLD_DURATION[kind];

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cancelHold = useCallback(() => {
    if (committedRef.current) return;
    clearTimer();
    activePointerRef.current = null;
    setHolding(false);
    setCompleted(false);
  }, [clearTimer]);

  const beginHold = useCallback(() => {
    if (disabled || busy || holding || committedRef.current) return;
    clearTimer();
    setHolding(true);
    setCompleted(false);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      committedRef.current = true;
      setCompleted(true);
      void onActivate();
    }, duration);
  }, [busy, clearTimer, disabled, duration, holding, onActivate]);

  useEffect(() => clearTimer, [clearTimer]);

  useEffect(() => {
    if (!busy && committedRef.current) {
      committedRef.current = false;
      setHolding(false);
      setCompleted(false);
    }
  }, [busy]);

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (disabled || busy) return;
    event.preventDefault();
    activePointerRef.current = event.pointerId;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can be unavailable in older embedded browsers; the
      // hold timer and release handlers still provide the safe interaction.
    }
    beginHold();
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!holding || activePointerRef.current !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const outside =
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom;
    if (outside) cancelHold();
  };

  const handlePointerEnd = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!committedRef.current) cancelHold();
    activePointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      beginHold();
    }
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (!committedRef.current) cancelHold();
    }
  };

  const copy =
    kind === "play"
      ? {
          idle: "按住点燃这张牌",
          holding: "牌面燃烧中 · 松手取消",
          complete: "牌面燃尽 · 正在判断",
          detail: "燃烧完成后尝试接续对应颜色的花火",
        }
      : {
          idle: "按住弃置这张牌",
          holding: "压制成筹码 · 松手取消",
          complete: "已化为筹码 · 正在回收",
          detail: "压制完成后公开牌面并收回 1 枚提示",
        };
  const label = completed ? copy.complete : holding ? copy.holding : copy.idle;
  const detail = disabled && unavailableReason ? unavailableReason : copy.detail;
  const descriptionId = `hold-${kind}-${card.id}`;
  const style = {
    "--hold-duration": `${duration}ms`,
    "--hold-card-art": cardArtwork(card),
  } as CSSProperties;

  return (
    <button
      ref={buttonRef}
      className={`hold-action-button dialog-${kind}-action ${
        holding ? "is-holding" : ""
      } ${completed ? "is-complete" : ""}`}
      style={style}
      type="button"
      disabled={disabled || busy}
      aria-label={
        disabled && unavailableReason
          ? `${copy.idle}；${unavailableReason}`
          : `${copy.idle}；长按完成前松手可以取消`
      }
      aria-describedby={descriptionId}
      aria-pressed={holding}
      data-hold-action={kind}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={cancelHold}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onBlur={cancelHold}
      onClick={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className="hold-card-preview" aria-hidden="true">
        {card.knownRank && <b>{card.knownRank}</b>}
        <i className="hold-burn-layer" />
        <i className="hold-token-morph" />
      </span>
      <span className="hold-action-copy">
        <strong>{label}</strong>
        <small id={descriptionId}>{detail}</small>
      </span>
      <span className="hold-action-meter" aria-hidden="true" />
    </button>
  );
}
