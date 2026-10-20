import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Collapse, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import EventActionEditor from '../components/EventActionEditor';
import { actionNames, defaultEventAction, eventActions } from '../eventActionConfig';
import type { Robot } from '../types';
import { getLastSelectedRobotId, maskRobotIdForDisplay, setLastSelectedRobotId } from '../robotSelection';

export const eventNames: Record<number, string> = { [-1]: '机器人上线', [-2]: '机器人下线', 101: '机器人加入群组', 102: '群名变更', 103: '群解散', 104: '机器人被移出群', 105: '通过好友申请成功回调' };

const statuses: Record<string, [string, string]> = { queued: ['等待执行', 'blue'], running: ['正在提交', 'processing'], submitted: ['已提交指令', 'green'], skipped: ['已跳过', 'default'], failed: ['失败', 'red'], unknown: ['结果待确认', 'orange'] };
export function RunStatus({ value }: { value: string }) {
  return <Tag color={statuses[value]?.[1]}>{statuses[value]?.[0] || value}</Tag>;
}
export function EventRunsTable({ rows, loading = false, pagination = false }: { rows: any[]; loading?: boolean; pagination?: any }) {
  return <Table rowKey="id" dataSource={rows} loading={loading} pagination={pagination} scroll={{ x: 720 }} columns={[
    { title: '任务', dataIndex: 'task_name' },
    { title: '事件记录', dataIndex: 'event_id', render: (id) => id ? `#${id}` : '—' },
    { title: '时间', dataIndex: 'created_at' },
    { title: '状态', dataIndex: 'status', render: (v) => <RunStatus value={v} /> },
    { title: '说明', dataIndex: 'error_text', render: (v, row) => v || (row.status === 'submitted' ? 'WorkTool 已接收指令，客户端执行结果请到指令任务查询查看' : '—') },
    { title: '详情', render: (_, row) => <Button type="link" onClick={() => Modal.info({ title: '触发与提交详情', width: 720, content: <pre style={{ maxHeight: 480, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{JSON.stringify({ event: row.payload_json ? (typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json) : undefined, result: row.result_json ? (typeof row.result_json === 'string' ? JSON.parse(row.result_json) : row.result_json) : undefined }, null, 2)}</pre> })}>查看</Button> },
  ]} />;
}

export function useEventRobot() {
  const [robots, setRobots] = useState<Robot[]>([]);
  const [robotId, setRobotId] = useState<string>();
  useEffect(() => {
    let active = true;
    api.listRobots().then(list => {
      if (!active) return;
      setRobots(list || []);
      const last = getLastSelectedRobotId();
      setRobotId(list?.some((r: Robot) => r.robot_id === last) ? last : list?.[0]?.robot_id);
    }).catch(e => { if (active) message.error(e?.response?.data?.detail || '加载机器人失败'); });
    return () => { active = false; };
  }, []);
  const select = (id: string) => { setRobotId(id); setLastSelectedRobotId(id); };
  const selector = <Select showSearch optionFilterProp="label" placeholder="选择机器人" style={{ width: 340, maxWidth: '100%' }} value={robotId} onChange={select} options={robots.map(r => ({ value: r.robot_id, label: `${r.name || '机器人'} (${maskRobotIdForDisplay(r.robot_id)})` }))} />;
  return { robotId, selector };
}

export function EventConnection({ robotId, refresh = 0 }: { robotId?: string; refresh?: number }) {
  const navigate = useNavigate();
  const [state, setState] = useState<'loading' | 'connected' | 'missing' | 'error'>('loading');
  useEffect(() => {
    let active = true;
    setState('loading');
    if (robotId) api.eventConnection(robotId).then(r => { if (active) setState(r.connected ? 'connected' : 'missing'); }).catch(() => { if (active) setState('error'); });
    return () => { active = false; };
  }, [robotId, refresh]);
  return <Alert showIcon style={{ marginBottom: 16 }} type={state === 'connected' ? 'success' : state === 'missing' ? 'warning' : 'info'}
    message={{ loading: '正在检查事件接入状态', connected: '事件已接入平台', missing: '尚未完成事件接入', error: '暂时无法确认事件接入状态，请刷新重试' }[state]}
    description={state === 'connected' ? '这里展示机器人上下线、入群、群名变更、群解散、被移出群、通过好友申请等事件，以及客户端返回的查询结果，可查看事件详情和任务触发结果。' : state === 'missing' ? '到机器人信息的小白模式点击一键接入，消息和事件会一起交给平台处理。已有消息接入也可能需要补全事件接入。' : undefined}
    action={state === 'missing' && <Button onClick={() => { if (robotId) setLastSelectedRobotId(robotId); navigate('/robot-info'); }}>前往接入</Button>} />;
}

export default function EventTaskPage() {
  const { robotId, selector } = useEventRobot();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedRobotId, setLoadedRobotId] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<any>();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const kind = Form.useWatch('event_type', form) || 101;

  const [runTask, setRunTask] = useState<any>();
  const [runs, setRuns] = useState<any[]>([]);
  const [runPage, setRunPage] = useState(1);
  const [runTotal, setRunTotal] = useState(0);
  const [runLoading, setRunLoading] = useState(false);
  const requestId = useRef(0);
  useEffect(() => {
    const id = ++requestId.current;
    setRows([]); setLoadedRobotId(undefined); setOpen(false); setRunTask(undefined);
    if (!robotId) return;
    setLoading(true);
    api.listEventTasks(robotId).then(r => { if (id === requestId.current) { setRows(r.items); setLoadedRobotId(robotId); } }).catch(e => { if (id === requestId.current) message.error(e?.response?.data?.detail || '加载失败'); }).finally(() => { if (id === requestId.current) setLoading(false); });
  }, [robotId, revision]);
  const edit = (row?: any, eventType = 101) => {
    setEditing(row); form.resetFields();
    form.setFieldsValue(row ? { ...row, actions: eventActions(row), cooldown_scope: row.cooldown_scope || 'subject' } : { name: eventType === 101 ? '机器人入群说明' : `${eventNames[eventType]}通知`, event_type: eventType, filter_field: eventType === 105 ? 'friendName' : 'groupName', filter_value: '', actions: [defaultEventAction(eventType)], cooldown_scope: 'subject', action: 'send_text', group_name: '', extra_members: [], target: [103, 104].includes(eventType) ? 'fixed' : 'source', target_names: [], content: '', cooldown_seconds: 60, enabled: true });
    setOpen(true);
  };
  useEffect(() => {
    const type = Number(searchParams.get('event_type'));
    if (robotId && loadedRobotId === robotId && !loading && eventNames[type]) { edit(undefined, type); setSearchParams({}, { replace: true }); }
  }, [robotId, loadedRobotId, loading, searchParams]);
  useEffect(() => {
    let active = true;
    if (!runTask || !robotId) return;
    setRunLoading(true); setRuns([]);
    api.listEventRuns(robotId, runTask.id, runPage).then(r => { if (active) { setRuns(r.items); setRunTotal(r.total); } }).catch(e => { if (active) message.error(e?.response?.data?.detail || '加载执行记录失败'); }).finally(() => { if (active) setRunLoading(false); });
    return () => { active = false; };
  }, [runTask, robotId, runPage]);
  const save = async () => {
    let values;
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true);
    try { await api.saveEventTask({ ...values, robot_id: robotId }, editing?.id); message.success('事件任务已保存'); setOpen(false); setRevision(v => v + 1); }
    catch (e: any) { message.error(typeof e?.response?.data?.detail === 'string' ? e.response.data.detail : '保存失败，请检查填写内容'); }
    finally { setSaving(false); }
  };
  return <Card title="事件任务" extra={<Space><Button icon={<ReloadOutlined />} onClick={() => setRevision(v => v + 1)}>刷新</Button><Button type="primary" icon={<PlusOutlined />} disabled={!robotId || loadedRobotId !== robotId || loading} onClick={() => edit()}>新增事件任务</Button></Space>}>
    <Space style={{ marginBottom: 16 }} wrap>{selector}<Typography.Text type="secondary">发生指定事件时，自动执行配置的指令。</Typography.Text></Space>
    <EventConnection robotId={robotId} refresh={revision} />
    <Table rowKey="id" loading={loading} dataSource={rows} scroll={{ x: 760 }} columns={[
      { title: '名称', dataIndex: 'name' }, { title: '触发事件', dataIndex: 'event_type', render: (v) => eventNames[v] },
      { title: '执行动作', render: (_, r) => eventActions(r).map((step, i) => <div key={i}>{i + 1}. {actionNames[step.action]}</div>) },
      { title: '筛选条件', render: (_, r) => r.filter_value ? `${({ groupName: '群名', groupRemark: '群备注', friendName: '联系人名称', friendRemark: '联系人备注' } as any)[r.filter_field]}包含「${r.filter_value}」` : '全部' },
      { title: '状态', dataIndex: 'enabled', render: v => <Tag color={v ? 'green' : 'default'}>{v ? '已启用' : '已暂停'}</Tag> },
      { title: '操作', render: (_, r) => <Space><Button type="link" onClick={() => edit(r)}>编辑</Button><Button type="link" onClick={() => { setRunPage(1); setRunTask(r); }}>执行记录</Button><Popconfirm title="删除这条事件任务？" description="待执行任务将取消，历史记录保留。" onConfirm={async () => { try { await api.deleteEventTask(r.id); setRevision(v => v + 1); } catch { message.error('删除失败'); } }}><Button danger type="link">删除</Button></Popconfirm></Space> },
    ]} />
    <Drawer title={editing ? '编辑事件任务' : '新增事件任务'} width={560} open={open} onClose={() => { if (!saving) setOpen(false); }} extra={<Button type="primary" loading={saving} onClick={save}>保存</Button>}>
      <Form form={form} layout="vertical" disabled={saving}>
        <Form.Item name="name" label="任务名称" rules={[{ required: true, whitespace: true }]}><Input maxLength={128} /></Form.Item>
        <Form.Item name="event_type" label="发生什么事件" rules={[{ required: true }]}><Select options={Object.entries(eventNames).map(([value, label]) => ({ value: Number(value), label }))} onChange={v => form.setFieldsValue({ filter_field: v === 105 ? 'friendName' : 'groupName', filter_value: '', actions: [defaultEventAction(v)] })} /></Form.Item>
        {kind === 101 && <Typography.Paragraph type="secondary">指机器人加入一个新群，不是其他成员加入已有群。</Typography.Paragraph>}
        {kind > 0 && <Space align="start"><Form.Item name="filter_field" label="筛选条件（可选）"><Select style={{ width: 150 }} options={(kind === 105 ? [['friendName', '联系人名称'], ['friendRemark', '联系人备注']] : [['groupName', '群名'], ['groupRemark', '群备注']]).map(([value, label]) => ({ value, label }))} /></Form.Item><Form.Item name="filter_value" label="包含文字"><Input placeholder="留空表示全部" maxLength={128} /></Form.Item></Space>}
        {kind === 105 && <Typography.Paragraph type="secondary">机器人通过好友申请并确认成功后触发。</Typography.Paragraph>}
        <Typography.Paragraph>动作按从上到下的顺序执行，可使用箭头调整顺序。</Typography.Paragraph>
        <Form.List name="actions" rules={[{ validator: async (_, actions) => { if (!actions?.length) throw new Error('请至少添加一个动作'); } }]}>
          {(fields, { add, remove, move }, { errors }) => <>
            {fields.map(({ key, name }) => <EventActionEditor key={key} index={name} kind={kind} count={fields.length} remove={() => remove(name)} move={to => move(name, to)} />)}
            <Button block disabled={fields.length >= 10} icon={<PlusOutlined />} onClick={() => add(defaultEventAction(kind))}>添加动作（最多10个）</Button>
            <Form.ErrorList errors={errors} />
          </>}
        </Form.List>
        <Collapse style={{ marginTop: 16 }} items={[{ key: 'advanced', label: '更多设置', forceRender: true, children: <>
          <Form.Item name="cooldown_scope" label="冷却范围"><Select options={[{ value: 'subject', label: '每个联系人或群分别计算（推荐）' }, { value: 'rule', label: '整条规则共用' }]} /></Form.Item>
          <Form.Item name="cooldown_seconds" label="同一对象再次触发的最短间隔（秒）" extra="默认不同联系人、不同群互不影响；选择整条规则共用时，所有对象共享间隔。"><InputNumber min={10} max={86400} /></Form.Item>
        </> }]} />
        <Form.Item style={{ marginTop: 16 }} name="enabled" label="启用任务" valuePropName="checked"><Switch /></Form.Item>
        <Typography.Paragraph type="secondary">仅对保存后收到的新事件生效。同一个机器人可被多人绑定，请避免配置重复任务。变量缺失时会停止该次执行。</Typography.Paragraph>
      </Form>
    </Drawer>
    <Drawer title={`${runTask?.name || ''} · 执行记录`} width={1000} open={!!runTask} onClose={() => setRunTask(undefined)}><EventRunsTable rows={runs} loading={runLoading} pagination={{ current: runPage, pageSize: 20, total: runTotal, showSizeChanger: false, onChange: setRunPage }} /></Drawer>
  </Card>;
}
