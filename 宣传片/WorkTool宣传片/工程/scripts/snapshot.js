// 在已登录的页面里执行（Cursor 内置浏览器 browser_cdp 的 Runtime.evaluate，或 DevTools 的 evaluate_script），
// 返回自包含的 HTML 快照：先滚完所有滚动容器触发懒加载，再把 CSSOM 规则内联、移除脚本和弹窗、固定图片地址。
// 结果交给 scripts/snapshot.py 在本地按任意尺寸、像素密度重新渲染。
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const scrollers = [document.scrollingElement, ...document.querySelectorAll("*")].filter(
    (e) => e && (e === document.scrollingElement || (e.scrollHeight > e.clientHeight + 200 && /(auto|scroll)/.test(getComputedStyle(e).overflowY || ""))),
  );
  for (const s of scrollers) {
    for (let y = 0; y < s.scrollHeight; y += 700) {
      s.scrollTop = y;
      await sleep(120);
    }
    s.scrollTop = 0;
  }
  await sleep(1500);
  let css = "";
  for (const sheet of document.styleSheets) {
    try {
      for (const r of sheet.cssRules) css += r.cssText + "\n";
    } catch (e) {
      if (sheet.href) css += `@import url("${sheet.href}");\n`;
    }
  }
  const doc = document.documentElement.cloneNode(true);
  doc.querySelectorAll("script,noscript,link[rel=stylesheet],style,.ant-modal-root,[role=dialog]").forEach((e) => e.remove());
  const live = document.querySelectorAll("img");
  doc.querySelectorAll("img").forEach((img, i) => {
    const src = live[i] && (live[i].currentSrc || live[i].src);
    if (src) img.setAttribute("src", src);
    img.removeAttribute("srcset");
    img.removeAttribute("loading");
  });
  const head = doc.querySelector("head");
  const base = document.createElement("base");
  base.href = location.origin + "/";
  head.prepend(base);
  const st = document.createElement("style");
  st.textContent = css;
  head.appendChild(st);
  return JSON.stringify({ url: location.href, title: document.title, html: "<!doctype html>" + doc.outerHTML });
})();
