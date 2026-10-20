import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  base: "./",
  publicDir: path.resolve(__dirname, "../public"),
  plugins: [react()],
  server: { port: 5199 },
  build: { outDir: path.resolve(__dirname, "../out/web"), emptyOutDir: true },
});
