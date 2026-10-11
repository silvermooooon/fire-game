"use client";

import type { CSSProperties } from "react";
import {
  COLOR_LABELS,
  type HanabiColor,
  type PresentationEvent,
} from "@/lib/protocol";

export type MotionRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ClueTokenMotion = {
  eventId: string;
  origin: MotionRect;
  targets: Array<{ cardId: string; rect: MotionRect }>;
};

const CLUE_ACCENTS: Record<HanabiColor, string> = {
  red: "#ff765d",
  yellow: "#ffd36c",
  green: "#78d79b",
  blue: "#7fbcff",
  white: "#fff5df",
};

export function ClueTokenTransfer({
  event,
  motion,
}: {
  event: Extract<PresentationEvent, { kind: "clue" }>;
  motion: ClueTokenMotion | null;
}) {
  if (!motion || motion.eventId !== event.id || motion.targets.length === 0) {
    return <div className="clue-token-effect" aria-hidden="true" />;
  }

  const originCenter = {
    x: motion.origin.left + motion.origin.width / 2,
    y: motion.origin.top + motion.origin.height / 2,
  };
  const targetCenter = motion.targets.reduce(
    (center, target) => ({
      x: center.x + target.rect.left + target.rect.width / 2,
      y: center.y + target.rect.top + target.rect.height / 2,
    }),
    { x: 0, y: 0 },
  );
  targetCenter.x /= motion.targets.length;
  targetCenter.y /= motion.targets.length;

  const clueColor =
    event.clueType === "color"
      ? (event.clueValue as HanabiColor)
      : null;
  const accent = clueColor ? CLUE_ACCENTS[clueColor] : "#f1be67";
  const glyph =
    event.clueType === "color"
      ? COLOR_LABELS[event.clueValue as HanabiColor]
      : String(event.clueValue);
  const flightStyle = {
    left: `${originCenter.x}px`,
    top: `${originCenter.y}px`,
    "--clue-flight-x": `${targetCenter.x - originCenter.x}px`,
    "--clue-flight-y": `${targetCenter.y - originCenter.y}px`,
    "--clue-arc-x": `${(targetCenter.x - originCenter.x) * 0.38}px`,
    "--clue-arc-y": `${(targetCenter.y - originCenter.y) * 0.38 - 34}px`,
    "--clue-accent": accent,
  } as CSSProperties;

  return (
    <div
      className={`clue-token-transfer clue-type-${event.clueType} ${
        clueColor ? `clue-color-${clueColor}` : ""
      }`}
      style={{ "--clue-accent": accent } as CSSProperties}
      aria-hidden="true"
    >
      <span className="clue-token-flight" style={flightStyle}>
        <i />
        <b>{glyph}</b>
      </span>
      <span
        className="clue-token-conversion"
        style={{ left: `${targetCenter.x}px`, top: `${targetCenter.y}px` }}
      >
        <i />
        <i />
        <i />
      </span>
      {motion.targets.map((target, index) => {
        const stampStyle = {
          left: `${target.rect.left + target.rect.width - 25}px`,
          top: `${target.rect.top + target.rect.height * 0.69}px`,
          "--stamp-delay": `${760 + index * 85}ms`,
          "--clue-accent": accent,
        } as CSSProperties;
        return (
          <span
            className="clue-card-stamp"
            key={target.cardId}
            style={stampStyle}
          >
            <i />
            <b>{glyph}</b>
          </span>
        );
      })}
    </div>
  );
}
