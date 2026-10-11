"use client";

import type { CSSProperties } from "react";
import {
  COLOR_LABELS,
  type CardView,
  type HanabiColor,
} from "../lib/protocol";
import styles from "./progressive-own-card.module.css";

const COLOR_NAMES: Record<HanabiColor, string> = {
  red: "赤色",
  yellow: "金色",
  green: "翠色",
  blue: "青色",
  white: "白色",
};

const COLOR_CLASSES: Record<HanabiColor, string> = {
  red: styles.colorRed,
  yellow: styles.colorYellow,
  green: styles.colorGreen,
  blue: styles.colorBlue,
  white: styles.colorWhite,
};

export type OwnCardKnowledgeState =
  | "unknown"
  | "color-only"
  | "rank-only"
  | "complete";

export interface ProgressiveOwnCardProps {
  card: CardView;
  index: number;
  total: number;
  selected?: boolean;
  cluePulse?: boolean;
  disabled?: boolean;
  menuOpen?: boolean;
  onSelect: () => void;
  className?: string;
  style?: CSSProperties;
}

export function getOwnCardKnowledgeState(
  card: Pick<CardView, "knownColor" | "knownRank">,
): OwnCardKnowledgeState {
  if (card.knownColor && card.knownRank) return "complete";
  if (card.knownColor) return "color-only";
  if (card.knownRank) return "rank-only";
  return "unknown";
}

function cardPosition(index: number, total: number): string {
  if (total <= 1) return "手中唯一一张";
  if (index === 0) return "最早的一张";
  if (index === total - 1) return "最新的一张";
  return `从左起第 ${index + 1} 张`;
}

function accessibleCardDescription(
  card: CardView,
  index: number,
  total: number,
  selected: boolean,
): string {
  const colorDescription = card.knownColor
    ? `已知为${COLOR_NAMES[card.knownColor]}`
    : "颜色未知";
  const rankDescription = card.knownRank
    ? `已知数字 ${card.knownRank}`
    : "数字未知";
  const exclusions = [
    card.excludedColors.length > 0
      ? `已排除${card.excludedColors
          .map((color) => COLOR_NAMES[color])
          .join("、")}`
      : "",
    card.excludedRanks.length > 0
      ? `已排除数字 ${card.excludedRanks.join("、")}`
      : "",
  ].filter(Boolean);

  return [
    `选择自己的第 ${index + 1} 张牌`,
    cardPosition(index, total),
    colorDescription,
    rankDescription,
    ...exclusions,
    card.isNewest ? "这是本回合最新摸到的牌" : "",
    selected ? "当前已选择" : "",
  ]
    .filter(Boolean)
    .join("，");
}

export function ProgressiveOwnCard({
  card,
  index,
  total,
  selected = false,
  cluePulse = false,
  disabled = false,
  menuOpen = false,
  onSelect,
  className,
  style,
}: ProgressiveOwnCardProps) {
  const knowledgeState = getOwnCardKnowledgeState(card);
  const hasKnownColor = card.knownColor !== null;
  const hasKnownRank = card.knownRank !== null;
  const stateClass =
    knowledgeState === "unknown"
      ? styles.stateUnknown
      : knowledgeState === "color-only"
        ? styles.stateColorOnly
        : knowledgeState === "rank-only"
          ? styles.stateRankOnly
          : styles.stateComplete;
  const classes = [
    styles.card,
    stateClass,
    hasKnownColor ? COLOR_CLASSES[card.knownColor!] : styles.colorUnknown,
    selected ? styles.selected : "",
    cluePulse ? styles.cluePulse : "",
    menuOpen ? styles.menuOpen : "",
    disabled ? styles.unavailable : "",
    card.isNewest ? styles.newest : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const resolvedStyle = {
    ...style,
    "--revealed-card-art": hasKnownColor
      ? `url("/art/card-face-${card.knownColor}-v2.webp")`
      : `url("/art/hanabi-card-back.webp")`,
  } as CSSProperties;

  return (
    <button
      type="button"
      className={classes}
      style={resolvedStyle}
      onClick={onSelect}
      aria-pressed={selected}
      aria-haspopup="dialog"
      aria-expanded={menuOpen}
      aria-disabled={disabled}
      aria-label={accessibleCardDescription(card, index, total, selected)}
      data-own-card-id={card.id}
      data-knowledge={knowledgeState}
    >
      {knowledgeState === "unknown" ? (
        <span className={styles.cardBack} aria-hidden="true" />
      ) : (
        <span className={styles.cardFace} aria-hidden="true">
          {hasKnownRank && (
            <span className={styles.cornerRank}>{card.knownRank}</span>
          )}
        </span>
      )}
      {(hasKnownColor || hasKnownRank) && (
        <span className={styles.knowledgeSeals} aria-hidden="true">
          {hasKnownColor && (
            <span
              className={`${styles.knowledgeSeal} ${styles.colorSeal}`}
              data-seal-color={card.knownColor}
            >
              <i />
              <b>{COLOR_LABELS[card.knownColor!]}</b>
            </span>
          )}
          {hasKnownRank && (
            <span className={`${styles.knowledgeSeal} ${styles.rankSeal}`}>
              <i />
              <b>数</b>
            </span>
          )}
        </span>
      )}
      <span className={styles.selectionHalo} aria-hidden="true" />
    </button>
  );
}
