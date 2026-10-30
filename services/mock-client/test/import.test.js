import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importLog } from '../src/import-log.js';

test('日志导入匿名化、跨午夜、动态ID与执行耗时',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'mock-import-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const path=join(dir,'sample.log');
 await writeFile(path, '23:59:59.000 I/ws: onMessage: '+JSON.stringify({socketType:2,messageId:'old',list:[{type:203,titleList:['真实群名'],receivedContent:'私密内容'}]})+'\n'+
 '00:00:01.000 D/ws: sending\nargs[1] = '+JSON.stringify({socketType:3,messageId:'old',list:[{rawMsg:JSON.stringify({type:203}),errorCode:0,timeCost:2}]})+'\n'+
 '00:00:02.000 D/ws: sending\nargs[1] = '+JSON.stringify({socketType:2,list:[{type:101,titleList:['真实群名']}]})+'\n');
 const imported=await importLog(path);assert.equal(imported.scenario.steps[1].atMs,3000);
 assert.equal(imported.executionSamples[0].delayMs,2000);
 assert.ok(!JSON.stringify(imported).includes('真实群名'));assert.ok(!JSON.stringify(imported).includes('私密内容'));
 assert.equal(imported.executionSamples[0].messageId,'${task1.data.messageId}');
});
