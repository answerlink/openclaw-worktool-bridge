import React from "react";
import { Img, staticFile } from "remotion";
import { FONT } from "../lib/theme";

const BAR = 0.036;

/**
 * 装真实网页截图的浏览器窗口（外观按项目风格改，只保留尺寸计算）。
 * `ratio` 是截图原图的宽 / 高（`images.py info` 查），图片按原比例铺满窗口宽度再乘 `zoom`，始终不会被压扁。
 * `scroll` 0..1 从页面顶部滚到底部（长截图用）；`focusX` 0..1 决定放大后看左边还是右边。
 */
export const BrowserFrame: React.FC<{
  src: string;
  ratio: number;
  url: string;
  width: number;
  height?: number;
  zoom?: number;
  focusX?: number;
  scroll?: number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({ src, ratio, url, width, height = (width * 9) / 16, zoom = 1, focusX = 0.5, scroll = 0, style, children }) => {
  const bar = Math.round(width * BAR);
  const viewH = height - bar;
  const imgW = width * zoom;
  const imgH = imgW / ratio;
  const left = -(imgW - width) * focusX;
  const top = -Math.max(0, imgH - viewH) * Math.min(1, Math.max(0, scroll));
  return (
    <div
      style={{
        width,
        height,
        borderRadius: Math.round(width * 0.014),
        overflow: "hidden",
        background: "#FFFFFF",
        boxShadow: "0 30px 80px rgba(0,0,0,0.28)",
        position: "relative",
        ...style,
      }}
    >
      <div style={{ height: bar, display: "flex", alignItems: "center", gap: bar * 0.22, padding: `0 ${bar * 0.45}px`, background: "#F2F4F8" }}>
        {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
          <div key={c} style={{ width: bar * 0.3, height: bar * 0.3, borderRadius: 99, background: c }} />
        ))}
        <div
          style={{
            marginLeft: bar * 0.4,
            flex: 1,
            maxWidth: width * 0.5,
            height: bar * 0.6,
            borderRadius: 99,
            background: "#FFFFFF",
            display: "flex",
            alignItems: "center",
            padding: `0 ${bar * 0.4}px`,
            fontFamily: FONT.body,
            fontSize: bar * 0.36,
            color: "#5A6478",
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {url}
        </div>
      </div>
      <div style={{ position: "relative", width, height: viewH, overflow: "hidden" }}>
        <Img src={staticFile(src)} style={{ position: "absolute", left, top, width: imgW, height: imgH, maxWidth: "none" }} />
        {children}
      </div>
    </div>
  );
};
