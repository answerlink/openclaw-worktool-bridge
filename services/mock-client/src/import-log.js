import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// 仅导入协议报文，不执行日志里的文字。默认匿名化业务字符串，不保留地址、token或原ID。
export async function importLog(file) {
  const steps = [], rules = [], pendingCommands = new Map();
  let time = 0, firstTime, previous = 0, dayOffset = 0, direction = '', sequence = 0;
  const alias = new Map();
  const name = value => { if (!alias.has(value)) alias.set(value, `样本-${createHash('sha256').update(value).digest('hex').slice(0, 8)}`); return alias.get(value); };
  function clean(value, key = '') {
    if (['messageId','queueReceivedAt','apiSend','meta','fileBase64','fileUrl','log','token'].includes(key)) return undefined;
    if (Array.isArray(value)) return value.map(v => clean(v, key));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clean(v,k)]).filter(([,v])=>v!==undefined));
    if (typeof value === 'string' && !['fileType'].includes(key)) return value ? name(value) : '';
    return value;
  }
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    const stamp = line.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
    if (stamp) {
      const current = (+stamp[1]*3600 + +stamp[2]*60 + +stamp[3])*1000 + +stamp[4];
      if (current < previous - 12*3600000) dayOffset += 86400000;
      previous = current; time = current + dayOffset;
    }
    let body;
    const received = line.match(/onMessage:\s*(\{.*\})\s*$/);
    if (received) direction = 'in';
    const sent = line.match(/^args\[1\] = (\{.*\})\s*$/);
    if (sent) direction = 'out';
    if (!received && !sent) continue;
    try { body = JSON.parse((received || sent)[1]); } catch { continue; }
    if (body.encryptType === 1) continue; // 不将未知/加密内容猜作业务数据。
    firstTime ??= time;
    const atMs = Math.max(0, time - firstTime);
    if (direction === 'in' && body.socketType === 2 && Array.isArray(body.list)) {
      // 导入业务任务，跳过页面循环、通知和机器人配置等环境相关指令。
      const commands = body.list.filter(c => [203,204,206,207,218,501,512].includes(c.type));
      if (!commands.length) continue;
      const saveAs = `task${++sequence}`;
      steps.push({ atMs, action: 'http', url: '${commandUrl}', body: { list: clean(commands) }, expect: { code: 200 }, saveAs });
      pendingCommands.set(body.messageId, { saveAs, commands });
    } else if (direction === 'out' && body.socketType === 2) {
      for (const item of body.list || []) if (item.type === 101) steps.push({ atMs, action: 'screen', data: clean(item) });
    } else if (direction === 'out' && body.socketType === 3) {
      const original = pendingCommands.get(body.messageId);
      if (!original) continue;
      for (const item of body.list || []) {
        let raw; try { raw = JSON.parse(item.rawMsg); } catch { continue; }
        rules.push({ type: raw.type, messageId: `\${${original.saveAs}.data.messageId}`,
          delayMs: Math.max(0, Math.round((item.timeCost || 0)*1000)), errorCode: item.errorCode || 0,
          errorReason: item.errorReason ? '日志样本中的执行失败' : '', successList: clean(item.successList || []), failList: clean(item.failList || []) });
      }
    }
  }
  // 动态ID在下发后才有，规则交给导入产物的使用者按 type/target 整理，避免误用历史ID。
  return { scenario: { speed: 1, steps }, executionSamples: rules,
    notes: ['commandUrl 默认接本工具演示 /send。真实后端请修改 HTTP body 和响应 data.messageId 路径。',
      'executionSamples 保留观测耗时/结果，不自动套用；同类型不同任务请按目标配置 rules。',
      '旧 messageId 已移除，下发响应由 saveAs 保存。读屏在执行中会被跳过并记录 screenSkipped。',
      '默认匿名化业务字符串；请人工检查导入内容。未导入HTTP事件和加密报文。'] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2] || !process.argv[3]) { console.error('用法: npm run import-log -- 客户端日志 输出.json'); process.exitCode=1; }
  else { await writeFile(process.argv[3], JSON.stringify(await importLog(process.argv[2]), null, 2)); console.log('导入完成'); }
}
