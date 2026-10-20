import { useEffect, useState } from 'react';
import { Button, Card, Drawer, Space, Table, Tabs, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import MessageLogPage from './MessageLogPage';
import { EventConnection, EventRunsTable, eventNames, RunStatus, useEventRobot } from './EventTaskPage';
import { api } from '../api';
import { setLastSelectedRobotId } from '../robotSelection';

function EventRecords() {
  const { robotId, selector } = useEventRobot();
  const [rows, setRows] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<any>();
  const navigate = useNavigate();
  useEffect(() => { setPage(1); setSelected(undefined); }, [robotId]);
  useEffect(() => {
    let active = true;
    setRows([]);
    if (!robotId) return;
    setLoading(true);
    api.listEvents(robotId, page).then(r => { if (active) { setRows(r.items); setTotal(r.total); } }).catch(e => { if (active) message.error(e?.response?.data?.detail || '加载事件记录失败'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [robotId, page, revision]);
  return <Card title="事件记录" extra={<Button icon={<ReloadOutlined />} onClick={() => setRevision(v => v + 1)}>刷新</Button>}>
    <Space style={{ marginBottom: 16 }} wrap>{selector}<Typography.Text type="secondary">保留最近30天收到的事件。未配置任务，也能查看记录。</Typography.Text></Space>
    <EventConnection robotId={robotId} refresh={revision} />
    <Table rowKey="id" loading={loading} dataSource={rows} scroll={{ x: 850 }} pagination={{ current: page, pageSize: 20, total, onChange: setPage, showSizeChanger: false }} columns={[
      { title: '记录', dataIndex: 'id', render: id => `#${id}` },
      { title: '接收时间', dataIndex: 'created_at' }, { title: '发生事件', dataIndex: 'event_name' },
      { title: '关联群 / 联系人', render: (_, r) => r.payload.groupRemark || r.payload.groupName || r.payload.friendRemark || r.payload.friendName || '—' },
      { title: '我的任务触发结果', render: (_, r) => r.runs.length ? r.runs.map((run: any) => <div key={run.id}>{run.task_name} <RunStatus value={run.status} /></div>) : eventNames[r.event_type] ? '没有匹配的已启用任务' : '该事件暂不支持触发任务' },
      { title: '操作', render: (_, r) => <Space><Button type="link" onClick={() => setSelected(r)}>详情</Button>{eventNames[r.event_type] && <Button type="link" onClick={() => { if (robotId) setLastSelectedRobotId(robotId); navigate(`/event-tasks?event_type=${r.event_type}`); }}>创建事件任务</Button>}</Space> },
    ]} />
    <Drawer title={`事件记录 #${selected?.id || ''}`} width={900} open={!!selected} onClose={() => setSelected(undefined)}>
      <Typography.Title level={5}>{selected?.event_name}</Typography.Title>
      <EventRunsTable rows={selected?.runs || []} />
      <Typography.Title level={5}>原始事件</Typography.Title>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(selected?.payload, null, 2)}</pre>
    </Drawer>
  </Card>;
}

export default function MonitorPage() {
  return <Tabs destroyInactiveTabPane items={[
    { key: 'messages', label: '消息记录', children: <MessageLogPage /> },
    { key: 'events', label: '事件记录', children: <EventRecords /> },
  ]} />;
}
