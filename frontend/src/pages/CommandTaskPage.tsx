import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { DeleteOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { Robot } from '../types';
import { getLastSelectedRobotId, maskRobotIdForDisplay, setLastSelectedRobotId } from '../robotSelection';
import HoverPreviewText from '../components/HoverPreviewText';
import { commandContent } from '../commandContent';

type TaskStatus = 'pending' | 'success' | 'failed' | 'terminated';

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
  isClearPendingQueue?: boolean;
  isCancelPendingCommand?: boolean;
  cancelledMessageIds?: string[];
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
  success?: boolean | number;
  errorReason?: string;
  runTime?: string;
  createTime?: string;
  timeCost?: number;
  costTimes?: number;
  type?: number;
  successList?: string;
  failList?: string;
}

type ResultStatusFilter = 'all' | 'success' | 'failed';

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

function parseTypeList(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((x) => Number(x)).filter((x) => Number.isFinite(x));
  }
  const raw = String(value || '').trim();
  if (!raw) return [];
  const parsed = safeParseJson(raw);
  if (Array.isArray(parsed)) {
    return parsed.map((x) => Number(x)).filter((x) => Number.isFinite(x));
  }
  return raw
    .split(',')
    .map((x) => Number(String(x || '').trim()))
    .filter((x) => Number.isFinite(x));
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


function resultRunTime(row?: RawResultRecord): string {
  return String(row?.runTime || row?.createTime || '').trim();
}

function resultTimeCost(row?: RawResultRecord): number | undefined {
  const raw = row?.timeCost ?? row?.costTimes;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function resultStatus(row?: RawResultRecord): TaskStatus | null {
  if (!row) return null;
  if (row.rawSuccess !== undefined && row.rawSuccess !== null) {
    return Number(row.rawSuccess) === 0 ? 'success' : 'failed';
  }
  if (row.success !== undefined && row.success !== null) {
    return Boolean(row.success) ? 'success' : 'failed';
  }
  return 'failed';
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
    const t1 = parseDateTimeMs(resultRunTime(current));
    const t2 = parseDateTimeMs(resultRunTime(row));
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
    const typeList = parseTypeList(row?.typeList);
    const firstType = Number(firstMsg?.type);
    const isClearPendingQueue = typeList.includes(304) || firstType === 304;
    const isCancelPendingCommand = typeList.includes(305) || firstType === 305;
    const cancelledMessageIds = isCancelPendingCommand
      ? String(firstMsg?.originalContent || '')
        .split(',')
        .map((item: string) => item.trim())
        .filter(Boolean)
      : [];
    const titleList = Array.isArray(firstMsg?.titleList) ? firstMsg.titleList : [];
    const content = commandContent(row.body);
    const result = resultMap.get(messageId);
    let status: TaskStatus = 'pending';
    const resolvedStatus = resultStatus(result);
    if (resolvedStatus) status = resolvedStatus;

    const successList = parseTargets(result?.successList);
    const failList = parseTargets(result?.failList);
    const mergedTargets = successList.length > 0 || failList.length > 0
      ? Array.from(new Set([...successList, ...failList]))
      : titleList.map((x: any) => String(x || '').trim()).filter(Boolean);

    merged.push({
      key: messageId,
      messageId,
      createTime: String(row?.createTime || ''),
      runTime: resultRunTime(result),
      robotId: String(row?.robotId || ''),
      type: result?.type ?? (firstMsg?.type ?? undefined),
      ip: String(row?.ip || ''),
      targetsText: mergedTargets.length ? mergedTargets.join('、') : '-',
      content: content || '-',
      status,
      timeCost: resultTimeCost(result),
      errorReason: String(result?.errorReason || '').trim() || undefined,
      isClearPendingQueue,
      isCancelPendingCommand,
      cancelledMessageIds,
    });
  }

  // A 305 carries the original message IDs it removed from the pending queue.
  // Mark the original commands, never the 305 control command itself.
  const cancelledBy305 = new Set<string>();
  for (const row of merged) {
    for (const messageId of row.cancelledMessageIds || []) {
      cancelledBy305.add(messageId);
    }
  }
  for (const row of merged) {
    if (row.status === 'pending' && cancelledBy305.has(row.messageId)) {
      row.status = 'terminated';
      row.errorReason = '已取消待执行任务(305)';
    }
  }

  // Commands are already ordered by create_time desc (newest -> oldest).
  // Once a 304 appears, all older pending user commands are considered terminated.
  // Both 304 and 305 are queue control records and must not be shown as terminated tasks.
  let seenClearPendingQueue = false;
  for (const row of merged) {
    if (row.isClearPendingQueue) {
      if (row.status === 'pending') row.status = 'success';
      seenClearPendingQueue = true;
      continue;
    }
    if (seenClearPendingQueue && !row.isCancelPendingCommand && row.status === 'pending') {
      row.status = 'terminated';
      if (!row.errorReason) {
        row.errorReason = '客户端已清空待执行任务队列(304)';
      }
    }
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
  const [resultStatusFilter, setResultStatusFilter] = useState<ResultStatusFilter>('all');
  const [resultPage, setResultPage] = useState(1);
  const [resultTotal, setResultTotal] = useState(0);
  const [queryVersion, setQueryVersion] = useState(0);
  const [backlogWarning, setBacklogWarning] = useState<BacklogWarningState | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [cancelling, setCancelling] = useState(false);
  const backlogNoticeKeyRef = useRef('');
  const loadRequestIdRef = useRef(0);
  const activeSelectionRef = useRef<{ robotId?: string; status: ResultStatusFilter }>({ robotId, status: 'all' });

  const selectRobot = (nextRobotId?: string) => {
    activeSelectionRef.current = { robotId: nextRobotId, status: resultStatusFilter };
    loadRequestIdRef.current += 1;
    setResultPage(1);
    setRobotId(nextRobotId);
    setLastSelectedRobotId(nextRobotId);
  };

  const selectResultStatus = (status: ResultStatusFilter) => {
    activeSelectionRef.current = { robotId, status };
    loadRequestIdRef.current += 1;
    setResultPage(1);
    setResultStatusFilter(status);
  };

  const robotOptions = useMemo(
    () => robots.map((r) => ({ label: r.name ? `${r.name} (${maskRobotIdForDisplay(r.robot_id)})` : maskRobotIdForDisplay(r.robot_id), value: r.robot_id })),
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
    const requestedRobotId = robotId;
    const requestedStatus = resultStatusFilter;
    const requestedPage = resultPage;
    const activeSelection = activeSelectionRef.current;
    if (requestedRobotId !== activeSelection.robotId || requestedStatus !== activeSelection.status) return;
    const requestId = ++loadRequestIdRef.current;
    if (!requestedRobotId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const mid = messageIdFilter.trim();
      const response = await api.getWorktoolCommandTasks({
        robot_id: requestedRobotId,
        page: requestedPage,
        size: requestedStatus === 'all' ? 30 : 100,
        status: requestedStatus,
        message_id: mid || undefined,
      });
      const commandRows = response.items.map((item: { command: RawCommandRecord }) => item.command);
      const resultRows = response.items.flatMap((item: { result: RawResultRecord | null }) => item.result ? [item.result] : []);
      const latestSelection = activeSelectionRef.current;
      if (
        requestId !== loadRequestIdRef.current
        || requestedRobotId !== latestSelection.robotId
        || requestedStatus !== latestSelection.status
      ) return;
      const mergedRows = mergeRows(commandRows, resultRows);
      setRows(mergedRows);
      setResultTotal(response.total);
      setSelectedRowKeys((keys) => keys.filter((key) => mergedRows.some((row) => row.key === key && row.status === 'pending')));
      setLastUpdatedAt(new Date().toLocaleString());

      const midForQuery = mid;
      if (!midForQuery && requestedStatus === 'all' && requestedPage === 1) {
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
          const noticeKey = `${requestedRobotId}|${oldestPendingTime}|${overduePendingRows.length}`;
          if (noticeKey && backlogNoticeKeyRef.current !== noticeKey) {
            backlogNoticeKeyRef.current = noticeKey;
            void api.noticeWorktoolCommandBacklog({
              robot_id: requestedRobotId,
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
      const latestSelection = activeSelectionRef.current;
      if (
        requestId !== loadRequestIdRef.current
        || requestedRobotId !== latestSelection.robotId
        || requestedStatus !== latestSelection.status
      ) return;
      message.error(e?.response?.data?.detail || '拉取指令任务失败');
      setRows([]);
      setResultTotal(0);
      setBacklogWarning(null);
    } finally {
      if (requestId === loadRequestIdRef.current) setLoading(false);
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
  }, [robotId, messageIdFilter, resultStatusFilter, resultPage, queryVersion]);

  useEffect(() => {
    if (!robotId) return;
    if (resultStatusFilter !== 'all') return;
    // A terminated state is inferred from a 304/305 queue-control record. Keep
    // checking it because a client can finish and report success/failure first.
    const hasUnresolved = rows.some((x) => x.status === 'pending' || x.status === 'terminated');
    if (!hasUnresolved) return;
    const timer = window.setInterval(() => {
      void loadRows();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [robotId, rows, messageIdFilter, resultStatusFilter, resultPage]);

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
          if (v === 'terminated') return <Tag color="default">终止执行</Tag>;
          return <Tag color="processing">待执行</Tag>;
        },
      },
      { title: '发起时间', dataIndex: 'createTime', key: 'createTime', width: 180 },
      { title: '执行时间', dataIndex: 'runTime', key: 'runTime', width: 180, render: (v: string) => v || '-' },
      { title: '消息ID', dataIndex: 'messageId', key: 'messageId', width: 220, render: (v: string) => <HoverPreviewText value={v} maxWidth={200} popupWidth={760} /> },
      { title: '接收对象', dataIndex: 'targetsText', key: 'targetsText', width: 180, render: (v: string) => <HoverPreviewText value={v} maxWidth={160} /> },
      {
        title: '指令内容',
        dataIndex: 'content',
        key: 'content',
        render: (v: string) => <HoverPreviewText value={v} maxWidth={500} popupWidth={780} />,
      },
      { title: '耗时(秒)', dataIndex: 'timeCost', key: 'timeCost', width: 100, render: (v?: number) => (v == null ? '-' : Number(v).toFixed(3)) },
      { title: '失败原因', dataIndex: 'errorReason', key: 'errorReason', width: 220, render: (v?: string) => <HoverPreviewText value={v} maxWidth={200} /> },
      { title: '类型', dataIndex: 'type', key: 'type', width: 90, render: (v?: number) => (v == null ? '-' : v) },
      { title: '来源IP', dataIndex: 'ip', key: 'ip', width: 140, render: (v?: string) => <HoverPreviewText value={v} maxWidth={120} /> },
    ],
    []
  );

  const pendingCount = rows.filter((x) => x.status === 'pending').length;
  const selectedPendingRows = rows.filter((row) => row.status === 'pending' && selectedRowKeys.includes(row.key));

  const runMessageIdQuery = () => {
    setResultPage(1);
    setMessageIdFilter(messageIdInput.trim());
    setQueryVersion((version) => version + 1);
  };

  const formatSkipped = (skipped: Array<{ message_id?: string; reason?: string }> = []) => {
    if (!skipped.length) return '';
    return `，跳过 ${skipped.length} 条（${skipped.map((item) => `${item.message_id || '-'}：${item.reason || '状态已变化'}`).join('；')}）`;
  };

  const cancelSelected = () => {
    if (!robotId || selectedPendingRows.length === 0) return;
    Modal.confirm({
      title: `取消 ${selectedPendingRows.length} 条待执行指令？`,
      content: '提交前会重新检查每条指令的执行状态。已经开始执行或已有结果的指令将自动跳过，不会取消。',
      okText: '确认取消',
      okButtonProps: { danger: true },
      cancelText: '暂不取消',
      onOk: async () => {
        setCancelling(true);
        try {
          const result = await api.cancelWorktoolPendingCommands({ robot_id: robotId, message_ids: selectedPendingRows.map((row) => row.messageId) });
          message.success(`已下发取消：${result.cancelled_count || 0} 条${formatSkipped(result.skipped)}`, 8);
          setSelectedRowKeys([]);
          await loadRows();
        } catch (e: any) {
          message.error(e?.response?.data?.detail || '取消待执行指令失败');
        } finally {
          setCancelling(false);
        }
      },
    });
  };

  const clearAllPending = () => {
    if (!robotId || pendingCount === 0) return;
    Modal.confirm({
      title: `取消全部待执行指令？`,
      content: `将取消该机器人客户端队列中的全部待执行指令。当前列表显示 ${pendingCount} 条待执行；提交前会再次检查，若均已开始执行则不会下发取消。`,
      okText: '确认取消全部',
      okButtonProps: { danger: true },
      cancelText: '暂不取消',
      onOk: async () => {
        setCancelling(true);
        try {
          const result = await api.clearWorktoolPendingCommands({ robot_id: robotId, message_ids: rows.filter((row) => row.status === 'pending').map((row) => row.messageId) });
          if (result.clear_sent) {
            message.success(`已下发取消全部指令；提交前确认 ${result.pending_count_before_clear || 0} 条仍待执行${formatSkipped(result.skipped)}`, 8);
          } else {
            message.info(`未下发取消：所选范围内指令状态均已变化${formatSkipped(result.skipped)}`, 8);
          }
          setSelectedRowKeys([]);
          await loadRows();
        } catch (e: any) {
          message.error(e?.response?.data?.detail || '清空待执行指令失败');
        } finally {
          setCancelling(false);
        }
      },
    });
  };

  return (
    <Card
      title={(
        <Space direction="vertical" size={0}>
          <span>指令任务查询</span>
          <Typography.Text type="secondary">仅查询最近2天、最新2000条下发指令范围内的数据（含 messageId 查询）；全部每页30条，成功/失败每页100条</Typography.Text>
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
        <Select<ResultStatusFilter>
          style={{ width: 150 }}
          value={resultStatusFilter}
          onChange={selectResultStatus}
          options={[
            { label: '全部', value: 'all' },
            { label: '执行成功', value: 'success' },
            { label: '执行失败', value: 'failed' },
          ]}
        />
        <Button
          icon={<StopOutlined />}
          danger
          disabled={selectedPendingRows.length === 0}
          loading={cancelling}
          onClick={cancelSelected}
        >
          取消选中{selectedPendingRows.length ? ` (${selectedPendingRows.length})` : ''}
        </Button>
        <Button
          icon={<DeleteOutlined />}
          danger
          disabled={pendingCount === 0}
          loading={cancelling}
          onClick={clearAllPending}
        >
          取消全部
        </Button>
        <Input
          style={{ width: 260 }}
          placeholder="按 messageId 精准查询"
          value={messageIdInput}
          onChange={(e) => setMessageIdInput(e.target.value)}
          onPressEnter={runMessageIdQuery}
          allowClear
        />
        <Button onClick={runMessageIdQuery}>查询</Button>
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
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
            getCheckboxProps: (row: CommandTaskRow) => ({ disabled: row.status !== 'pending' }),
          }}
          pagination={!messageIdFilter ? {
            current: resultPage,
            pageSize: resultStatusFilter === 'all' ? 30 : 100,
            total: resultTotal,
            showSizeChanger: false,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (page) => {
              loadRequestIdRef.current += 1;
              setResultPage(page);
            },
          } : false}
          scroll={{ x: 1600 }}
          size="small"
        />
      )}
    </Card>
  );
}
