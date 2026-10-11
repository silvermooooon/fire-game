"use client";

import { useState } from "react";
import {
  FireworkParticleEffect,
  PerfectFinale,
} from "@/components/particle-effects";
import {
  COLORS,
  type HanabiColor,
  type HanabiRank,
  type PlayedFirework,
} from "@/lib/protocol";

const sequence: PlayedFirework[] = ([1, 2, 3, 4, 5] as HanabiRank[]).flatMap(
  (rank) =>
    COLORS.map((color, index) => ({
      id: `qa-${color}-${rank}`,
      actorId: index % 2 === 0 ? "one" : "two",
      color,
      rank,
      createdAt: rank * 100 + index,
    })),
);

export default function FireworksQaPage() {
  const [effect, setEffect] = useState<{ color: HanabiColor; rank: HanabiRank; key: number }>({
    color: "red",
    rank: 5,
    key: 0,
  });
  const [finale, setFinale] = useState(false);
  const [complete, setComplete] = useState(false);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at 50% 20%, #172343, #07060d 58%, #020205)",
        color: "white",
        padding: 24,
      }}
    >
      {!finale && !complete && <>
      <h1>花火动效验收</h1>
      <div style={{ position: "relative", zIndex: 20, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {([1, 2, 3, 4, 5] as HanabiRank[]).map((rank) => (
          <button
            type="button"
            key={rank}
            onClick={() => {
              setFinale(false);
              setComplete(false);
              setEffect((current) => ({ ...current, rank, key: current.key + 1 }));
            }}
          >
            赤色 {rank}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setComplete(false);
            setFinale(true);
          }}
        >
          播放满分终幕
        </button>
      </div>
      <section style={{ marginTop: 40, textAlign: "center", opacity: .72 }}>
        <p>下方牌桌用于检查朦胧夜色、粒子层级和文字可读性。</p>
        <div style={{ margin: "20vh auto 0", width: "min(900px, 90vw)", height: 260, border: "1px solid #8b6d42", background: "rgba(68,35,30,.38)" }} />
      </section>
      </>}
      {!finale && <FireworkParticleEffect key={effect.key} color={effect.color} rank={effect.rank} />}
      {finale && !complete && (
        <PerfectFinale sequence={sequence} onComplete={() => setComplete(true)} />
      )}
      {complete && (
        <div className="result-backdrop result-backdrop--perfect">
          <section className="result-card result-card--perfect">
            <div className="perfect-result-crown" aria-hidden="true">
              {COLORS.map((color) => <i data-color={color} key={color} />)}
              <strong>25</strong>
            </div>
            <p className="eyebrow centered"><span /> 完美共演 · 五色终章</p>
            <h2>五色同天</h2>
            <p>你们让二十五束花火依次升空，把整片夜色写成了共同的记忆。</p>
            <div className="result-score"><strong>25</strong><span><b>/ 25</b>本局得分</span></div>
          </section>
        </div>
      )}
    </main>
  );
}
