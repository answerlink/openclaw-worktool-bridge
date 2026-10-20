// 渲染关键帧截图到 out/stills/，一次打包多次渲染。
//   node scripts/stills.mjs 1.5 4.2 12        指定秒数
//   node scripts/stills.mjs --scenes          每个场景取 35% 和 85% 两个时刻
//   可选：--scale 0.5  --comp Promo  --keep（不清空旧截图）
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const timing = JSON.parse(fs.readFileSync(path.join(root, "src/timing.json"), "utf8"));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const scale = Number(opt("--scale", "0.5"));
const compId = opt("--comp", "Promo");

let times = args.filter((a, i) => /^\d+(\.\d+)?$/.test(a) && !["--scale", "--comp"].includes(args[i - 1])).map(Number);
if (args.includes("--scenes")) {
  for (const [a, b] of Object.values(timing.scenes)) times.push(a + (b - a) * 0.35, a + (b - a) * 0.85);
}
times = [...new Set(times.map((t) => Math.round(t * 100) / 100))].sort((a, b) => a - b);
if (!times.length) {
  console.error("用法：node scripts/stills.mjs <秒数...> | --scenes");
  process.exit(1);
}

const outDir = path.join(root, "out", "stills");
if (!args.includes("--keep")) fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const serveUrl = await bundle({ entryPoint: path.join(root, "src/index.ts") });
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await openBrowser("chrome", fs.existsSync(chrome) ? {browserExecutable: chrome} : {});
const inputProps = { withAudio: false };
const composition = await selectComposition({ serveUrl, id: compId, inputProps, puppeteerInstance: browser });

for (const t of times) {
  const frame = Math.min(composition.durationInFrames - 1, Math.round(t * composition.fps));
  const output = path.join(outDir, `${t.toFixed(2).padStart(6, "0")}.jpg`);
  await renderStill({ composition, serveUrl, output, frame, inputProps, imageFormat: "jpeg", jpegQuality: 85, scale, puppeteerInstance: browser });
  console.log("rendered", t);
}
await browser.close({ silent: true });
