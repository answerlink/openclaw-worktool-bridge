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
  jvm?: {
    uptimeSeconds?: number; heapUsedBytes?: number; heapCommittedBytes?: number; heapMaxBytes?: number;
    nonHeapUsedBytes?: number; threadCount?: number; blockedThreadCount?: number;
    monitor?: {
      sampledAtEpochMs?: number; sampleAgeMs?: number; sampleIntervalMs?: number; failedSamples?: number;
      interval?: { available?: boolean; elapsedMs?: number; gcTimePercent?: number; gcCountDelta?: number; gcTimeMsDelta?: number; processCpuPercentOfMachine?: number };
      os?: { processRssBytes?: number; processRssPeakBytes?: number; memAvailableBytes?: number; processSwapBytes?: number };
      recentPeaks?: { coverageMillis?: number; heapUsedBytes?: number; processRssBytes?: number };
      collectors?: Array<{ name: string; count?: number; timeMs?: number; lastCollection?: { durationMs?: number; endedAtEpochMs?: number } }>;
      memoryPools?: Array<{ name: string; type?: string; usage?: { usedBytes?: number; committedBytes?: number; maxBytes?: number } }>;
    };
  };
  longConnections?: { websocket?: number };
  load?: { processCpuPercent?: number; systemCpuPercent?: number; heapUsagePercent?: number; systemLoadAverage?: number; websocketMessages?: { receivedLastSecond?: number } };
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

type Health = { color: string; label: string; reasons: string[] };

function nodeHealth(node: Node): Health {
  if (!node.reachable) return { color: 'red', label: '异常', reasons: ['节点不可达'] };
  if (node.draining) return { color: 'gold', label: '维护中', reasons: ['节点已下线，不接收新请求'] };
  if (!node.ready) return { color: 'red', label: '异常', reasons: ['节点可达但未就绪'] };
  const red: string[] = [];
  const yellow: string[] = [];
  const metric = (value: number | undefined, name: string, warn: number, critical: number, unit: string) => {
    if (value == null || !Number.isFinite(value)) return;
    if (value >= critical) red.push(`${name} ${value.toFixed(1)}${unit}`);
    else if (value >= warn) yellow.push(`${name} ${value.toFixed(1)}${unit}`);
  };
  metric(node.load?.processCpuPercent, '进程 CPU', 75, 90, '%');
  metric(node.load?.heapUsagePercent, '堆使用率', 75, 90, '%');
  metric(node.jvm?.monitor?.interval?.gcTimePercent, 'GC 时间占比', 5, 15, '%');
  metric(node.latencyMs, '诊断延迟', 500, 1500, ' ms');
  metric(node.jvm?.monitor?.sampleAgeMs == null ? undefined : node.jvm.monitor.sampleAgeMs / 1000, '采样延迟', 90, 180, ' 秒');
  if (red.length) return { color: 'red', label: '异常', reasons: red };
  if (yellow.length) return { color: 'gold', label: '关注', reasons: yellow };
  return { color: 'green', label: '正常', reasons: ['当前快照未触发阈值'] };
}

function formatBytes(bytes?: number): string {
  if (bytes == null || !Number.isFinite(bytes)) return '-';
  return `${(bytes / 1073741824).toFixed(2)} GiB`;
}

function formatTime(epochMs?: number): string {
  return epochMs ? new Date(epochMs).toLocaleString() : '-';
}

export default function BackendNodePage() {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [changing, setChanging] = useState('');
  const [selectedNode, setSelectedNode] = useState('');

  const load = async () => {
    setLoading(true);
    try { setData(await api.adminBackendNodes()); }
    catch (error: any) { setData(null); message.error(error?.response?.data?.detail || '加载节点状态失败'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

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
  const detail = data?.nodes?.find((node) => node.node === selectedNode);
  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Card title="后端节点维护" extra={<Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新状态</Button>}>
      <Alert type="info" showIcon message="状态灯反映当前诊断快照，每 30 秒自动刷新；节点上下线会影响请求和 WebSocket 连接。" style={{ marginBottom: 16 }} />
      <Space size={32} wrap>
        <Statistic title="注册节点" value={summary.registeredNodes ?? '-'} />
        <Statistic title="可达节点" value={summary.reachableNodes ?? '-'} />
        <Statistic title="就绪节点" value={summary.readyNodes ?? '-'} />
        <Statistic title="下线中" value={summary.drainingNodes ?? '-'} />
        <Statistic title="WebSocket 连接" value={summary.websocketConnections ?? '-'} />
      </Space>
      <Descriptions size="small" style={{ marginTop: 20 }} items={[
        { key: 'status', label: '集群状态', children: <Tag color={data?.status === 'UP' ? 'green' : data?.status === 'DEGRADED' ? 'gold' : 'red'}>{data?.status || '-'}</Tag> },
        { key: 'time', label: '诊断时间', children: data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : '-' },
        { key: 'request', label: '响应节点', children: data?.requestNode || '-' },
        { key: 'redis', label: 'Redis', children: data?.dependencies?.redis?.status || '-' },
        { key: 'mysql', label: 'MySQL', children: data?.dependencies?.mysql?.status || '-' },
      ]} />
      {data?.alerts?.length ? <Alert type="warning" showIcon message="集群告警" description={data.alerts.map((alert, index) => <div key={index}>{alertText(alert)}</div>)} style={{ marginTop: 12 }} /> : null}
    </Card>
    <Card title="节点列表">
      <Table<Node> rowKey="node" loading={loading} dataSource={data?.nodes || []} pagination={false} scroll={{ x: 1250 }} columns={[
        { title: '节点', dataIndex: 'node', width: 190, render: (value: string, row: Node) => <Space><Typography.Text copyable>{value}</Typography.Text>{row.requestNode && <Tag>当前响应</Tag>}</Space> },
        { title: '健康', width: 170, render: (_: unknown, row: Node) => {
          const health = nodeHealth(row);
          return <Space size={4} direction="vertical"><Tag color={health.color}>{health.label}</Tag><Typography.Text type="secondary" style={{ fontSize: 12 }}>{health.reasons.join('；')}</Typography.Text></Space>;
        } },
        { title: '连接状态', width: 105, render: (_: unknown, row: Node) => <Tag color={row.reachable ? 'green' : 'red'}>{row.reachable ? '可达' : '不可达'}</Tag> },
        { title: '服务状态', width: 110, render: (_: unknown, row: Node) => <Tag color={row.draining ? 'orange' : row.ready ? 'green' : 'red'}>{row.draining ? '已下线' : row.ready ? '就绪' : '未就绪'}</Tag> },
        { title: '运行时长', width: 125, render: (_: unknown, row: Node) => formatUptime(row.jvm?.uptimeSeconds) },
        { title: 'HTTP 请求', dataIndex: 'activeHttpRequests', width: 105 },
        { title: 'WebSocket', width: 110, render: (_: unknown, row: Node) => row.longConnections?.websocket ?? '-' },
        { title: '进程 CPU', width: 100, render: (_: unknown, row: Node) => row.load?.processCpuPercent == null ? '-' : `${row.load.processCpuPercent}%` },
        { title: '堆使用率', width: 100, render: (_: unknown, row: Node) => row.load?.heapUsagePercent == null ? '-' : `${row.load.heapUsagePercent}%` },
        { title: '延迟', dataIndex: 'latencyMs', width: 85, render: (value?: number) => value == null ? '-' : `${value} ms` },
        { title: '操作', width: 155, fixed: 'right', render: (_: unknown, row: Node) => <Space size={0}>
          <Button type="link" onClick={() => setSelectedNode(row.node)}>详情</Button>
          {row.draining
            ? <Button type="link" loading={changing === row.node} disabled={!!changing} onClick={() => change(row, 'stop')}>上线</Button>
            : <Button type="link" danger loading={changing === row.node} disabled={!!changing || !row.reachable} onClick={() => change(row, 'start')}>下线</Button>}
        </Space> },
      ]} />
    </Card>
    <Modal title={`节点详情 ${selectedNode}`} open={!!detail} onCancel={() => setSelectedNode('')} footer={null} width={1000}>
      {detail && <Space direction="vertical" size={18} style={{ width: '100%' }}>
        <Alert type={nodeHealth(detail).color === 'red' ? 'error' : nodeHealth(detail).color === 'gold' ? 'warning' : 'success'} showIcon
          message={`${nodeHealth(detail).label}：${nodeHealth(detail).reasons.join('；')}`} />
        <Card size="small" title="节点与连接">
          <Descriptions column={2} size="small" items={[
            { key: 'node', label: '节点', children: detail.node },
            { key: 'uptime', label: 'JVM 运行时长', children: formatUptime(detail.jvm?.uptimeSeconds) },
            { key: 'reachable', label: '可达 / 就绪 / 下线中', children: `${detail.reachable ? '是' : '否'} / ${detail.ready ? '是' : '否'} / ${detail.draining ? '是' : '否'}` },
            { key: 'latency', label: '诊断延迟', children: detail.latencyMs == null ? '-' : `${detail.latencyMs} ms` },
            { key: 'http', label: '活动 HTTP 请求', children: detail.activeHttpRequests ?? '-' },
            { key: 'ws', label: 'WebSocket 连接', children: detail.longConnections?.websocket ?? '-' },
            { key: 'msgs', label: '每秒收到 WebSocket 消息', children: detail.load?.websocketMessages?.receivedLastSecond ?? '-' },
          ]} />
        </Card>
        <Card size="small" title="CPU、内存与线程">
          <Descriptions column={2} size="small" items={[
            { key: 'cpu', label: '进程 CPU', children: detail.load?.processCpuPercent == null ? '-' : `${detail.load.processCpuPercent}%` },
            { key: 'system-cpu', label: '系统 CPU', children: detail.load?.systemCpuPercent == null ? '-' : `${detail.load.systemCpuPercent}%` },
            { key: 'heap', label: 'JVM 堆使用率', children: detail.load?.heapUsagePercent == null ? '-' : `${detail.load.heapUsagePercent}%` },
            { key: 'heap-bytes', label: '堆已用 / 最大', children: `${formatBytes(detail.jvm?.heapUsedBytes)} / ${formatBytes(detail.jvm?.heapMaxBytes)}` },
            { key: 'rss', label: '进程 RSS', children: formatBytes(detail.jvm?.monitor?.os?.processRssBytes) },
            { key: 'rss-peak', label: '进程 RSS 峰值', children: formatBytes(detail.jvm?.monitor?.os?.processRssPeakBytes) },
            { key: 'available', label: '主机可用内存', children: formatBytes(detail.jvm?.monitor?.os?.memAvailableBytes) },
            { key: 'threads', label: '线程 / 阻塞线程', children: `${detail.jvm?.threadCount ?? '-'} / ${detail.jvm?.blockedThreadCount ?? '-'}` },
          ]} />
          <Typography.Text type="secondary">进程内存和主机内存来自 OS /proc 视图，不代表容器内存限制。</Typography.Text>
        </Card>
        <Card size="small" title="GC 与采样">
          <Descriptions column={2} size="small" items={[
            { key: 'sampled', label: '上次采样', children: formatTime(detail.jvm?.monitor?.sampledAtEpochMs) },
            { key: 'age', label: '采样距今', children: detail.jvm?.monitor?.sampleAgeMs == null ? '-' : `${Math.round(detail.jvm.monitor.sampleAgeMs / 1000)} 秒` },
            { key: 'interval', label: '采样区间', children: detail.jvm?.monitor?.interval?.elapsedMs == null ? '-' : `${Math.round(detail.jvm.monitor.interval.elapsedMs / 1000)} 秒` },
            { key: 'gc', label: 'GC 时间占比', children: detail.jvm?.monitor?.interval?.gcTimePercent == null ? '-' : `${detail.jvm.monitor.interval.gcTimePercent.toFixed(2)}%` },
            { key: 'gc-count', label: '区间 GC 次数', children: detail.jvm?.monitor?.interval?.gcCountDelta ?? '-' },
            { key: 'failures', label: '累计采样失败', children: detail.jvm?.monitor?.failedSamples ?? '-' },
            { key: 'peak-coverage', label: '近期峰值覆盖时长', children: detail.jvm?.monitor?.recentPeaks?.coverageMillis == null ? '-' : formatUptime(detail.jvm.monitor.recentPeaks.coverageMillis / 1000) },
            { key: 'peak-heap', label: '近期堆使用峰值', children: formatBytes(detail.jvm?.monitor?.recentPeaks?.heapUsedBytes) },
          ]} />
          <Typography.Text type="secondary">GC 时间占比为采样区间估算值，并非精确停顿比例；近期峰值随 JVM 重启清空。</Typography.Text>
          {detail.jvm?.monitor?.collectors?.length ? <Table size="small" rowKey="name" pagination={false} style={{ marginTop: 12 }} dataSource={detail.jvm.monitor.collectors} columns={[
            { title: '收集器', dataIndex: 'name' }, { title: '累计次数', dataIndex: 'count' }, { title: '累计时间', dataIndex: 'timeMs', render: (value?: number) => value == null ? '-' : `${value} ms` },
            { title: '最近一次耗时', render: (_: unknown, row) => row.lastCollection?.durationMs == null ? '-' : `${row.lastCollection.durationMs} ms` },
          ]} /> : null}
        </Card>
        {detail.jvm?.monitor?.memoryPools?.length ? <Card size="small" title="JVM 内存池">
          <Table size="small" rowKey="name" pagination={false} scroll={{ x: 650 }} dataSource={detail.jvm.monitor.memoryPools} columns={[
            { title: '内存池', dataIndex: 'name' }, { title: '类型', dataIndex: 'type', width: 110 },
            { title: '已用', width: 125, render: (_: unknown, row) => formatBytes(row.usage?.usedBytes) },
            { title: '已提交', width: 125, render: (_: unknown, row) => formatBytes(row.usage?.committedBytes) },
            { title: '最大', width: 125, render: (_: unknown, row) => formatBytes(row.usage?.maxBytes) },
          ]} />
        </Card> : null}
      </Space>}
    </Modal>
  </Space>;
}
