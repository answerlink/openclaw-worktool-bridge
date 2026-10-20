import { Player, type PlayerRef } from "@remotion/player";
import { useCallback, useEffect, useRef, useState } from "react";
import { prefetch, staticFile } from "remotion";
import { ASSETS } from "../src/assets";
import { Promo } from "../src/Promo";
import timing from "../src/timing.json";
import { WEB } from "./config";

const TOTAL = Math.round(timing.duration * timing.fps);
const INPUT = { withAudio: false, webMode: true };

type Stage = "poster" | "playing" | "paused" | "ended";

/**
 * The soundtrack is the clock: a plain <audio> plays straight through and the Player is seeked to
 * whatever frame matches it. When the browser can't render at full rate, frames are dropped instead of
 * the Player pulling the audio back to wait (which replays the last half-second and sounds like an echo).
 */
export const App = () => {
  const player = useRef<PlayerRef>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage>("poster");
  const [loaded, setLoaded] = useState(0);

  useEffect(() => {
    let done = 0;
    const jobs = ASSETS.map((a) => prefetch(staticFile(a), { method: "blob-url" }));
    jobs.forEach((j) =>
      j.waitUntilDone().finally(() => {
        done += 1;
        setLoaded(done / jobs.length);
      }),
    );
  }, []);

  useEffect(() => {
    const a = new Audio(staticFile("audio/mix.wav"));
    a.preload = "auto";
    a.setAttribute("data-worktool-soundtrack", "true");
    a.style.display = "none";
    document.body.appendChild(a);
    audio.current = a;
    const onEnded = () => {
      player.current?.seekTo(TOTAL - 1);
      setStage("ended");
    };
    a.addEventListener("ended", onEnded);
    return () => {
      a.pause();
      a.removeEventListener("ended", onEnded);
      a.remove();
    };
  }, []);

  useEffect(() => {
    if (stage !== "playing") return;
    let raf = 0;
    let last = -1;
    const follow = () => {
      const a = audio.current;
      const p = player.current;
      if (a && p) {
        const frame = Math.min(TOTAL - 1, Math.floor(a.currentTime * timing.fps));
        if (frame !== last) {
          p.seekTo(frame);
          last = frame;
          if (bar.current) bar.current.style.transform = `scaleX(${frame / (TOTAL - 1)})`;
        }
      }
      raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(raf);
  }, [stage]);

  const start = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    player.current?.seekTo(0);
    a.currentTime = 0;
    void a.play();
    setStage("playing");
  }, []);

  const togglePause = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    if (stage === "playing") {
      a.pause();
      setStage("paused");
    } else if (stage === "paused") {
      void a.play();
      setStage("playing");
    }
  }, [stage]);

  const showCta = stage === "poster" || stage === "ended";

  return (
    <main className="page" style={{ ["--ratio" as string]: `${timing.width} / ${timing.height}` }}>
      <header className={`brand ${showCta ? "" : "brand--hidden"}`}>
        <img src={WEB.logo} alt="" />
        <span>{WEB.brand}</span>
      </header>

      <div className="stage">
        <div className="frame" onClick={togglePause}>
          <Player
            ref={player}
            component={Promo}
            inputProps={INPUT}
            durationInFrames={TOTAL}
            fps={timing.fps}
            compositionWidth={timing.width}
            compositionHeight={timing.height}
            initialFrame={TOTAL - 1}
            moveToBeginningWhenEnded={false}
            controls={false}
            clickToPlay={false}
            doubleClickToFullscreen={false}
            spaceKeyToPlayOrPause={false}
            acknowledgeRemotionLicense
            style={{ width: "100%", height: "100%" }}
          />

          {showCta && (
            <div className="cta" onClick={(e) => e.stopPropagation()}>
              <div className="cta__row">
                {stage === "poster" ? (
                  <>
                    <button className="btn btn--primary" onClick={start} disabled={loaded < 1}>
                      {loaded < 1 ? <>加载中 {Math.round(loaded * 100)}%</> : <>▶ 播放宣传片 <em>{Math.round(timing.duration)} 秒</em></>}
                    </button>
                    <a className="btn btn--ghost" href={WEB.primary.url} target="_blank" rel="noreferrer">
                      {WEB.primary.label}
                    </a>
                  </>
                ) : (
                  <>
                    <a className="btn btn--primary" href={WEB.primary.url} target="_blank" rel="noreferrer">
                      {WEB.primary.label}
                    </a>
                    <a className="btn btn--ghost" href={WEB.secondary.url} target="_blank" rel="noreferrer">
                      {WEB.secondary.label}
                    </a>
                    <button className="btn btn--text" onClick={start}>
                      ↺ 重播
                    </button>
                  </>
                )}
              </div>
              <div className="cta__note">{stage === "poster" ? WEB.posterNote : WEB.endNote}</div>
            </div>
          )}

          {stage === "paused" && <div className="paused">▶</div>}

          {!showCta && (
            <div className="progress">
              <div ref={bar} />
            </div>
          )}
        </div>
      </div>
    </main>
  );
};
