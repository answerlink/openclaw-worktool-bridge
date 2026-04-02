import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Input, Select, Space, Table, Tag, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { Robot } from '../types';
import { getLastSelectedRobotId, setLastSelectedRobotId } from '../robotSelection';

type TaskStatus = 'pending' | 'success' | 'failed';

interface CommandTaskRow {
  key: string;
  messageId: string;
  createTime: string;
  runTime?: string;
  robotId: string;
  type?: number;
  ip?: string;
  targetsText: string;
  content: string;
  status: TaskStatus;
  timeCost?: number;
  errorReason?: string;
}

interface RawCommandRecord {
  robotId?: string;
  createTime?: string;
  typeList?: string;
  ip?: string;
  messageId?: string;
  body?: string;
}

interface RawResultRecord {
  messageId?: string;
  rawSuccess?: number;
  errorReason?: string;
  runTime?: string;
  timeCost?: number;
  type?: number;
  successList?: string;
  failList?: string;
}

interface BacklogWarningState {
  pendingOverdueCount: number;
  oldestPendingTime: string;
  newestResultTime: string;
  oldestPendingMinutes: number;
}

function safeParseJson(raw: unknown): any {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseTargets(value: unknown): string[] {
  const parsed = safeParseJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.map((x) => String(x || '').trim()).filter(Boolean);
}

function parseDateTimeMs(value: unknown): number {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const ts = Date.parse(raw);
  if (!Number.isNaN(ts)) return ts;
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const ts2 = Date.parse(normalized);
  return Number.isNaN(ts2) ? 0 : ts2;
}

function mergeRows(commandRows: RawCommandRecord[], resultRows: RawResultRecord[]): CommandTaskRow[] {
  const resultMap = new Map<string, RawResultRecord>();
  for (const row of resultRows || []) {
    const id = String(row?.messageId || '').trim();
    if (!id) continue;
    if (!resultMap.has(id)) {
      resultMap.set(id, row);
      continue;
    }
    const current = resultMap.get(id)!;
    const t1 = Date.parse(String(current.runTime || '')) || 0;
    const t2 = Date.parse(String(row.runTime || '')) || 0;
    if (t2 >= t1) {
      resultMap.set(id, row);
    }
  }

  const merged: CommandTaskRow[] = [];
  for (const row of commandRows || []) {
    const messageId = String(row?.messageId || '').trim();
    if (!messageId) continue;
    const payload = safeParseJson(row.body);
    const firstMsg = Array.isArray(payload?.list) ? payload.list[0] || {} : {};
    const titleList = Array.isArray(firstMsg?.titleList) ? firstMsg.titleList : [];
    const content = String(firstMsg?.receivedContent || '').trim();
    const result = resultMap.get(messageId);
    let status: TaskStatus = 'pending';
    if (result) {
      status = Number(result.rawSuccess) === 0 ? 'success' : 'failed';
    }

    const successList = parseTargets(result?.successList);
    const failList = parseTargets(result?.failList);
    const mergedTargets = successList.length > 0 || failList.length > 0
      ? Array.from(new Set([...successList, ...failList]))
      : titleList.map((x: any) => String(x || '').trim()).filter(Boolean);

    merged.push({
      key: messageId,
      messageId,
      createTime: String(row?.createTime || ''),
      runTime: result?.runTime,
      robotId: String(row?.robotId || ''),
      type: result?.type ?? (firstMsg?.type ?? undefined),
      ip: String(row?.ip || ''),
      targetsText: mergedTargets.length ? mergedTargets.join('、') : '-',
      content: content || '-',
      status,
      timeCost: result?.timeCost,
      errorReason: String(result?.errorReason || '').trim() || undefined,
    });
  }
  return merged;
}

export default function CommandTaskPage() {
  const [robots, setRobots] = useState<Robot[]>([]);
  const [robotsLoaded, setRobotsLoaded] = useState(false);
  const [robotId, setRobotId] = useState<string | undefined>(() => getLastSelectedRobotId());
  const [rows, setRows] = useState<CommandTaskRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState('');
  const [messageIdInput, setMessageIdInput] = useState('');
  const [messageIdFilter, setMessageIdFilter] = useState('');
  const [backlogWarning, setBacklogWarning] = useState<BacklogWarningState | null>(null);
  const backlogNoticeKeyRef = useRef('');

  const selectRobot = (nextRobotId?: string) => {
    setRobotId(nextRobotId);
    setLastSelectedRobotId(nextRobotId);
  };

  const robotOptions = useMemo(
    () => robots.map((r) => ({ label: r.name ? `${r.name} (${r.robot_id})` : r.robot_id, value: r.robot_id })),
    [robots]
  );

  const loadRobots = async () => {
    try {
      const items = await api.listRobots();
      setRobots(items);
      setRobotsLoaded(true);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '加载机器人失败');
      setRobots([]);
      setRobotsLoaded(true);
    }
  };

  const loadRows = async () => {
    if (!robotId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const mid = messageIdFilter.trim();
      const commandSize = 30;
      const resultSize = 30;
      const [commandsRes, resultsRes] = await Promise.all([
        api.getWorktoolRawCommands({ robot_id: robotId, page: 1, size: commandSize, sort: 'create_time,desc', message_id: mid || undefined }),
        api.getWorktoolRawCommandResults({ robot_id: robotId, page: 1, size: resultSize, sort: 'run_time,desc', message_id: mid || undefined }),
      ]);
      const commandRows = (commandsRes?.data?.list || []) as RawCommandRecord[];
      const resultRows = (resultsRes?.data || []) as RawResultRecord[];
      const mergedRows = mergeRows(commandRows, resultRows);
      setRows(mergedRows);
      setLastUpdatedAt(new Date().toLocaleString());

      const midForQuery = mid;
      if (!midForQuery) {
        let resultLatestTime = '';
        let resultLatestMs = 0;
        for (const row of resultRows) {
          const t = String(row?.runTime || '').trim();
          const ms = parseDateTimeMs(t);
          if (ms > resultLatestMs) {
            resultLatestMs = ms;
            resultLatestTime = t;
          }
        }

        const nowMs = Date.now();
        const overduePendingRows = mergedRows.filter((row) => {
          if (row.status !== 'pending') return false;
          const createMs = parseDateTimeMs(row.createTime);
          if (createMs <= 0) return false;
          return nowMs - createMs > 5 * 60 * 1000;
        });
        let oldestPendingTime = '';
        let oldestPendingMs = Number.MAX_SAFE_INTEGER;
        for (const row of overduePendingRows) {
          const createMs = parseDateTimeMs(row.createTime);
          if (createMs > 0 && createMs < oldestPendingMs) {
            oldestPendingMs = createMs;
            oldestPendingTime = row.createTime;
          }
        }

        if (overduePendingRows.length > 0 && oldestPendingTime) {
          const oldestPendingMinutes = Math.max((nowMs - oldestPendingMs) / 60000, 0);
          const warningState = {
            pendingOverdueCount: overduePendingRows.length,
            oldestPendingTime,
            newestResultTime: resultLatestTime || '-',
            oldestPendingMinutes,
          };
          setBacklogWarning(warningState);
          const noticeKey = `${robotId}|${oldestPendingTime}|${overduePendingRows.length}`;
          if (noticeKey && backlogNoticeKeyRef.current !== noticeKey) {
            backlogNoticeKeyRef.current = noticeKey;
            void api.noticeWorktoolCommandBacklog({
              robot_id: robotId,
              pending_overdue_count: overduePendingRows.length,
              oldest_pending_time: oldestPendingTime,
              newest_result_time: resultLatestTime || undefined,
            }).catch(() => {
              // ignore notice failures, do not block main list rendering
            });
          }
        } else {
          setBacklogWarning(null);
        }
      } else {
        setBacklogWarning(null);
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '拉取指令任务失败');
      setRows([]);
      setBacklogWarning(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRobots();
  }, []);

  useEffect(() => {
    if (!robotsLoaded) return;
    if (robots.length === 0) {
      selectRobot(undefined);
      return;
    }
    const exists = robotId && robots.some((x: Robot) => x.robot_id === robotId);
    if (!exists) {
      selectRobot(robots[0].robot_id);
    }
  }, [robotsLoaded, robots, robotId]);

  useEffect(() => {
    void loadRows();
  }, [robotId, messageIdFilter]);

  useEffect(() => {
    if (!robotId) return;
    const hasPending = rows.some((x) => x.status === 'pending');
    if (!hasPending) return;
    const timer = window.setInterval(() => {
      void loadRows();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [robotId, rows, messageIdFilter]);

  const columns = useMemo(
    () => [
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 110,
        render: (v: TaskStatus) => {
          if (v === 'success') return <Tag color="success">执行成功</Tag>;
          if (v === 'failed') return <Tag color="error">执行失败</Tag>;
          return <Tag color="processing">待执行</Tag>;
        },
      },
      { title: '发起时间', dataIndex: 'createTime', key: 'createTime', width: 180 },
      { title: '执行时间', dataIndex: 'runTime', key: 'runTime', width: 180, render: (v: string) => v || '-' },
      { title: '消息ID', dataIndex: 'messageId', key: 'messageId', width: 220, ellipsis: true },
      { title: '接收对象', dataIndex: 'targetsText', key: 'targetsText', width: 180, ellipsis: true },
      {
        title: '指令内容',
        dataIndex: 'content',
        key: 'content',
        ellipsis: { showTitle: false },
        render: (v: string) => <Typography.Text ellipsis={{ tooltip: v }} style={{ maxWidth: 500 }}>{v}</Typography.Text>,
      },
      { title: '耗时(秒)', dataIndex: 'timeCost', key: 'timeCost', width: 100, render: (v?: number) => (v == null ? '-' : Number(v).toFixed(3)) },
      { title: '失败原因', dataIndex: 'errorReason', key: 'errorReason', width: 220, ellipsis: true, render: (v?: string) => v || '-' },
      { title: '类型', dataIndex: 'type', key: 'type', width: 90, render: (v?: number) => (v == null ? '-' : v) },
      { title: '来源IP', dataIndex: 'ip', key: 'ip', width: 140, ellipsis: true, render: (v?: string) => v || '-' },
    ],
    []
  );

  const pendingCount = rows.filter((x) => x.status === 'pending').length;

  return (
    <Card
      title={(
        <Space direction="vertical" size={0}>
          <span>指令任务查询</span>
          <Typography.Text type="secondary">默认展示最近30条下发指令，并按 messageId 自动合并执行结果（待执行每60秒刷新）</Typography.Text>
        </Space>
      )}
      extra={(
        <Button icon={<ReloadOutlined />} onClick={() => loadRows()}>
          刷新
        </Button>
      )}
    >
      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          style={{ width: 340 }}
          value={robotId}
          onChange={selectRobot}
          options={robotOptions}
          placeholder="选择机器人"
          showSearch
          optionFilterProp="label"
        />
        <Tag color={pendingCount > 0 ? 'processing' : 'default'}>待执行: {pendingCount}</Tag>
        <Input
          style={{ width: 260 }}
          placeholder="按 messageId 精准查询"
          value={messageIdInput}
          onChange={(e) => setMessageIdInput(e.target.value)}
          onPressEnter={() => setMessageIdFilter(messageIdInput.trim())}
          allowClear
        />
        <Button onClick={() => setMessageIdFilter(messageIdInput.trim())}>查询</Button>
        <Typography.Text type="secondary">最后刷新: {lastUpdatedAt || '-'}</Typography.Text>
      </Space>

      {backlogWarning ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="检测到指令执行可能积压"
          description={(
            <span>
              超过5分钟仍待执行的指令：{backlogWarning.pendingOverdueCount} 条；
              最早待执行时间：{backlogWarning.oldestPendingTime}（约 {backlogWarning.oldestPendingMinutes.toFixed(1)} 分钟）；
              最近执行结果时间：{backlogWarning.newestResultTime}。请检查机器人在线状态、客户端网络和任务负载。
            </span>
          )}
        />
      ) : null}

      {!robotId ? (
        <Typography.Text type="secondary">请先选择机器人。</Typography.Text>
      ) : (
        <Table
          rowKey="key"
          loading={loading}
          columns={columns as any}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 1600 }}
          size="small"
        />
      )}
    </Card>
  );
}
