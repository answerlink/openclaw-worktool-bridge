import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
import * as chromeLauncher from 'chrome-launcher';
import puppeteer from 'puppeteer-core';

const DEFAULT_URL = 'https://console.worktool.ymdyes.cn/';
const PROFILE_NAMES = ['mobile', 'desktop'];

function parseArgs(argv) {
  const args = {
    url: DEFAULT_URL,
    runs: 3,
    profile: 'both',
    out: '',
    chromePath: process.env.CHROME_PATH || '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--url') args.url = argv[++i];
    else if (value === '--runs') args.runs = Number(argv[++i]);
    else if (value === '--profile') args.profile = argv[++i];
    else if (value === '--out') args.out = argv[++i];
    else if (value === '--chrome-path') args.chromePath = argv[++i];
    else if (value === '--help' || value === '-h') args.help = true;
    else throw new Error(`未知参数: ${value}`);
  }
  if (!Number.isInteger(args.runs) || args.runs < 1 || args.runs > 20) {
    throw new Error('--runs 必须是 1 到 20 之间的整数');
  }
  if (!['mobile', 'desktop', 'both'].includes(args.profile)) {
    throw new Error('--profile 必须是 mobile、desktop 或 both');
  }
  return args;
}

function usage() {
  console.log(`用法:
  npm run perf:baseline -- [--url URL] [--runs 3] [--profile both] [--out DIR]

说明:
  - 每轮使用全新 Chrome 临时配置，禁用页面缓存，模拟首次访问。
  - Lighthouse 采用其标准移动端/桌面端配置。
  - 另行记录真实本机网络下的首次正文可见时间。`);
}

function detectChrome(explicitPath) {
  const candidates = [
    explicitPath,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error('没有找到 Chrome。请设置 CHROME_PATH 或传入 --chrome-path。');
  }
  return found;
}

function timestamp() {
  return new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
}

function round(value, digits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function median(values) {
  const valid = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!valid.length) return null;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
}

function auditValue(lhr, id, scale = 1) {
  const value = lhr.audits?.[id]?.numericValue;
  return Number.isFinite(value) ? value * scale : null;
}

function summarizeLighthouse(lhr, profile, run) {
  return {
    profile,
    run,
    fetchedAt: lhr.fetchTime,
    requestedUrl: lhr.requestedUrl,
    finalUrl: lhr.finalDisplayedUrl || lhr.finalUrl,
    performanceScore: round((lhr.categories?.performance?.score ?? 0) * 100, 0),
    fcpMs: round(auditValue(lhr, 'first-contentful-paint')),
    lcpMs: round(auditValue(lhr, 'largest-contentful-paint')),
    speedIndexMs: round(auditValue(lhr, 'speed-index')),
    tbtMs: round(auditValue(lhr, 'total-blocking-time')),
    cls: round(auditValue(lhr, 'cumulative-layout-shift'), 3),
    interactiveMs: round(auditValue(lhr, 'interactive')),
    ttfbMs: round(auditValue(lhr, 'server-response-time')),
    totalBytes: round(auditValue(lhr, 'total-byte-weight'), 0),
    jsExecutionMs: round(auditValue(lhr, 'bootup-time')),
    mainThreadMs: round(auditValue(lhr, 'mainthread-work-breakdown')),
  };
}

async function coldContentProbe(url, chromePath, profile) {
  const viewport = profile === 'mobile'
    ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { width: 1365, height: 768, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktool-perf-'));
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir,
    args: ['--incognito', '--no-first-run', '--disable-background-networking', '--disable-default-apps'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    await page.setCacheEnabled(false);
    await page.evaluateOnNewDocument(() => {
      window.__worktoolPerf = { firstBodyTextAt: null, lcpMs: null, cls: 0, tbtMs: 0 };
      const checkBody = () => {
        const text = document.body?.innerText?.replace(/\s+/g, ' ').trim() || '';
        const root = document.querySelector('#root');
        if (window.__worktoolPerf.firstBodyTextAt == null && root?.children.length && text.length >= 20) {
          window.__worktoolPerf.firstBodyTextAt = performance.now();
        }
        if (window.__worktoolPerf.firstBodyTextAt == null) requestAnimationFrame(checkBody);
      };
      requestAnimationFrame(checkBody);
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length) window.__worktoolPerf.lcpMs = entries.at(-1).startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__worktoolPerf.cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__worktoolPerf.tbtMs += Math.max(0, entry.duration - 50);
        }
      }).observe({ type: 'longtask', buffered: true });
    });

    const startedAt = Date.now();
    await page.goto(url, { waitUntil: 'load', timeout: 45_000 });
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const metrics = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      const resources = performance.getEntriesByType('resource');
      const originBytes = {};
      for (const resource of resources) {
        const origin = new URL(resource.name).origin;
        originBytes[origin] = (originBytes[origin] || 0) + (resource.transferSize || 0);
      }
      return {
        finalUrl: location.href,
        title: document.title,
        firstBodyTextMs: window.__worktoolPerf.firstBodyTextAt,
        fcpMs: fcp?.startTime ?? null,
        lcpMs: window.__worktoolPerf.lcpMs,
        cls: window.__worktoolPerf.cls,
        tbtMs: window.__worktoolPerf.tbtMs,
        ttfbMs: nav?.responseStart ?? null,
        domContentLoadedMs: nav?.domContentLoadedEventEnd ?? null,
        loadMs: nav?.loadEventEnd ?? null,
        redirectCount: nav?.redirectCount ?? null,
        resourceCount: resources.length,
        transferBytes: resources.reduce((sum, resource) => sum + (resource.transferSize || 0), 0),
        decodedBytes: resources.reduce((sum, resource) => sum + (resource.decodedBodySize || 0), 0),
        originBytes,
        bodyTextSample: document.body?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 240) || '',
      };
    });
    return {
      ...metrics,
      profile,
      wallClockMs: Date.now() - startedAt,
      firstBodyTextMs: round(metrics.firstBodyTextMs),
      fcpMs: round(metrics.fcpMs),
      lcpMs: round(metrics.lcpMs),
      cls: round(metrics.cls, 3),
      tbtMs: round(metrics.tbtMs),
      ttfbMs: round(metrics.ttfbMs),
      domContentLoadedMs: round(metrics.domContentLoadedMs),
      loadMs: round(metrics.loadMs),
    };
  } finally {
    await browser.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function runLighthouse(url, chromePath, profile) {
  const chrome = await chromeLauncher.launch({
    chromePath,
    chromeFlags: ['--headless', '--incognito', '--no-first-run', '--disable-background-networking'],
    logLevel: 'silent',
  });
  try {
    const options = {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance'],
      disableStorageReset: false,
    };
    const result = await lighthouse(url, options, profile === 'desktop' ? desktopConfig : undefined);
    if (!result?.lhr) throw new Error('Lighthouse 没有返回结果');
    return result.lhr;
  } finally {
    await chrome.kill();
  }
}

function aggregateProfile(profile, lighthouseRuns, contentRuns) {
  const lighthouseFields = [
    'performanceScore', 'fcpMs', 'lcpMs', 'speedIndexMs', 'tbtMs', 'cls',
    'interactiveMs', 'ttfbMs', 'totalBytes', 'jsExecutionMs', 'mainThreadMs',
  ];
  const contentFields = [
    'firstBodyTextMs', 'fcpMs', 'lcpMs', 'tbtMs', 'cls', 'ttfbMs',
    'domContentLoadedMs', 'loadMs', 'resourceCount', 'transferBytes', 'decodedBytes',
  ];
  return {
    profile,
    lighthouseMedian: Object.fromEntries(lighthouseFields.map((field) => [
      field,
      round(median(lighthouseRuns.map((item) => item[field])), field === 'cls' ? 3 : field === 'performanceScore' ? 0 : 1),
    ])),
    coldContentMedian: Object.fromEntries(contentFields.map((field) => [
      field,
      round(median(contentRuns.map((item) => item[field])), field === 'cls' ? 3 : 1),
    ])),
  };
}

function csvEscape(value) {
  if (value == null) return '';
  const string = String(value);
  return /[",\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

function writeCsv(file, rows) {
  if (!rows.length) return;
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const text = [headers.join(','), ...rows.map((row) => headers.map((key) => csvEscape(row[key])).join(','))].join('\n');
  fs.writeFileSync(file, `${text}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  const chromePath = detectChrome(args.chromePath);
  const profiles = args.profile === 'both' ? PROFILE_NAMES : [args.profile];
  const outDir = path.resolve(args.out || path.join('performance-results', timestamp()));
  fs.mkdirSync(outDir, { recursive: true });
  const lighthouseRuns = [];
  const contentRuns = [];

  console.log(`目标: ${args.url}`);
  console.log(`结果: ${outDir}`);
  console.log(`Chrome: ${chromePath}`);

  for (const profile of profiles) {
    for (let run = 1; run <= args.runs; run += 1) {
      console.log(`[${profile}] ${run}/${args.runs}: Lighthouse`);
      const lhr = await runLighthouse(args.url, chromePath, profile);
      fs.writeFileSync(path.join(outDir, `lighthouse-${profile}-${run}.json`), JSON.stringify(lhr, null, 2));
      lighthouseRuns.push(summarizeLighthouse(lhr, profile, run));

      console.log(`[${profile}] ${run}/${args.runs}: 首次正文探针`);
      contentRuns.push({ ...(await coldContentProbe(args.url, chromePath, profile)), run });
    }
  }

  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: {
      runnerLabel: process.env.PERF_RUNNER_LABEL || 'local',
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      node: process.version,
      chromePath,
    },
    config: { url: args.url, runs: args.runs, profiles },
    profiles: profiles.map((profile) => aggregateProfile(
      profile,
      lighthouseRuns.filter((item) => item.profile === profile),
      contentRuns.filter((item) => item.profile === profile),
    )),
    lighthouseRuns,
    contentRuns,
  };
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  writeCsv(path.join(outDir, 'lighthouse-runs.csv'), lighthouseRuns);
  writeCsv(path.join(outDir, 'cold-content-runs.csv'), contentRuns.map(({ originBytes, ...item }) => item));
  console.log(JSON.stringify(summary.profiles, null, 2));
  console.log(`完成: ${path.join(outDir, 'summary.json')}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}
