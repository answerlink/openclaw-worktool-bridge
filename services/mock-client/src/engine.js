import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import WebSocket from 'ws';
import { RecordBuffer } from './buffer.js';
import { id, envelope, encode, decode, result, callbackRequest, mask } from './protocol.js';

export class MockClient extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { heartbeatMs: 5000, reconnectMs: 5000, executionMs: 1200,
      encrypted: false, duplicationFilter: false, maxQueue: 10000, maxTrace: 2000,
      appVersion: '3.9.1.6', clientInstanceId: randomUUID(), ...config };
    for (const k of ['heartbeatMs', 'reconnectMs', 'executionMs']) {
      if (!Number.isFinite(this.config[k]) || this.config[k] < (k === 'executionMs' ? 0 : 10)) throw new Error(`非法 ${k}`);
    }
    this.queue = []; this.seen = new Set(); this.outbox = [];
    this.traceBuffer = new RecordBuffer(this.config.maxTrace, 4 * 1024 * 1024);
    this.trace = this.traceBuffer.items;
    this.rules = config.rules || []; this.groups = structuredClone(config.groups || {});
    this.timers = new Map(); this.running = false; this.paused = false; this.active = null;
    this.loopEnabled = true; this.heartbeatEnabled = true; this.sequence = 0;
    this.processSessionId = randomUUID(); this.lastHealthAt = 0;
    this.metrics = { received: 0, acknowledgements: 0, results: 0, duplicate: 0, callbacks: 0, callbackFailures: 0 };
  }
  record(kind, data = {}) {
    const event = { seq: ++this.sequence, at: Date.now(), kind, ...mask(data) };
    this.traceBuffer.push(event);
    this.emit('trace', event); return event;
  }
  snapshot() {
    return { connected: this.socket?.readyState === WebSocket.OPEN, running: this.running,
      paused: this.paused, heartbeatEnabled: this.heartbeatEnabled, active: this.active,
      queue: this.queue.map(x => ({ messageId: x.messageId, type: x.type })),
      pendingUploads: this.outbox.length, metrics: this.metrics, trace: this.trace };
  }
  delay(ms) {
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.timers.delete(timer); resolve(true); }, ms);
      this.timers.set(timer, resolve);
    });
  }
  start() { if (this.running) return; this.running = true; this.connect(); }
  connect() {
    if (!this.running) return;
    const url = new URL(this.config.url);
    if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('需要 ws:// 或 wss:// 地址');
    if (this.config.clientInstanceId) url.searchParams.set('clientInstanceId', this.config.clientInstanceId);
    const socket = new WebSocket(url, { headers: { appVersion: this.config.appVersion,
      ...(this.config.token ? { token: this.config.token } : {}) }, handshakeTimeout: 10000, maxPayload: 16 * 1024 * 1024 });
    this.socket = socket;
    socket.on('open', () => {
      if (socket !== this.socket || !this.running) { socket.close(); return; }
      this.record('connected', { url: url.toString() });
      this.send(envelope(2, [{type:301, log:`连接建立: ${this.config.robotId || 'mock'} appVersion: ${this.config.appVersion} workVersion: ${this.config.workVersion || '5.0.12'} deviceRooted: false hook: false appName: MockClient blue: 0 screenWidth: 1080 screenHeight: 2400 processSessionId: ${this.processSessionId}`} ]));
      const waiting = this.outbox.splice(0); for (const packet of waiting) this.send(packet);
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => { if (this.heartbeatEnabled) this.send(this.heartbeat(), false); }, this.config.heartbeatMs);
      this.drain(); this.emit('connected');
    });
    socket.on('message', bytes => { if (socket === this.socket && this.running) this.receive(bytes.toString()); });
    socket.on('error', error => this.record('connectionError', { message: error.message }));
    socket.on('close', (code, reason) => {
      if (socket !== this.socket) return;
      clearInterval(this.heartbeatTimer);
      this.record('disconnected', { code, reason: reason.toString() });
      if (this.running) this.reconnectTimer = setTimeout(() => this.connect(), this.config.reconnectMs);
    });
  }
  heartbeat() {
    const now = Date.now();
    if (now - this.lastHealthAt < 300000) return {type:11};
    this.lastHealthAt = now;
    return {type:11, logHealth:{healthy:true, consecutiveFailureCount:0},
      processHealth:{processSessionId:this.processSessionId, processStartTime:this.startedAt || (this.startedAt = now)}};
  }
  stop() {
    this.running = false; clearInterval(this.heartbeatTimer); clearTimeout(this.reconnectTimer);
    for (const [timer, resolve] of this.timers) { clearTimeout(timer); resolve(false); }
    this.timers.clear(); this.socket?.terminate();
  }
  disconnect() { this.socket?.terminate(); }
  send(packet, buffer = true) {
    if (!this.running) return false;
    if (this.socket?.readyState !== WebSocket.OPEN) {
      if (buffer) {
        if (this.outbox.length >= this.config.maxQueue) throw new Error('待上传队列已满');
        this.outbox.push(packet); this.record('uploadBuffered', { socketType: packet.socketType, messageId: packet.messageId });
      }
      return false;
    }
    this.socket.send(encode(packet, this.config.encrypted));
    this.record('sent', { packet });
    if (packet.socketType === 1) this.metrics.acknowledgements++;
    if (packet.socketType === 3) this.metrics.results++;
    return true;
  }
  receive(text) {
    try {
      const packet = decode(text); this.record('received', { packet });
      if (packet.socketType !== 2) return;
      this.metrics.received++;
      this.send(envelope(1, [], packet.messageId));
      if (this.seen.has(packet.messageId)) { this.metrics.duplicate++; this.record('duplicate', { messageId: packet.messageId }); return; }
      if (packet.messageId) this.seen.add(packet.messageId);
      if (this.seen.size > 10000) this.seen.delete(this.seen.values().next().value);
      if (!Array.isArray(packet.list)) throw new Error('任务 list 不是数组');
      for (const raw of packet.list) {
        const command = { ...raw, messageId: packet.messageId, ...(packet.apiSend == null ? {} : { apiSend: packet.apiSend }),
          ...(packet.meta == null ? {} : { meta: packet.meta }) };
        this.accept(command);
      }
    } catch (error) { this.record('protocolError', { message: error.message }); }
  }
  finish(command, started, options = {}) { this.send(result(command, started, options)); }
  accept(command) {
    const type = command.type;
    if (type === 102) { this.record('consoleNotice', { command }); return; }
    if (type === 202) { this.loopEnabled = true; return; }
    if (type === 307) { this.refreshConfig().catch(e => this.record('configError', { message: e.message })); return; }
    if ([304, 305, 306].includes(type)) { this.queueControl(command); return; }
    command.queueReceivedAt = Date.now();
    if ([308, 514].includes(type)) { void this.execute(command); return; }
    if (this.queue.length >= this.config.maxQueue) { this.finish(command, Date.now(), { errorCode: 101017, errorReason: '模拟器队列上限' }); return; }
    if (this.config.duplicationFilter && this.queue.some(x => this.comparable(x) === this.comparable(command))) {
      this.finish(command, Date.now(), { errorCode: 101014, errorReason: '指令重复' }); return;
    }
    if (command.up || type === 226) this.queue.unshift(command); else this.queue.push(command);
    this.record('queued', { messageId: command.messageId, type, depth: this.queue.length }); void this.drain();
  }
  comparable(command) {
    return JSON.stringify(Object.fromEntries(Object.entries(command).filter(([k]) => !['messageId','queueReceivedAt','meta'].includes(k)).sort()));
  }
  queueControl(command) {
    const started = Date.now();
    if (command.type === 306) {
      const copy = { ...command, messageIdList: this.queue.map(x => x.messageId),
        ...(command.showMessageHistory ? { commandList: structuredClone(this.queue) } : {}) };
      this.finish(copy, started, { successList: copy.messageIdList }); return;
    }
    const ids = String(command.originalContent || '').split(/[,，]/).map(x => x.trim());
    const removed = this.queue.filter(x => command.type === 304 || ids.includes(x.messageId));
    this.queue = this.queue.filter(x => !removed.includes(x));
    for (const item of removed) this.finish(item, started, { errorCode: 101018, errorReason: `待执行指令被取消，取消指令messageId=${command.messageId}` });
    this.finish(command, started, { successList: [...new Set(removed.map(x => x.messageId))] });
  }
  async drain() {
    if (this.draining || !this.running) return;
    this.draining = true;
    try {
      while (this.running && !this.paused && this.queue.length) {
        const command = this.queue.shift(); this.active = { messageId: command.messageId, type: command.type };
        await this.execute(command); this.active = null;
      }
    } finally { this.draining = false; }
  }
  group(name) { return { groupName: name, groupRemark: '', groupOwner: '模拟群主', groupNumber: 3, nameList: ['模拟群主', '模拟用户', '模拟机器人'], ...this.groups[name] }; }
  rule(command) { return this.rules.find(r => (!r.type || r.type === command.type) && (!r.messageId || r.messageId === command.messageId) && (!r.target || (command.titleList || [command.groupName]).includes(r.target))) || {}; }
  async execute(command) {
    const started = Date.now(), rule = this.rule(command), type = command.type;
    this.record('executionStarted', { messageId: command.messageId, type });
    if (type === 514 && this.logBusy) { this.finish(command, started, {errorCode:101012,errorReason:'正在采集日志，请稍后重试'}); return; }
    if (type === 514) this.logBusy = true;
    try {
      if (!(await this.delay(rule.delayMs ?? this.config.executionMs))) return;
      if (rule.dropResult) { this.record('resultDropped', { messageId: command.messageId }); return; }
      if (rule.errorCode) { this.finish(command, started, rule); return; }
      if (rule.uploads) for (const data of rule.uploads) this.send(envelope(2, [data], command.messageId));
      if (rule.mode === 'custom') { if (rule.callback) await this.callback(rule.callback); this.finish(command, started, rule); return; }
      if (type === 503) {
        this.send(envelope(2, [{ type: 503, myInfo: this.config.myInfo || { name: '模拟机器人', corporation: '模拟企业', sumInfo: 'Mock client' } }]));
        this.send(envelope(2, [{ type: 506, titleList: this.config.corporations || ['模拟企业'] }])); return;
      }
      if (type === 501) { for (const name of command.selectList || []) this.send(envelope(2, [{ type: 501, ...this.group(name) }], command.messageId)); return; }
      if (type === 512) {
        const group = this.group(command.groupName);
        this.send(envelope(2, [{ type: 501, ...group }], command.messageId));
        void this.callback({ type: 512, groupName:group.groupName, groupRemark:group.groupRemark,
          groupOwner:group.groupOwner, groupAnnouncement:group.groupAnnouncement || '',
          memberList:group.nameList, memberCount:group.nameList.length });
        this.finish(command, started); return;
      }
      if (type === 514) {
        try {
          const log = gzipSync(rule.logText || `模拟客户端日志 messageId=${command.objectName || command.messageId}\n`).toString('base64');
          this.finish(command, started, { log, metaJson: JSON.stringify({ mock: true }) });
        } finally { this.logBusy = false; }
        return;
      }
      if (type === 308) {
        this.finish(command, started, { filePath: `/storage/emulated/0/Android/data/mock/files/pre_download/${command.objectName || 'mock.bin'}` }); return;
      }
      if (type === 206) this.groups[command.groupName] = { groupName: command.groupName, groupRemark: command.groupRemark || '', nameList: command.selectList || [] };
      if (type === 207) {
        const group = this.group(command.groupName), name = command.newGroupName || command.groupName;
        if (command.groupRemark !== undefined) group.groupRemark = command.groupRemark;
        group.groupName = name; this.groups[name] = group;
        if (name !== command.groupName) delete this.groups[command.groupName];
      }
      if (![201, 203, 204, 205, 206, 207, 218, 224, 226].includes(type)) {
        this.finish(command, started, { errorCode: 101012, errorReason: `模拟器未实现指令 ${type}，请配置 mode=custom 的规则` }); return;
      }
      this.finish(command, started, { ...rule, successList: rule.successList ?? command.titleList ?? [] });
    } catch (error) {
      this.record('executionError', { message: error.message, messageId: command.messageId });
      this.finish(command, started, { errorCode: 101017, errorReason: error.message });
    } finally { if (type === 514) this.logBusy = false; }
  }
  screen(data) {
    if (this.paused || !this.loopEnabled || this.active) { this.record('screenSkipped', { reason: 'paused-or-busy' }); return false; }
    return this.send(envelope(2, [{ type: 101, roomType: 1, groupRemark: '', ...data }]));
  }
  async callback(data) {
    const address = this.config.eventCallbackUrl || this.config.callbackUrl;
    if (this.config.eventCallbackEnabled === false || !address) { this.record('callbackSkipped', { type: data.type }); return; }
    const { url, headers } = callbackRequest(address, this.config.token);
    try {
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(data), signal: AbortSignal.timeout(10000) });
      this.metrics.callbacks++;
      this.record('callback', { url: url.toString(), status: response.status, data });
      if (!response.ok) this.metrics.callbackFailures++;
      await response.body?.cancel();
    } catch (error) { this.metrics.callbackFailures++; this.record('callbackError', { message: error.message }); }
  }
  async refreshConfig() {
    if (!this.config.configUrl) { this.record('configSkipped', { reason: 'configUrl not configured' }); return; }
    const response = await fetch(this.config.configUrl, { headers: this.config.token ? { token: this.config.token } : {}, signal: AbortSignal.timeout(10000) });
    const body = await response.json();
    if (!response.ok || body.code !== 200 || !body.data) throw new Error('读取机器人配置失败');
    for (const field of ['callbackUrl', 'eventCallbackUrl', 'eventCallbackEnabled']) this.config[field] = body.data[field];
    this.record('configRefreshed');
  }
  pause(value) { if (value === this.paused) return; this.paused = value;
    void this.callback({ type: value ? 108 : 109, robotId: this.config.robotId, eventTime: Date.now(), eventId: randomUUID(), source: 'floating_window' });
    this.record(value ? 'paused' : 'resumed'); if (!value) void this.drain(); }
  async action(action) {
    switch (action.action) {
      case 'screen': return this.screen(action.data);
      case 'upload': return this.send(envelope(2, [action.data]));
      case 'event': return this.callback(action.data);
      case 'pause': return this.pause(true);
      case 'resume': return this.pause(false);
      case 'disconnect': return this.disconnect();
      case 'heartbeat': this.heartbeatEnabled = action.enabled; return;
      case 'config': return this.refreshConfig();
      default: throw new Error(`未知动作 ${action.action}`);
    }
  }
}
