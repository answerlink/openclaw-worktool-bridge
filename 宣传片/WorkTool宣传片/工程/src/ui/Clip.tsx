import React from "react";
import { Sequence, staticFile, useVideoConfig } from "remotion";
import { Video } from "@remotion/media";

/**
 * Plays a public/ video from `srcStart` (seconds into the source) starting at absolute time `at`, muted.
 * Re-encode sources first so seeking is exact and cheap:
 *   ffmpeg -i in.mp4 -an -vf scale=1920:1080,fps=60 -c:v libx264 -crf 17 -g 30 -pix_fmt yuv420p -movflags +faststart public/video/x.mp4
 * Several Clips can share one container: only the one whose window contains `t` renders.
 */
export const Clip: React.FC<{
  src: string;
  at: number;
  dur: number;
  srcStart?: number;
  rate?: number;
  fit?: "cover" | "contain";
  style?: React.CSSProperties;
}> = ({ src, at, dur, srcStart = 0, rate = 1, fit = "cover", style }) => {
  const { fps } = useVideoConfig();
  return (
    <Sequence from={Math.round(at * fps)} durationInFrames={Math.max(1, Math.round(dur * fps))} layout="none">
      <Video
        src={staticFile(src)}
        trimBefore={Math.round(srcStart * fps)}
        playbackRate={rate}
        muted
        objectFit={fit}
        style={{ width: "100%", height: "100%", display: "block", ...style }}
      />
    </Sequence>
  );
};
