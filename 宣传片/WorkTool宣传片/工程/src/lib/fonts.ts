import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";
import config from "../../fonts.json";

for (const f of config.fonts) {
  loadFont({ family: f.family, url: staticFile(`fonts/${f.file}.woff2`), weight: f.weight });
}
