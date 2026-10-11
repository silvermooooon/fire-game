import type { CSSProperties } from "react";
import {
  COLORS,
  COLOR_LABELS,
  type HanabiColor,
  type HanabiRank,
  type RoomView,
} from "@/lib/protocol";
import { orderDiscards } from "@/lib/ordered-discards";
import styles from "./hanabi-tableau.module.css";

const RANKS: HanabiRank[] = [1, 2, 3, 4, 5];

const COLOR_NAMES: Record<HanabiColor, string> = {
  red: "赤色",
  yellow: "金色",
  green: "翠色",
  blue: "青色",
  white: "白色",
};

type TableauStyle = CSSProperties & {
  [key: `--${string}`]: string | number | undefined;
};

export interface HanabiTableauProps {
  view: RoomView;
  className?: string;
  style?: TableauStyle;
}

function joinClasses(...names: Array<string | undefined>) {
  return names.filter(Boolean).join(" ");
}

function cardArtVariable(color: HanabiColor, rank: HanabiRank) {
  return `var(--hanabi-card-${color}-${rank}-art, url("/art/card-face-${color}-v2.webp"))`;
}

function PlayedCard({
  color,
  rank,
  index,
  count,
}: {
  color: HanabiColor;
  rank: HanabiRank;
  index: number;
  count: number;
}) {
  const offset = index - (count - 1) / 2;
  const cardStyle: TableauStyle = {
    "--stack-index": index,
    "--stack-offset": offset,
    "--card-art": cardArtVariable(color, rank),
  };

  return (
    <li
      className={styles.playedCard}
      style={cardStyle}
      data-played-card={`${color}-${rank}`}
      data-card-color={color}
      data-card-rank={rank}
      data-stack-index={index}
      aria-label={`${COLOR_NAMES[color]} ${rank}`}
    >
      <span className={styles.cardCorner} aria-hidden="true">
        <b>{rank}</b>
        <small>{COLOR_LABELS[color]}</small>
      </span>
    </li>
  );
}

function FireworkStack({
  color,
  height,
}: {
  color: HanabiColor;
  height: number;
}) {
  const cards = RANKS.slice(0, height);
  const nextRank = height < 5 ? ((height + 1) as HanabiRank) : null;
  const stackStyle: TableauStyle = {
    "--firework-art": `url("/art/firework-${color}-v2.webp")`,
    "--firework-progress": height / 5,
  };

  return (
    <article
      className={styles.fireworkStack}
      style={stackStyle}
      data-firework-stack={color}
      data-firework-height={height}
      aria-label={`${COLOR_NAMES[color]}花火，当前 ${height} 层`}
    >
      <header className={styles.stackHeading}>
        <span className={styles.colorSeal} data-card-color={color} aria-hidden="true" />
        <strong>{COLOR_NAMES[color]}</strong>
        <small>{height}/5</small>
      </header>

      <div
        className={styles.playedFan}
        data-flight-zone="firework"
        data-flight-color={color}
      >
        <span
          className={styles.fireworkArtwork}
          data-visible={height > 0 ? "true" : "false"}
          aria-hidden="true"
        />
        {cards.length > 0 ? (
          <ol className={styles.playedCardList} aria-label={`${COLOR_NAMES[color]}已打出的牌`}>
            {cards.map((rank, index) => (
              <PlayedCard
                color={color}
                rank={rank}
                index={index}
                count={cards.length}
                key={rank}
              />
            ))}
          </ol>
        ) : (
          <span className={styles.emptyStack} aria-hidden="true">
            <i />
          </span>
        )}
        <span
          className={styles.flightAnchor}
          data-flight-anchor={`firework-${color}`}
          data-next-rank={nextRank ?? "complete"}
          aria-hidden="true"
        />
      </div>

      <footer className={styles.stackFooter}>
        {nextRank ? <span>等待 {nextRank}</span> : <strong>已完成</strong>}
      </footer>
    </article>
  );
}

function DiscardWell({ discards }: { discards: RoomView["discards"] }) {
  const count = discards.length;
  const orderedDiscards = orderDiscards(discards);

  return (
    <section
      className={styles.discardWell}
      data-flight-zone="discard"
      aria-labelledby="hanabi-discard-title"
    >
      <header className={styles.sectionHeading}>
        <div>
          <span>回收漆盘</span>
          <h3 id="hanabi-discard-title">弃牌区</h3>
        </div>
        <strong>{count} 张</strong>
      </header>

      <div className={styles.discardTray}>
        {count > 0 ? (
          <ol
            className={styles.discardCardList}
            aria-label={`全部 ${count} 张弃牌，按赤、金、翠、青、白及数字 1 至 5 排列`}
          >
            {orderedDiscards.map((card, index) => {
              const position = count === 1 ? 0.5 : index / (count - 1);
              const previous = orderedDiscards[index - 1];
              const cardStyle: TableauStyle = {
                left: `${8 + position * 84}%`,
                zIndex: index + 1,
                "--discard-angle": `${-8 + position * 16}deg`,
                "--discard-rise": `${Math.abs(position - 0.5) * 9}px`,
                "--card-art": cardArtVariable(card.color, card.rank),
              };

              return (
                <li
                  className={styles.discardCard}
                  style={cardStyle}
                  data-discard-card={card.discardedAt}
                  data-card-color={card.color}
                  data-card-rank={card.rank}
                  data-color-group-start={!previous || previous.color !== card.color}
                  title={`${COLOR_NAMES[card.color]} ${card.rank}；原第 ${card.discardedAt + 1} 张弃出`}
                  aria-label={`${COLOR_NAMES[card.color]} ${card.rank}，原第 ${card.discardedAt + 1} 张弃出`}
                  key={`${card.discardedAt}-${card.color}-${card.rank}`}
                >
                  <span className={styles.discardCorner} aria-hidden="true">
                    <b>{card.rank}</b>
                    <small>{COLOR_LABELS[card.color]}</small>
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className={styles.emptyDiscard}>尚无弃牌</p>
        )}
        <span
          className={styles.discardAnchor}
          data-flight-anchor="discard"
          aria-hidden="true"
        />
      </div>
    </section>
  );
}

function DeckProp({ count }: { count: number }) {
  return (
    <div
      className={styles.deckProp}
      data-table-prop="deck"
      data-flight-anchor="deck"
      role="img"
      aria-label={`牌堆还剩 ${count} 张`}
    >
      <div className={styles.deckStack} aria-hidden="true">
        <span />
        <span />
        <span />
        <strong>{count}</strong>
      </div>
      <span className={styles.propLabel}>牌堆</span>
    </div>
  );
}

function ClueProps({ current, maximum }: { current: number; maximum: number }) {
  return (
    <div
      className={styles.clueProp}
      data-table-prop="clues"
      data-flight-anchor="clues"
    >
      <header>
        <span>提示筹码</span>
        <strong>{current}/{maximum}</strong>
      </header>
      <ol className={styles.clueTokenRack} aria-label={`${current} 枚可用提示筹码`}>
        {Array.from({ length: maximum }, (_, index) => (
          <li
            className={index < current ? styles.clueTokenAvailable : styles.clueTokenSpent}
            data-clue-token={index}
            data-token-state={index < current ? "available" : "spent"}
            aria-hidden="true"
            key={index}
          >
            <i />
          </li>
        ))}
      </ol>
    </div>
  );
}

function MistakeProps({ current, maximum }: { current: number; maximum: number }) {
  return (
    <div
      className={styles.mistakeProp}
      data-table-prop="mistakes"
      data-flight-anchor="mistakes"
    >
      <header>
        <span>失误引线</span>
        <strong>{current}/{maximum}</strong>
      </header>
      <ol className={styles.fuseRack} aria-label={`${current} 次失误，最多 ${maximum} 次`}>
        {Array.from({ length: maximum }, (_, index) => (
          <li
            className={index < current ? styles.fuseBurned : styles.fuseReady}
            data-mistake-marker={index}
            data-marker-state={index < current ? "burned" : "ready"}
            aria-hidden="true"
            key={index}
          >
            <i />
          </li>
        ))}
      </ol>
    </div>
  );
}

function TableProps({ view }: { view: RoomView }) {
  return (
    <section className={styles.tableProps} data-table-props aria-label="桌面道具">
      <DeckProp count={view.deckCount} />
      <div className={styles.counterProps}>
        <ClueProps current={view.clues} maximum={view.maxClues} />
        <MistakeProps current={view.mistakes} maximum={view.maxMistakes} />
      </div>
    </section>
  );
}

export function HanabiTableau({
  view,
  className,
  style,
}: HanabiTableauProps) {
  const score = COLORS.reduce(
    (total, color) => total + view.fireworks[color],
    0,
  );

  return (
    <section
      className={joinClasses(styles.tableau, className)}
      style={style}
      data-game-tableau
      data-score={score}
      aria-labelledby="hanabi-tableau-title"
    >
      <header className={styles.tableauHeading}>
        <div>
          <span>共同的夜空</span>
          <h2 id="hanabi-tableau-title">五色花火台</h2>
        </div>
        <p>
          <span>总分</span>
          <strong>{score}</strong>
          <small>/25</small>
        </p>
      </header>

      <div className={styles.fireworkField} data-flight-stage="fireworks">
        {COLORS.map((color) => (
          <FireworkStack
            color={color}
            height={view.fireworks[color]}
            key={color}
          />
        ))}
      </div>

      <div className={styles.tabletop}>
        <DiscardWell discards={view.discards} />
        <TableProps view={view} />
      </div>
    </section>
  );
}
