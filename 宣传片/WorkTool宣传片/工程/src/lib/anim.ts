import { Easing, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import timing from "../timing.json";

export const T = timing;
export type SceneName = keyof typeof timing.scenes;

export const scene = (name: SceneName) => {
  const [start, end] = timing.scenes[name];
  return { start, end, dur: end - start };
};

export const EASE = {
  out: Easing.bezier(0.16, 1, 0.3, 1),
  inOut: Easing.bezier(0.87, 0, 0.13, 1),
  soft: Easing.bezier(0.45, 0, 0.2, 1),
  in: Easing.bezier(0.7, 0, 0.84, 0),
  back: Easing.bezier(0.34, 1.56, 0.64, 1),
  linear: Easing.linear,
};

/** Seconds elapsed inside the current <Sequence>. */
export const useTime = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return frame / fps;
};

export const ramp = (
  t: number,
  range: [number, number],
  out: [number, number] = [0, 1],
  easing: (n: number) => number = EASE.out,
) =>
  interpolate(t, range, out, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });

/** Multi-stop interpolation with clamping. */
export const keys = (
  t: number,
  input: number[],
  output: number[],
  easing: (n: number) => number = EASE.soft,
) =>
  interpolate(t, input, output, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });

/** 0→1 in, hold, 1→0 out. */
export const inOut = (t: number, a: number, b: number, c: number, d: number) =>
  Math.min(ramp(t, [a, b]), 1 - ramp(t, [c, d], [0, 1], EASE.in));

/** Exponentially decaying impulse, used for flashes and shake after a hit. */
export const impulse = (t: number, at: number, decay = 6) =>
  t < at ? 0 : Math.exp(-(t - at) * decay);

export const shake = (t: number, hits: number[], amp = 14, decay = 7) => {
  let x = 0;
  let y = 0;
  for (const h of hits) {
    const k = impulse(t, h, decay) * amp;
    if (k < 0.01) continue;
    const s = Math.floor(t * 60);
    x += (random(`sx${h}${s}`) - 0.5) * 2 * k;
    y += (random(`sy${h}${s}`) - 0.5) * 2 * k;
  }
  return { x, y };
};

/** Characters revealed for a typing segment. */
export const typed = (text: string, t: number, start: number, end: number) => {
  const chars = Array.from(text);
  const n = Math.round(ramp(t, [start, end], [0, chars.length], EASE.linear));
  return chars.slice(0, n).join("");
};

export const beatAt = (start: number, i: number, div = 1) => start + (T.beat / div) * i;
