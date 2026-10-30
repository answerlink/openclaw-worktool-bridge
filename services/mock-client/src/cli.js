import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { MockClient } from './engine.js';
import { createReceiver } from './receiver.js';
import { createDemoBackend } from './demo-backend.js';
import { loadScenario, runScenario, expand, waitFor } from './scenario.js';

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
let client, receiver, demo;
try {
  receiver = await createReceiver(Number(option('--callback-port') || 0));
  const variables = { env: process.env, callbackUrl: receiver.url + '/callback' };
  if (args.includes('--demo')) { demo = await createDemoBackend({ callbackUrl: variables.callbackUrl }); variables.demoUrl = demo.url; }
  const config = option('--config') ? expand(JSON.parse(await readFile(option('--config'), 'utf8')), variables) : {};
  if (!config.url && !demo) throw new Error('指定 --config config.local.json 或 --demo');
  variables.config = config;
  variables.commandUrl = option('--command-url') || (demo ? demo.url + '/send' : undefined);
  client = new MockClient({ url: demo?.wsUrl, eventCallbackUrl: variables.callbackUrl, executionMs: demo ? 25 : 1200, ...config });
  client.start(); await waitFor(() => client.snapshot().connected, 10000, 'WebSocket 连接');
  const scenario = await loadScenario(option('--scenario') || 'scenarios/smoke.json');
  const report = await runScenario(client, scenario, variables, receiver);
  report.trace = client.trace; report.callbacks = receiver.records;
  const file = option('--report') || 'reports/latest.json';
  await mkdir(new URL('.', new URL(file, `file://${process.cwd()}/`)), { recursive: true });
  await writeFile(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, error: report.error, checks: report.checks.length, report: file }));
  if (!report.passed) process.exitCode = 1;
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { client?.stop(); await demo?.close(); await receiver?.close(); }
