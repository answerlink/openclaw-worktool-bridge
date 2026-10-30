import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { MockClient } from '../src/engine.js';
import { envelope, encode, decode, callbackRequest } from '../src/protocol.js';
import { createDemoBackend } from '../src/demo-backend.js';
import { createReceiver } from '../src/receiver.js';
import { waitFor, runScenario, loadScenario } from '../src/scenario.js';

async function setup(t, config={}) {
  const receiver=await createReceiver(), backend=await createDemoBackend({callbackUrl:receiver.url});
  const client=new MockClient({url:backend.wsUrl,executionMs:20,heartbeatMs:50,reconnectMs:30,eventCallbackUrl:receiver.url,...config});
  t.after(async()=>{client.stop();await backend.close();await receiver.close()});client.start();
  await waitFor(()=>client.snapshot().connected);
  await waitFor(()=>client.trace.some(e=>e.kind==='sent'&&e.packet.list?.[0]?.type===503));
  await waitFor(()=>!client.active);
  const send=async(command, options={})=>{
    const r=await fetch(backend.url+'/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command,...options})});return (await r.json()).data.messageId;
  };
  return {client,backend,receiver,send};
}
const results=c=>c.trace.filter(e=>e.kind==='sent'&&e.packet.socketType===3).map(e=>e.packet);

test('AES/CBC 与客户端 hex 协议互通',()=>{
  const packet=envelope(2,[{type:203,receivedContent:'中文'}],'1');
  assert.deepEqual(decode(encode(packet,true)).list,packet.list);
});
test('X- 查询参数转头，保留 event_token',()=>{
  const r=callbackRequest('http://localhost/cb?event_token=abc&X-Test=1&x-test=2');
  assert.equal(r.headers['x-test'],'2');assert.equal(r.url.search,'?event_token=abc');
});
test('完整 smoke 场景 + HTTP 执行回调',async t=>{
  const {client,backend,receiver}=await setup(t);
  // runner 只断言本次场景中的事件，启动资料已在 setup 中验证。
  const scenario=await loadScenario('scenarios/smoke.json');scenario.steps.shift();
  const report=await runScenario(client,scenario,{demoUrl:backend.url},receiver);
  assert.equal(report.passed,true,report.error);
});
test('先确认后执行，重发同 messageId 再确认但不重复执行',async t=>{
  const {client,send}=await setup(t);
  await send({type:203,titleList:['测试群']},{messageId:'duplicate'});
  await send({type:203,titleList:['测试群']},{messageId:'duplicate'});
  await waitFor(()=>results(client).some(p=>p.messageId==='duplicate'));
  assert.equal(results(client).filter(p=>p.messageId==='duplicate').length,1);
  assert.equal(client.trace.filter(e=>e.kind==='sent'&&e.packet.socketType===1&&e.packet.messageId==='duplicate').length,2);
  const ack=client.trace.find(e=>e.kind==='sent'&&e.packet.socketType===1&&e.packet.messageId==='duplicate');
  const result=client.trace.find(e=>e.kind==='sent'&&e.packet.socketType===3&&e.packet.messageId==='duplicate');assert.ok(ack.seq<result.seq);
});
test('串行执行与 up 插队，不抢占执行中任务',async t=>{
  const {client,send}=await setup(t,{executionMs:60});
  const a=await send({type:203,titleList:['a']});await waitFor(()=>client.active?.messageId===a);
  const b=await send({type:203,titleList:['b']});const c=await send({type:203,titleList:['c'],up:true});
  await waitFor(()=>results(client).length===3);assert.deepEqual(results(client).map(p=>p.messageId),[a,c,b]);
});
test('306查询与305取消不取消执行中任务',async t=>{
  const {client,send}=await setup(t,{executionMs:100});
  const a=await send({type:203,titleList:['a']});await waitFor(()=>client.active?.messageId===a);
  const b=await send({type:203,titleList:['b']});await waitFor(()=>client.queue.length===1);
  const query=await send({type:306,showMessageHistory:true});await waitFor(()=>results(client).some(p=>p.messageId===query));
  assert.deepEqual(JSON.parse(results(client).find(p=>p.messageId===query).list[0].rawMsg).messageIdList,[b]);
  await send({type:305,originalContent:`${a},${b}`});
  await waitFor(()=>results(client).some(p=>p.messageId===a));
  assert.equal(results(client).find(p=>p.messageId===b).list[0].errorCode,101018);
  assert.equal(results(client).find(p=>p.messageId===a).list[0].errorCode,0);
});
test('501只上报数据，512先501再执行回执与HTTP成员回调',async t=>{
  const {client,send,receiver}=await setup(t);
  const query=await send({type:501,selectList:['群A']});
  await waitFor(()=>client.trace.some(e=>e.kind==='sent'&&e.packet.messageId===query&&e.packet.list?.[0]?.type===501));
  assert.equal(results(client).some(p=>p.messageId===query),false);
  const members=await send({type:512,groupName:'群A'});await waitFor(()=>results(client).some(p=>p.messageId===members));
  await waitFor(()=>receiver.records.some(r=>r.body.type===512));
  assert.equal(receiver.records.find(r=>r.body.type===512).body.memberCount,3);
});
test('失败规则、未知指令不伪造成功',async t=>{
  const {client,send}=await setup(t,{rules:[{type:218,errorCode:201108,errorReason:'文件存储失败',failList:['群A']}]});
  const failure=await send({type:218});const unknown=await send({type:9999});
  await waitFor(()=>results(client).length===2);
  assert.equal(results(client).find(p=>p.messageId===failure).list[0].errorCode,201108);
  assert.equal(results(client).find(p=>p.messageId===unknown).list[0].errorCode,101012);
});
test('断线期间执行结果缓存并在重连后补发，同设备身份保持',async t=>{
  const {client,send,backend}=await setup(t,{executionMs:60,reconnectMs:120});
  const a=await send({type:203});await waitFor(()=>client.active?.messageId===a);client.disconnect();
  await waitFor(()=>client.outbox.length>0);await waitFor(()=>results(client).some(p=>p.messageId===a));
  const connections=backend.records.filter(r=>r.kind==='connection');assert.ok(connections.length>=2);
  assert.equal(new URL(connections[0].url,'http://x').searchParams.get('clientInstanceId'),new URL(connections[1].url,'http://x').searchParams.get('clientInstanceId'));
});
test('暂停挡住新任务但心跳继续，514独立处理并返回gzip日志',async t=>{
  const {client,send}=await setup(t);client.pause(true);
  const a=await send({type:203});const log=await send({type:514,objectName:'old-id'});
  await waitFor(()=>results(client).some(p=>p.messageId===log));
  assert.ok(gunzipSync(Buffer.from(results(client).find(p=>p.messageId===log).list[0].log,'base64')).toString().includes('old-id'));
  assert.equal(results(client).some(p=>p.messageId===a),false);
  await waitFor(()=>client.trace.some(e=>e.kind==='sent'&&e.packet.type===11));
  client.pause(false);await waitFor(()=>results(client).some(p=>p.messageId===a));
});
test('场景断言超时会失败，不返回绿色通过',async t=>{
  const {client}=await setup(t);const report=await runScenario(client,{steps:[{action:'assert',timeoutMs:30,match:{kind:'impossible'}}]});assert.equal(report.passed,false);
});
test('304清空队列，组合子指令各自保留同一个messageId',async t=>{
  const {client,send}=await setup(t);client.pause(true);
  await send(null,{messageId:'batch',list:[{type:203,titleList:['a']},{type:218,titleList:['b']}]});
  await waitFor(()=>client.queue.length===2);const clear=await send({type:304});
  await waitFor(()=>results(client).some(p=>p.messageId===clear));
  const canceled=results(client).filter(p=>p.messageId==='batch');assert.equal(canceled.length,2);
  assert.ok(canceled.every(p=>p.list[0].errorCode===101018));assert.equal(client.queue.length,0);
});
test('双向加密及514同时采集返回忙',async t=>{
  const {client,send}=await setup(t,{encrypted:true,executionMs:70});
  const a=await send({type:514,objectName:'a'},{encrypted:true});const b=await send({type:514,objectName:'b'},{encrypted:true});
  await waitFor(()=>results(client).some(p=>p.messageId===a));
  assert.equal(results(client).find(p=>p.messageId===a).list[0].errorCode,0);
  assert.equal(results(client).find(p=>p.messageId===b).list[0].errorCode,101012);
});
test('内容去重可选，重复待执行内容回101014',async t=>{
  const {client,send}=await setup(t,{duplicationFilter:true});client.pause(true);
  await send({type:203,titleList:['a']});const duplicate=await send({type:203,titleList:['a']});
  await waitFor(()=>results(client).some(p=>p.messageId===duplicate));
  assert.equal(results(client).find(p=>p.messageId===duplicate).list[0].errorCode,101014);
});
test('配置通知307刷新独立事件回调开关',async t=>{
  const {client,send,backend}=await setup(t);client.config.configUrl=backend.url+'/config';
  await send({type:307});await waitFor(()=>client.trace.some(x=>x.kind==='configRefreshed'));
  assert.equal(client.config.eventCallbackEnabled,true);
});
test('跨进程旧客户端可不携带实例ID，握手token不进入trace',async t=>{
  const {client,backend}=await setup(t,{clientInstanceId:'',token:'test-only-secret'});
  const connection=backend.records.find(x=>x.kind==='connection');
  assert.equal(new URL(connection.url,'http://x').searchParams.has('clientInstanceId'),false);
  assert.equal(connection.headers.token,'test-only-secret');
  assert.ok(!JSON.stringify(client.trace).includes('test-only-secret'));
});
