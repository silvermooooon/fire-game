"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import type { Fireworks as FireworksInstance } from "fireworks-js";
import {
  COLORS,
  type HanabiColor,
  type HanabiRank,
  type PlayedFirework,
} from "@/lib/protocol";

const FIREWORK_HUES: Record<HanabiColor, number> = {
  red: 2,
  yellow: 43,
  green: 132,
  blue: 211,
  white: 42,
};

const COLOR_ORIGINS: Record<HanabiColor, number> = {
  red: 18,
  yellow: 34,
  green: 50,
  blue: 66,
  white: 82,
};

const EFFECT_COLORS: Record<HanabiColor, string> = {
  red: "#f15b4d",
  yellow: "#f2bc4e",
  green: "#61c982",
  blue: "#68a8ef",
  white: "#fff0d6",
};

function hueRange(hue: number, spread = 5) {
  return {
    min: Math.max(0, hue - spread),
    max: Math.min(360, hue + spread),
  };
}

function randomFanBoundaries(width: number, height: number) {
  return {
    x: width * 0.04,
    y: height * 0.08,
    width,
    height: height * 0.96,
  };
}

function baseOptions(
  width: number,
  height: number,
  rank: HanabiRank,
  autoresize = false,
) {
  const finalRank = rank === 5;

  return {
    autoresize,
    opacity: finalRank ? 0.58 : 0.42,
    acceleration: 1.024,
    friction: 0.968,
    gravity: finalRank ? 1.08 : 1.2,
    particles: finalRank ? 92 : 34 + rank * 13,
    explosion: finalRank ? 7.4 : 4 + rank * 0.78,
    intensity: finalRank ? 36 : 15 + rank * 5,
    flickering: 64,
    traceLength: finalRank ? 4.6 : 3.4,
    traceSpeed: finalRank ? 5.2 : 4.7,
    hue: { min: 38, max: 48 },
    brightness: { min: 62, max: 94 },
    decay: finalRank
      ? { min: 0.008, max: 0.016 }
      : { min: 0.011, max: 0.021 },
    delay: { min: 999_999, max: 999_999 },
    rocketsPoint: { min: 48, max: 52 },
    boundaries: randomFanBoundaries(width, height),
    lineWidth: {
      trace: { min: 1.1, max: finalRank ? 2.7 : 2.2 },
      explosion: { min: 1.3, max: finalRank ? 3.6 : 2.9 },
    },
    lineStyle: "round" as const,
    mouse: { click: false, move: false, max: 0 },
    sound: { enabled: false },
  };
}

function elementSize(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return {
    width: Math.max(rect.width, window.innerWidth, 1),
    height: Math.max(rect.height, window.innerHeight, 1),
  };
}

type RuntimeTrace = {
  dx: number;
  dy: number;
  hue: number;
  draw: () => void;
  update: (onArrival: (x: number, y: number, hue: number) => void) => void;
};

type FireworksInternals = {
  ctx: CanvasRenderingContext2D | null;
  traces: RuntimeTrace[];
  createTrace: () => void;
  drawTrace: () => void;
  initExplosion: (x: number, y: number, hue: number) => void;
};

type FlightPlan = {
  launchedAt: number;
  explodeAt: number;
  arrived: boolean;
};

type QueuedTrace = {
  trace: RuntimeTrace;
  launchAt: number;
};

/**
 * fireworks-js normally keeps a rocket visible until it reaches its target and
 * explodes immediately. Preserve its trace drawing, while giving every rocket
 * a fixed flight clock: the trail fades in the first half, the rocket continues
 * invisibly, then the library explosion is created at the preselected target.
 */
function enableInvisibleFlight(
  fireworks: FireworksInstance,
  timing: {
    flightDuration: number;
    fadeStart: number;
    fadeEnd: number;
    staggerMin: number;
    staggerMax: number;
  },
) {
  const internals = fireworks as unknown as FireworksInternals;
  const plans = new WeakMap<RuntimeTrace, FlightPlan>();
  const queued: QueuedTrace[] = [];
  let active = true;

  internals.drawTrace = () => {
    const now = performance.now();
    const ctx = internals.ctx;

    for (let index = queued.length - 1; index >= 0; index -= 1) {
      const queuedTrace = queued[index];
      if (now >= queuedTrace.launchAt) {
        queued.splice(index, 1);
        internals.traces.push(queuedTrace.trace);
        plans.set(queuedTrace.trace, {
          launchedAt: now,
          explodeAt: now + timing.flightDuration,
          arrived: false,
        });
      }
    }

    for (let index = internals.traces.length - 1; index >= 0; index -= 1) {
      const trace = internals.traces[index];
      const plan = plans.get(trace) ?? {
        launchedAt: now,
        explodeAt: now + timing.flightDuration,
        arrived: false,
      };
      plans.set(trace, plan);

      if (now >= plan.explodeAt) {
        internals.traces.splice(index, 1);
        internals.initExplosion(trace.dx, trace.dy, trace.hue);
        continue;
      }

      const progress = (now - plan.launchedAt) / timing.flightDuration;
      if (!plan.arrived && ctx && progress < timing.fadeEnd) {
        const fadeProgress = progress <= timing.fadeStart
          ? 0
          : (progress - timing.fadeStart) / (timing.fadeEnd - timing.fadeStart);
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - fadeProgress);
        trace.draw();
        ctx.restore();
      }

      if (!plan.arrived) {
        trace.update(() => {
          plan.arrived = true;
        });
      }
    }
  };

  return {
    launch(count: number) {
      if (!active) return;
      let launchAt = performance.now();
      for (let index = 0; index < count; index += 1) {
        internals.createTrace();
        const trace = internals.traces.pop();
        if (trace) queued.push({ trace, launchAt });
        launchAt += timing.staggerMin
          + Math.random() * (timing.staggerMax - timing.staggerMin);
      }
    },
    dispose() {
      active = false;
      queued.length = 0;
    },
  };
}

export function FireworkParticleEffect({
  color,
  rank,
}: {
  color: HanabiColor;
  rank: HanabiRank;
}) {
  const fieldRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;

    let cancelled = false;
    const timers: number[] = [];
    let dispose: (() => void) | undefined;

    void import("fireworks-js").then(({ Fireworks }) => {
      if (cancelled) return;

      const { width, height } = elementSize(field);
      const hue = FIREWORK_HUES[color];
      const fireworks = new Fireworks(field, {
        ...baseOptions(width, height, rank),
        hue: hueRange(hue, color === "white" ? 3 : 5),
        brightness: color === "white"
          ? { min: 76, max: 100 }
          : { min: 62, max: 94 },
      });

      const delayedFireworks = enableInvisibleFlight(fireworks, {
        flightDuration: 1_850,
        fadeStart: 0.22,
        fadeEnd: 0.48,
        staggerMin: 80,
        staggerMax: 120,
      });
      fireworks.start();
      dispose = () => {
        delayedFireworks.dispose();
        fireworks.stop(true);
      };

      const launch = (delay: number, count: number) => {
        timers.push(window.setTimeout(() => delayedFireworks.launch(count), delay));
      };

      launch(470, rank === 5 ? 8 : rank);
      if (rank === 5) {
        launch(1_020, 7);
        launch(1_580, 6);
        launch(2_180, 5);
      }
    });

    return () => {
      cancelled = true;
      timers.forEach(window.clearTimeout);
      dispose?.();
    };
  }, [color, rank]);

  return (
    <div
      className={`particle-fireworks particle-fireworks--rank-${rank}`}
      ref={fieldRef}
      style={{ "--effect-color": EFFECT_COLORS[color] } as CSSProperties}
      aria-hidden="true"
    />
  );
}

function finaleStepInterval(index: number, total: number) {
  if (total <= 1) return 690;
  const progress = index / (total - 1);
  return Math.round(690 - progress * 455);
}

export function PerfectFinale({
  sequence,
  onComplete,
}: {
  sequence: PlayedFirework[];
  onComplete: () => void;
}) {
  const fieldRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const timer = window.setTimeout(onComplete, 1_500);
      return () => window.clearTimeout(timer);
    }

    let cancelled = false;
    const timers: number[] = [];
    let dispose: (() => void) | undefined;

    void import("fireworks-js").then(({ Fireworks }) => {
      if (cancelled) return;

      const initialSize = elementSize(field);
      const fireworks = new Fireworks(field, {
        ...baseOptions(initialSize.width, initialSize.height, 5, true),
        opacity: 0.54,
        acceleration: 1.024,
        traceLength: 4.2,
        traceSpeed: 5,
      });

      const delayedFireworks = enableInvisibleFlight(fireworks, {
        flightDuration: 1_700,
        fadeStart: 0.2,
        fadeEnd: 0.46,
        staggerMin: 70,
        staggerMax: 105,
      });
      fireworks.start();
      dispose = () => {
        delayedFireworks.dispose();
        fireworks.stop(true);
      };

      const schedule = (delay: number, action: () => void) => {
        timers.push(window.setTimeout(action, delay));
      };
      const currentBoundaries = () => {
        const size = elementSize(field);
        return randomFanBoundaries(size.width, size.height);
      };

      let elapsed = 6_350;
      sequence.forEach((played, index) => {
        const launchAt = elapsed;
        schedule(launchAt, () => {
          const hue = FIREWORK_HUES[played.color];
          const isFinalRank = played.rank === 5;
          fireworks.updateOptions({
            hue: hueRange(hue, played.color === "white" ? 3 : 5),
            brightness: played.color === "white"
              ? { min: 78, max: 100 }
              : { min: 62, max: 96 },
            particles: isFinalRank ? 88 : 32 + played.rank * 12,
            explosion: isFinalRank ? 7.1 : 3.9 + played.rank * 0.74,
            intensity: isFinalRank ? 34 : 14 + played.rank * 5,
            rocketsPoint: { min: 48, max: 52 },
            boundaries: currentBoundaries(),
          });
          delayedFireworks.launch(isFinalRank ? 7 : played.rank);
        });
        elapsed += finaleStepInterval(index, sequence.length);
      });

      const crescendoAt = elapsed + 900;
      [0, 1].forEach((wave) => {
        COLORS.forEach((color, colorIndex) => {
          schedule(crescendoAt + wave * 1_050 + colorIndex * 145, () => {
            const hue = FIREWORK_HUES[color];
            fireworks.updateOptions({
              hue: hueRange(hue, color === "white" ? 3 : 5),
              brightness: color === "white"
                ? { min: 80, max: 100 }
                : { min: 66, max: 100 },
              particles: 96,
              explosion: 7.8,
              intensity: 38,
              rocketsPoint: { min: 48, max: 52 },
              boundaries: currentBoundaries(),
            });
            delayedFireworks.launch(6);
          });
        });
      });

      schedule(crescendoAt + 5_250, onComplete);
    });

    return () => {
      cancelled = true;
      timers.forEach(window.clearTimeout);
      dispose?.();
    };
  }, [onComplete, sequence]);

  return (
    <div
      className="perfect-finale"
      role="status"
      aria-live="polite"
      aria-label="满分花火终幕正在上演"
    >
      <div className="perfect-finale-night" aria-hidden="true" />
      <div className="perfect-finale-particles" ref={fieldRef} aria-hidden="true" />
    </div>
  );
}

const SMOKE_PARTICLES = Array.from({ length: 24 }, (_, index) => {
  const angle = (index / 24) * Math.PI * 2 + (index % 3) * 0.18;
  const distance = 46 + (index % 7) * 12;
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance * 0.66 - 28 - (index % 5) * 13,
    drift: ((index * 17) % 31) - 15,
    size: 22 + (index % 6) * 8,
    delay: (index % 8) * 0.035,
  };
});

const EMBER_PARTICLES = Array.from({ length: 16 }, (_, index) => {
  const angle = (index / 16) * Math.PI * 2;
  return {
    x: Math.cos(angle) * (32 + (index % 5) * 12),
    y: 38 + (index % 6) * 13,
    delay: (index % 7) * 0.025,
  };
});

export function SmokeParticleEffect({ color }: { color: HanabiColor }) {
  return (
    <div
      className="smoke-particle-field"
      style={{
        "--smoke-origin-x": `${COLOR_ORIGINS[color]}%`,
      } as CSSProperties}
      aria-hidden="true"
    >
      <i className="smoke-core" />
      {SMOKE_PARTICLES.map((particle, index) => (
        <i
          className="smoke-particle"
          key={`smoke-${index}`}
          style={{
            "--smoke-x": `${particle.x}px`,
            "--smoke-y": `${particle.y}px`,
            "--smoke-drift": `${particle.drift}px`,
            "--smoke-size": `${particle.size}px`,
            "--smoke-delay": `${particle.delay}s`,
          } as CSSProperties}
        />
      ))}
      {EMBER_PARTICLES.map((particle, index) => (
        <i
          className="smoke-ember"
          key={`ember-${index}`}
          style={{
            "--ember-x": `${particle.x}px`,
            "--ember-y": `${particle.y}px`,
            "--ember-delay": `${particle.delay}s`,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}
