import "./index.css";
import { Composition } from "remotion";
import { Promo } from "./Promo";
import timing from "./timing.json";

const frames = (fps: number) => Math.round(timing.duration * fps);

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Promo"
        component={Promo}
        durationInFrames={frames(timing.fps)}
        fps={timing.fps}
        width={timing.width}
        height={timing.height}
        defaultProps={{ withAudio: true }}
      />
      <Composition
        id="PromoPreview"
        component={Promo}
        durationInFrames={frames(30)}
        fps={30}
        width={timing.width}
        height={timing.height}
        defaultProps={{ withAudio: true }}
      />
    </>
  );
};
