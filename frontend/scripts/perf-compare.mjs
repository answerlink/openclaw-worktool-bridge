import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const METRICS = [
  ['performanceScore', '性能分', true, ''],
  ['fcpMs', 'FCP', false, ' ms'],
  ['lcpMs', 'LCP', false, ' ms'],
  ['speedIndexMs', 'Speed Index', false, ' ms'],
  ['tbtMs', 'TBT', false, ' ms'],
  ['cls', 'CLS', false, ''],
  ['ttfbMs', 'TTFB', false, ' ms'],
  ['totalBytes', '传输量', false, ' B'],
  ['jsExecutionMs', 'JS 执行', false, ' ms'],
  ['mainThreadMs', '主线程', false, ' ms'],
];

function readSummary(input) {
  const file = fs.statSync(input).isDirectory() ? path.join(input, 'summary.json') : input;
  return { file, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

function fmt(value, suffix) {
  if (value == null) return '-';
  return `${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 3 })}${suffix}`;
}

function delta(before, after, higherIsBetter) {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return { text: '-', mark: '⚪' };
  const raw = after - before;
  const percent = before === 0 ? null : (raw / Math.abs(before)) * 100;
  const improved = higherIsBetter ? raw > 0 : raw < 0;
  const regressed = higherIsBetter ? raw < 0 : raw > 0;
  const text = `${raw > 0 ? '+' : ''}${raw.toFixed(1)}${percent == null ? '' : ` (${percent > 0 ? '+' : ''}${percent.toFixed(1)}%)`}`;
  return { text, mark: improved ? '✅' : regressed ? '⚠️' : '➖' };
}

function main() {
  const [beforeArg, afterArg, ...rest] = process.argv.slice(2);
  if (!beforeArg || !afterArg) {
    console.error('用法: npm run perf:compare -- <before/summary.json> <after/summary.json> [--out comparison.md]');
    process.exitCode = 1;
    return;
  }
  const outIndex = rest.indexOf('--out');
  const out = outIndex >= 0 ? rest[outIndex + 1] : '';
  const before = readSummary(beforeArg);
  const after = readSummary(afterArg);
  const beforeProfiles = new Map(before.data.profiles.map((item) => [item.profile, item]));
  const afterProfiles = new Map(after.data.profiles.map((item) => [item.profile, item]));
  const profiles = [...beforeProfiles.keys()].filter((name) => afterProfiles.has(name));
  const lines = [
    '# WorkTool 性能前后对比',
    '',
    `- 基线：${before.file}`,
    `- 新版：${after.file}`,
    `- 生成：${new Date().toISOString()}`,
    '',
  ];
  for (const profile of profiles) {
    const b = beforeProfiles.get(profile).lighthouseMedian;
    const a = afterProfiles.get(profile).lighthouseMedian;
    lines.push(`## ${profile}`, '', '| 指标 | 基线 | 新版 | 变化 | 判断 |', '|---|---:|---:|---:|:---:|');
    for (const [key, label, higherIsBetter, suffix] of METRICS) {
      const change = delta(b[key], a[key], higherIsBetter);
      lines.push(`| ${label} | ${fmt(b[key], suffix)} | ${fmt(a[key], suffix)} | ${change.text} | ${change.mark} |`);
    }
    const bodyB = beforeProfiles.get(profile).coldContentMedian.firstBodyTextMs;
    const bodyA = afterProfiles.get(profile).coldContentMedian.firstBodyTextMs;
    const bodyChange = delta(bodyB, bodyA, false);
    lines.push(`| 首次正文可见 | ${fmt(bodyB, ' ms')} | ${fmt(bodyA, ' ms')} | ${bodyChange.text} | ${bodyChange.mark} |`, '');
  }
  const report = `${lines.join('\n')}\n`;
  if (out) {
    fs.writeFileSync(out, report);
    console.log(`已写入 ${out}`);
  } else {
    console.log(report);
  }
}

main();
