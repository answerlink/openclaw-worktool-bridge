import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Modal, Space, Statistic, Table, Tag, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { api } from '../api';

type Node = {
  node: string;
  ip: string;
  port: string;
  reachable: boolean;
  ready: boolean;
  draining: boolean;
  requestNode: boolean;
  activeHttpRequests?: number;
  jvm?: { uptimeSeconds?: number };
  longConnections?: { websocket?: number };
  load?: { processCpuPercent?: number; heapUsagePercent?: number };
  latencyMs?: number;
};

type Diagnostics = {
  generatedAt?: string;
  status?: string;
  requestNode?: string;
  nodes?: Node[];
  summary?: { registeredNodes?: number; reachableNodes?: number; readyNodes?: number; drainingNodes?: number; websocketConnections?: number };
  dependencies?: Record<string, { status?: string; latencyMs?: number }>;
  alerts?: unknown[];
};

function formatUptime(seconds?: number): string {
  if (seconds == null || !Number.isFinite(Number(seconds)) || Number(seconds) < 0) return '-';
  const total = Math.floor(Number(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}天${hours}小时${minutes}分`;
  if (hours > 0) return `${hours}小时${minutes}分`;
  return `${minutes}分`;
}

function alertText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const alert = value as Record<string, unknown>;
    const message = alert.message || alert.msg || alert.description || alert.detail || alert.reason;
    const code = alert.code || alert.type;
    const node = alert.node || alert.nodeId || alert.targetNode;
    if (message) return [node, code, message].filter(Boolean).map(String).join(' · ');
    return JSON.stringify(alert);
  }
  return String(value);
}

export default function BackendNodePage() {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [changing, setChanging] = useState('');

  const load = async () => {
    setLoading(true);
    try { setData(await api.adminBackendNodes()); }
    catch (error: any) { message.error(error?.response?.data?.detail || '加载节点状态失败'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const change = (node: Node, action: 'start' | 'stop') => {
    Modal.confirm({
      title: `确认${action === 'start' ? '下线' : '上线'}节点 ${node.node}？`,
      content: action === 'start' ? '下线会停止接收新请求，并断开该节点现有的 WebSocket 连接。' : '上线后该节点将重新接收请求。',
      okText: action === 'start' ? '确认下线' : '确认上线',
      okButtonProps: { danger: action === 'start' },
      onOk: async () => {
        setChanging(node.node);
        try {
          await api.adminBackendNodeDrain(action, node.ip, Number(node.port));
          message.success(action === 'start' ? '下线请求已执行' : '上线请求已执行');
          await load();
        } catch (error: any) {
          message.error(error?.response?.data?.detail || '节点操作失败');
        } finally { setChanging(''); }
      },
    });
  };

  const summary = data?.summary || {};
  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Card title="后端节点维护" extra={<Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新状态</Button>}>
      <Alert type="info" showIcon message="节点上下线会影响请求和 WebSocket 连接。操作前请确认目标节点。" style={{ marginBottom: 16 }} />
      <Space size={32} wrap>
        <Statistic title="注册节点" value={summary.registeredNodes ?? '-'} />
        <Statistic title="可达节点" value={summary.reachableNodes ?? '-'} />
        <Statistic title="就绪节点" value={summary.readyNodes ?? '-'} />
        <Statistic title="下线中" value={summary.drainingNodes ?? '-'} />
        <Statistic title="WebSocket 连接" value={summary.websocketConnections ?? '-'} />
      </Space>
      <Descriptions size="small" style={{ marginTop: 20 }} items={[
        { key: 'status', label: '集群状态', children: <Tag color={data?.status === 'UP' ? 'green' : 'red'}>{data?.status || '-'}</Tag> },
        { key: 'time', label: '诊断时间', children: data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : '-' },
        { key: 'request', label: '响应节点', children: data?.requestNode || '-' },
        { key: 'redis', label: 'Redis', children: data?.dependencies?.redis?.status || '-' },
        { key: 'mysql', label: 'MySQL', children: data?.dependencies?.mysql?.status || '-' },
      ]} />
      {data?.alerts?.length ? <Alert type="warning" showIcon message="集群告警" description={data.alerts.map((alert, index) => <div key={index}>{alertText(alert)}</div>)} style={{ marginTop: 12 }} /> : null}
    </Card>
    <Card title="节点列表">
      <Table<Node> rowKey="node" loading={loading} dataSource={data?.nodes || []} pagination={false} scroll={{ x: 1050 }} columns={[
        { title: '节点', dataIndex: 'node', width: 190, render: (value: string, row: Node) => <Space><Typography.Text copyable>{value}</Typography.Text>{row.requestNode && <Tag>当前响应</Tag>}</Space> },
        { title: '连接状态', width: 105, render: (_: unknown, row: Node) => <Tag color={row.reachable ? 'green' : 'red'}>{row.reachable ? '可达' : '不可达'}</Tag> },
        { title: '服务状态', width: 110, render: (_: unknown, row: Node) => <Tag color={row.draining ? 'orange' : row.ready ? 'green' : 'red'}>{row.draining ? '已下线' : row.ready ? '就绪' : '未就绪'}</Tag> },
        { title: '运行时长', width: 125, render: (_: unknown, row: Node) => formatUptime(row.jvm?.uptimeSeconds) },
        { title: 'HTTP 请求', dataIndex: 'activeHttpRequests', width: 105 },
        { title: 'WebSocket', width: 110, render: (_: unknown, row: Node) => row.longConnections?.websocket ?? '-' },
        { title: '进程 CPU', width: 100, render: (_: unknown, row: Node) => row.load?.processCpuPercent == null ? '-' : `${row.load.processCpuPercent}%` },
        { title: '堆使用率', width: 100, render: (_: unknown, row: Node) => row.load?.heapUsagePercent == null ? '-' : `${row.load.heapUsagePercent}%` },
        { title: '延迟', dataIndex: 'latencyMs', width: 85, render: (value?: number) => value == null ? '-' : `${value} ms` },
        { title: '操作', width: 105, fixed: 'right', render: (_: unknown, row: Node) => row.draining
          ? <Button type="primary" loading={changing === row.node} disabled={!!changing} onClick={() => change(row, 'stop')}>上线</Button>
          : <Button danger loading={changing === row.node} disabled={!!changing || !row.reachable} onClick={() => change(row, 'start')}>下线</Button> },
      ]} />
    </Card>
  </Space>;
}
