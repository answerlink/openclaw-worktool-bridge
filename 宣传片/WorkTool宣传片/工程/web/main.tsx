import { createRoot } from "react-dom/client";
import fonts from "../fonts.json";
import { App } from "./App";
import { WEB } from "./config";
import "./style.css";

for (const f of fonts.fonts) {
  const face = new FontFace(f.family, `url(/fonts/${f.file}.woff2)`, { weight: f.weight });
  face.load().then((loaded) => document.fonts.add(loaded));
}
document.title = WEB.title;

createRoot(document.getElementById("root")!).render(<App />);
