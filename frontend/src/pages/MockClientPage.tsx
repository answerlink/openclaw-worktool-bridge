import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Collapse, Form, Input, InputNumber, Row, Select, Space, Statistic, Tabs, Tag, Typography, message } from 'antd';
import { DownloadOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { emptyCursor, mergeMockRecords, mockApi, mockWebSocketUrl, MockRecord, MockSession, MockState, parseMockObject } from '../mockClientApi';
import { api } from '../api';

const SESSION_KEY = 'console.mock-client.session';
const screenDefault = JSON.stringify({ titleList: ['模拟测试群'], messageList: [{ sender: 0, nameList: ['模拟用户'], textType: 1, itemMessageList: [{ feature: 2, text: '你好，模拟读屏' }] }] }, null, 2);
const scenarioDefault = JSON.stringify({ steps: [
  { action: 'http', url: '${demoUrl}/send', body: { command: { type: 203, titleList: ['模拟测试群'], receivedContent: '场景消息' } }, saveAs: 'task' },
  { action: 'assert', name: '执行成功', match: { kind: 'sent', 'packet.socketType': 3, 'packet.messageId': '${task.data.messageId}', 'packet.list.0.errorCode': 0 } }
] }, null, 2);
function errorText(e: any) { return e?.response?.data?.detail || e?.message || '操作失败'; }
function readSelection() { try { return sessionStorage.getItem(SESSION_KEY) || ''; } catch { return ''; } }
const jsonStyle = { whiteSpace: 'pre-wrap' as const, overflowWrap: 'anywhere' as const, margin: 0, fontSize: 12, maxHeight: 400, overflow: 'auto' };
function Records({ records }: { records: MockRecord[] }) {
  if (!records.length) return <Typography.Text type="secondary">等待收到记录</Typography.Text>;
  return <div style={{ maxHeight: 520, overflow: 'auto' }}><Collapse size="small" items={records.slice().reverse().map(r => ({
    key: r.seq, label: `${new Date(r.at).toLocaleTimeString()} ${r.kind || 'HTTP 回调'} ${r.messageId || ''}`,
    children: <pre style={jsonStyle}>{JSON.stringify(r, null, 2)}</pre>
  }))} /></div>;
}

export default function MockClientPage() {
  const [form] = Form.useForm();
  const robotId = Form.useWatch('robotId', form);
  const [backendBase, setBackendBase] = useState('');
  const [sessions, setSessions] = useState<MockSession[]>([]);
  const [selected, setSelected] = useState(readSelection);
  const [state, setState] = useState<MockState | null>(null);
  const [trace, setTrace] = useState<MockRecord[]>([]);
  const [callbacks, setCallbacks] = useState<MockRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [gap, setGap] = useState(false);
  const [idleMinutes, setIdleMinutes] = useState(30);
  const [maxSessions, setMaxSessions] = useState(4);
  const [screen, setScreen] = useState(screenDefault);
  const [event, setEvent] = useState('{"type":102,"groupName":"模拟群改名","groupRemark":"","roomType":1}');
  const [rules, setRules] = useState('[{"type":218,"delayMs":15000}]');
  const [command, setCommand] = useState('{"type":203,"titleList":["模拟测试群"],"receivedContent":"你好"}');
  const [scenario, setScenario] = useState(scenarioDefault);

  const reloadSessions = useCallback(async () => {
    const data = await mockApi.list();
    setSessions(data.sessions); setMaxSessions(data.maxSessions); setIdleMinutes(data.idleMinutes);
    setSelected(current => current && !data.sessions.some(s => s.id === current) ? '' : current);
  }, []);
  useEffect(() => { void reloadSessions().catch(e => setError(errorText(e))); }, [reloadSessions]);
  useEffect(() => {
    let mounted = true;
    void api.getWorktoolSettings().then(settings => { if (mounted) setBackendBase(settings.worktool_api_base || ''); })
      .catch(e => { if (mounted) setError(`读取 Console 后端配置失败：${errorText(e)}`); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    try { form.setFieldValue('url', mockWebSocketUrl(backendBase, robotId || '')); }
    catch { form.setFieldValue('url', ''); }
  }, [backendBase, robotId, form]);
  useEffect(() => { try { if (selected) sessionStorage.setItem(SESSION_KEY, selected); else sessionStorage.removeItem(SESSION_KEY); } catch { /* storage may be disabled */ } }, [selected]);

  useEffect(() => {
    setState(null); setTrace([]); setCallbacks([]); setGap(false); setPollError('');
    if (!selected) return;
    let stopped = false, inFlight = false, cursor = emptyCursor();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const poll = async () => {
      if (stopped || inFlight || document.hidden) return;
      inFlight = true; controller = new AbortController();
      try {
        const next = await mockApi.state(selected, cursor, controller.signal);
        if (stopped) return;
        const reset = next.reset || next.epoch !== cursor.epoch;
        cursor = { epoch: next.epoch, after: next.traceCursor, callbackAfter: next.callbackCursor };
        setState(next); setIdleMinutes(next.idleMinutes); setPollError('');
        if (next.traceGap || next.callbackGap) setGap(true);
        if (reset) setGap(false);
        setTrace(old => mergeMockRecords(old, next.trace, reset, 150));
        setCallbacks(old => mergeMockRecords(old, next.callbacks, reset, 100));
      } catch (e: any) {
        if (!stopped && e.code !== 'ERR_CANCELED') {
          setPollError(errorText(e));
          if (e.response?.status === 404) { setSelected(''); void reloadSessions().catch(() => {}); }
        }
      } finally {
        inFlight = false;
        if (!stopped && !document.hidden) timer = setTimeout(poll, 1000);
      }
    };
    const visibility = () => { clearTimeout(timer); if (!document.hidden) void poll(); };
    document.addEventListener('visibilitychange', visibility); void poll();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', visibility); };
  }, [selected, reloadSessions]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const operate = async (operation: Parameters<typeof mockApi.operate>[1], body: unknown = {}) => {
    if (!selected) throw new Error('请先新建或选择会话');
    return mockApi.operate(selected, operation, body);
  };
  const createSession = () => run(async () => {
    const data = await mockApi.create(); await reloadSessions(); setSelected(data.id);
  });
  const connect = (demo: boolean) => run(async () => {
    const values = demo ? form.getFieldsValue(true) : await form.validateFields();
    // Resolve the effective setting again at connect time, so a Console config change takes effect.
    if (!demo) {
      const settings = await api.getWorktoolSettings();
      setBackendBase(settings.worktool_api_base || '');
      values.url = mockWebSocketUrl(settings.worktool_api_base || '', values.robotId);
    }
    const parsedRules = JSON.parse(rules); if (!Array.isArray(parsedRules)) throw new Error('执行规则需要JSON数组');
    await operate('connect', { demo, config: { ...values, rules: parsedRules } });
    await reloadSessions(); message.success(demo ? '本地演示已连接' : '模拟客户端已连接');
  });
  const active = Boolean(selected && state?.running);
  const controlsDisabled = busy || !active || Boolean(state?.scenarioRunning);
  const connectionStatus = state?.connected ? (state.paused ? '已暂停' : '已连接') : state?.running ? '等待重连' : '未连接';

  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Card title="模拟客户端" extra={<Tag color={state?.connected ? 'green' : 'default'}>{connectionStatus}</Tag>}>
      <Space wrap>
        <Select aria-label="模拟会话" placeholder="选择会话" style={{ width: 300 }} value={selected || undefined} disabled={busy}
          onChange={setSelected} options={sessions.map(s => ({ value: s.id, label: `${s.robotId || '未连接机器人'} · ${s.id.slice(0, 8)}` }))} />
        <Button icon={<PlusOutlined />} disabled={busy} onClick={() => void createSession()}>新建会话</Button>
        <Button icon={<ReloadOutlined />} disabled={busy} onClick={() => void run(reloadSessions)}>刷新会话</Button>
        <Button disabled={busy || !selected || Boolean(state?.scenarioRunning)} onClick={() => void run(async () => { await operate('delete'); setSelected(''); await reloadSessions(); })}>关闭会话</Button>
      </Space>
      <div style={{ marginTop: 12 }}><Typography.Text type="secondary">独立连接与回调记录，服务最多 {maxSessions} 个会话。{idleMinutes ? `离开页面 ${idleMinutes} 分钟后自动清理，场景运行期间保留。` : '会话保留至手动关闭或服务重启。'}</Typography.Text></div>
    </Card>
    {error && <Alert type="error" showIcon message={error} closable onClose={() => setError('')} />}
    {pollError && <Alert type="error" showIcon message={pollError} />}
    {gap && <Alert type="info" showIcon message="较早记录已按缓存容量清理，当前显示保留记录。" />}
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={9}><Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card title="连接设置">
          <Form form={form} layout="vertical" initialValues={{ robotId: 'mock-test-robot', appVersion: '3.9.1.6', clientInstanceId: 'mock-installation-001', executionMs: 1200 }}>
            <Form.Item name="robotId" label="测试机器人 ID" rules={[{ required: true, whitespace: true, message: '请输入测试机器人 ID' }]}><Input /></Form.Item>
            <Form.Item name="url" label="WebSocket 地址" extra="根据 Console 后端 baseurl 自动生成"><Input readOnly placeholder="等待读取 Console 后端配置" /></Form.Item>
            <Form.Item name="eventCallbackUrl" label="事件回调地址"><Input placeholder="留空使用本会话接收器" /></Form.Item>
            <Form.Item name="executionMs" label="模拟执行耗时（毫秒）"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
            <Collapse size="small" items={[{ key: 'more', label: '版本与身份设置', forceRender: true, children: <>
              <Form.Item name="appVersion" label="客户端版本"><Input /></Form.Item>
              <Form.Item name="clientInstanceId" label="安装实例 ID"><Input placeholder="相同值模拟同设备重连" /></Form.Item>
              <Form.Item name="token" label="客户端登录 Token"><Input.Password autoComplete="off" /></Form.Item>
            </> }]} />
          </Form>
          <Space wrap style={{ marginTop: 16 }}>
            <Button type="primary" disabled={busy || !selected || Boolean(state?.scenarioRunning)} onClick={() => void connect(false)}>连接测试后端</Button>
            <Button disabled={busy || !selected || Boolean(state?.scenarioRunning)} onClick={() => void connect(true)}>启动本地演示</Button>
            <Button disabled={busy || !active} onClick={() => void run(async () => { await operate('stop'); await reloadSessions(); })}>停止连接 / 场景</Button>
          </Space>
        </Card>
        <Card title="运行控制"><Space wrap>
          <Button disabled={controlsDisabled} onClick={() => void run(() => operate('action', { action: state?.paused ? 'resume' : 'pause' }))}>{state?.paused ? '恢复运行' : '暂停运行'}</Button>
          <Button disabled={controlsDisabled} onClick={() => void run(() => operate('action', { action: 'disconnect' }))}>断线后重连</Button>
          <Button disabled={controlsDisabled} onClick={() => void run(() => operate('action', { action: 'heartbeat', enabled: !state?.heartbeatEnabled }))}>{state?.heartbeatEnabled ? '暂停心跳' : '恢复心跳'}</Button>
        </Space></Card>
        <Card title="执行规则"><Input.TextArea aria-label="执行规则JSON" rows={5} value={rules} onChange={e => setRules(e.target.value)} /><Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>按指令类型或目标匹配，可设置耗时、失败原因和不回执。</Typography.Paragraph><Button disabled={controlsDisabled} onClick={() => void run(async () => { const parsed = JSON.parse(rules); if (!Array.isArray(parsed)) throw new Error('执行规则需要JSON数组'); await operate('rules', { rules: parsed }); message.success('规则已更新'); })}>应用规则</Button></Card>
      </Space></Col>
      <Col xs={24} xl={15}><Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card><Row gutter={12}>{[['排队', state?.queueLength], ['接收确认', state?.metrics?.acknowledgements], ['执行结果', state?.metrics?.results], ['重复包', state?.metrics?.duplicate]].map(([label, value]) => <Col span={6} key={String(label)}><Statistic title={label} value={value || 0} /></Col>)}</Row><div style={{ marginTop: 12 }}><Typography.Text type="secondary">执行中：{state?.active ? `${state.active.type} · ${state.active.messageId}` : '空闲'}</Typography.Text></div></Card>
        <Card><Tabs items={[
          { key: 'screen', label: '读屏上报', children: <><Input.TextArea aria-label="读屏JSON" rows={8} value={screen} onChange={e => setScreen(e.target.value)} /><Button style={{ marginTop: 12 }} disabled={controlsDisabled} onClick={() => void run(() => operate('action', { action: 'screen', data: parseMockObject(screen) }))}>上报读屏</Button></> },
          { key: 'event', label: '事件回调', children: <><Input.TextArea aria-label="事件JSON" rows={6} value={event} onChange={e => setEvent(e.target.value)} /><Button style={{ marginTop: 12 }} disabled={controlsDisabled} onClick={() => void run(() => operate('action', { action: 'event', data: parseMockObject(event) }))}>发送事件</Button></> },
          { key: 'command', label: '演示任务', children: <><Typography.Paragraph type="secondary">本地演示对端下发任务；连接真实后端时使用其指令下发接口。</Typography.Paragraph><Input.TextArea aria-label="演示任务JSON" rows={6} value={command} onChange={e => setCommand(e.target.value)} /><Button style={{ marginTop: 12 }} disabled={controlsDisabled || !state?.demoUrl} onClick={() => void run(() => operate('demo-command', { command: parseMockObject(command) }))}>下发演示任务</Button></> },
        ]} /></Card>
        <Card title="协议时间线" extra={<Button icon={<DownloadOutlined />} disabled={busy || !selected} onClick={() => void run(async () => { const data = await mockApi.export(selected); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'mock-session.json'; a.click(); URL.revokeObjectURL(url); })}>导出</Button>}><Records records={trace} /></Card>
        <Card title="本会话收到的回调"><Typography.Paragraph copyable={state?.callbackUrl ? { text: state.callbackUrl } : false} style={{ overflowWrap: 'anywhere' }}>{state?.callbackUrl || '选择会话后显示接收地址'}</Typography.Paragraph><Records records={callbacks} /></Card>
        <Card title="场景回归" extra={state?.scenarioRun && <Tag color={state.scenarioRun.status === 'passed' ? 'green' : state.scenarioRun.status === 'failed' ? 'red' : 'blue'}>{state.scenarioRun.status === 'running' ? '运行中' : state.scenarioRun.status === 'passed' ? '通过' : '未通过'}</Tag>}>
          <Input.TextArea aria-label="场景JSON" rows={10} value={scenario} onChange={e => setScenario(e.target.value)} />
          <Space style={{ marginTop: 12, marginBottom: 12 }}><Button type="primary" disabled={controlsDisabled} onClick={() => void run(async () => { const parsed = parseMockObject(scenario); if (!Array.isArray(parsed.steps)) throw new Error('场景需要steps数组'); await operate('scenario-start', parsed); message.success('场景已启动'); })}>启动场景</Button><Typography.Text type="secondary">后台执行，结果自动更新</Typography.Text></Space>
          {state?.scenarioRun?.report != null && <pre style={jsonStyle}>{JSON.stringify(state.scenarioRun.report, null, 2)}</pre>}
        </Card>
      </Space></Col>
    </Row>
  </Space>;
}
