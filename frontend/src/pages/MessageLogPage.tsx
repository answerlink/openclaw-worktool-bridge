import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Checkbox, Input, Popover, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import { QuestionCircleOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { Robot } from '../types';
import { getLastSelectedRobotId, maskRobotIdForDisplay, setLastSelectedRobotId } from '../robotSelection';
import HoverPreviewText from '../components/HoverPreviewText';

interface QaLogItem {
  robotId: string;
  startTime: string;
  timeCost: number;
  groupName: string;
  receivedName: string;
  roomType: number;
  textType: number;
  openThirdParty: number;
  url: string;
  rawSpoken: string;
  question: string;
  answer: string;
  providerName?: string;
  aiDecisionReply?: boolean | null;
  messageId: string;
  atMe?: boolean;
}

const COLUMN_LABEL_MAP: Record<string, string> = {
  startTime: '时间',
  robotId: '机器人',
  groupName: '群名',
  receivedName: '提问者',
  roomType: '房间类型',
  textType: '消息类型',
  atMe: '是否@',
  rawSpoken: '原始问题',
  question: '问题',
  answer: '回答',
  providerName: 'AI回复引擎',
  aiDecisionReply: 'AI判断群回复',
  timeCost: '耗时(秒)',
  messageId: 'messageId',
  url: '回调地址'
};

const roomTypeMap: Record<number, string> = {
  1: '外部群',
  2: '外部联系人',
  3: '内部群',
  4: '内部联系人'
};

const COLUMN_PREF_KEY = 'message_monitor_visible_columns_v1';
const DEFAULT_VISIBLE_COLUMNS = [
  'startTime',
  'groupName',
  'receivedName',
  'roomType',
  'textType',
  'atMe',
  'rawSpoken',
  'question',
  'answer',
  'providerName',
  'aiDecisionReply',
  'timeCost',
  'messageId',
  'url',
];
const LEGACY_DEFAULT_VISIBLE_COLUMNS = [
  'startTime',
  'robotId',
  'groupName',
  'receivedName',
  'roomType',
  'textType',
  'atMe',
  'rawSpoken',
  'question',
  'answer',
  'providerName',
  'aiDecisionReply',
  'timeCost',
  'messageId',
  'url',
];

export default function MessageLogPage() {
  const [robots, setRobots] = useState<Robot[]>([]);
  const [robotsLoaded, setRobotsLoaded] = useState(false);
  const [robotId, setRobotId] = useState<string | undefined>(() => getLastSelectedRobotId());
  const [sceneFilter, setSceneFilter] = useState<'all' | 'group' | 'private'>('all');
  const [nameKeyword, setNameKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<QaLogItem[]>([]);
  const [source, setSource] = useState<'local' | 'worktool'>('worktool');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(COLUMN_PREF_KEY);
      if (!raw) return DEFAULT_VISIBLE_COLUMNS;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const normalized = parsed.filter((x) => typeof x === 'string');
        // Migrate old default preference once: hide robotId by default.
        if (
          normalized.length === LEGACY_DEFAULT_VISIBLE_COLUMNS.length &&
          normalized.every((x: string, i: number) => x === LEGACY_DEFAULT_VISIBLE_COLUMNS[i])
        ) {
          return DEFAULT_VISIBLE_COLUMNS;
        }
        return normalized;
      }
    } catch {
      // ignore
    }
    return DEFAULT_VISIBLE_COLUMNS;
  });
  const [detectedNickname, setDetectedNickname] = useState<string>('-');

  const selectRobot = (nextRobotId?: string) => {
    setRobotId(nextRobotId);
    setLastSelectedRobotId(nextRobotId);
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

  const loadLogs = async (nextPage = page, nextPageSize = pageSize) => {
    if (!robotId) return;
    setLoading(true);
    try {
      const res = await api.getMessageMonitorLogs({
        robot_id: robotId,
        page: nextPage,
        size: nextPageSize,
        sort: 'start_time,desc',
        scene: sceneFilter,
        name: nameKeyword.trim() || undefined
      });
      const data = res?.data || {};
      const src = res?.source === 'local' ? 'local' : 'worktool';
      setSource(src);
      setLogs(data.list || []);
      setTotal(data.total || 0);
      setPage(data.pageNum || nextPage);
      setPageSize(data.pageSize || nextPageSize);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '拉取消息监控失败');
      setLogs([]);
      setTotal(0);
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
    const current = robotId;
    const exists = current && robots.some((x: Robot) => x.robot_id === current);
    if (!exists) {
      selectRobot(robots[0].robot_id);
    }
  }, [robotsLoaded, robots, robotId]);

  useEffect(() => {
    let canceled = false;
    const loadRobotNickname = async () => {
      if (!robotId) {
        setDetectedNickname('-');
        return;
      }
      try {
        const detailRes = await api.getRobotInfoDetail(robotId);
        if (!canceled) {
          const detail = detailRes?.data || detailRes || {};
          const nick = String(detail?.name || '').trim();
          setDetectedNickname(nick || '-');
        }
      } catch {
        if (!canceled) {
          setDetectedNickname('-');
        }
      }
    };
    void loadRobotNickname();
    return () => {
      canceled = true;
    };
  }, [robotId]);

  useEffect(() => {
    void loadLogs(1, pageSize);
  }, [robotId, sceneFilter]);

  useEffect(() => {
    try {
      localStorage.setItem(COLUMN_PREF_KEY, JSON.stringify(visibleColumns));
    } catch {
      // ignore
    }
  }, [visibleColumns]);

  const allColumns = useMemo(
    () => [
      { key: 'startTime', title: '时间', dataIndex: 'startTime', width: 180 },
      { key: 'robotId', title: '机器人', dataIndex: 'robotId', width: 120 },
      {
        key: 'groupName',
        title: '群名',
        dataIndex: 'groupName',
        width: 180,
        render: (v: string, row: QaLogItem) => (
          row.roomType === 2 || row.roomType === 4 ? '-' : <HoverPreviewText value={v} maxWidth={160} />
        )
      },
      { key: 'receivedName', title: '提问者', dataIndex: 'receivedName', width: 120 },
      {
        key: 'roomType',
        title: '房间类型',
        dataIndex: 'roomType',
        width: 120,
        render: (v: number) => roomTypeMap[v] || String(v)
      },
      {
        key: 'textType',
        title: '消息类型',
        dataIndex: 'textType',
        width: 100,
        render: (v: number) => <Tag>{v}</Tag>
      },
      {
        key: 'atMe',
        title: (
          <Space size={4}>
            <span>是否@</span>
            <Tooltip
              title={`识别账号昵称为：${detectedNickname}。若“是否@”显示异常，请检查企微账号“对外显示名”与昵称是否一致，可在企微APP中手动修改后重启WorkTool App。`}
            >
              <QuestionCircleOutlined style={{ color: '#8c8c8c' }} />
            </Tooltip>
          </Space>
        ),
        dataIndex: 'atMe',
        width: 100,
        render: (v: boolean | undefined) => (v === undefined ? '-' : v ? '是' : '否')
      },
      {
        key: 'rawSpoken',
        title: '原始问题',
        dataIndex: 'rawSpoken',
        width: 280,
        render: (v: string | undefined) => <HoverPreviewText value={v} maxWidth={260} />
      },
      { key: 'question', title: '问题', dataIndex: 'question', width: 280, render: (v: string) => <HoverPreviewText value={v} maxWidth={260} /> },
      {
        key: 'answer',
        title: (
          <Space size={4}>
            <span>回答</span>
            <Tooltip title="仅本平台处理回复消息时可显示回答，第三方消息回调时无法显示回答。">
              <QuestionCircleOutlined style={{ color: '#8c8c8c' }} />
            </Tooltip>
          </Space>
        ),
        dataIndex: 'answer',
        width: 280,
        render: (v: string) => <HoverPreviewText value={v} maxWidth={260} />
      },
      {
        key: 'providerName',
        title: 'AI回复引擎',
        dataIndex: 'providerName',
        width: 160,
        render: (v: string | undefined) => (v && v.trim() ? v : '-')
      },
      {
        key: 'aiDecisionReply',
        title: 'AI判断群回复',
        dataIndex: 'aiDecisionReply',
        width: 130,
        render: (v: boolean | null | undefined) => (v === null || v === undefined ? '-' : v ? '是' : '否')
      },
      {
        key: 'timeCost',
        title: '耗时(秒)',
        dataIndex: 'timeCost',
        width: 100,
        render: (v: number) => (v ?? 0).toFixed(3)
      },
      { key: 'messageId', title: 'messageId', dataIndex: 'messageId', width: 220, render: (v: string) => <HoverPreviewText value={v} maxWidth={200} popupWidth={760} /> },
      {
        key: 'url',
        title: '回调地址',
        dataIndex: 'url',
        width: 260,
        render: (v: string) => <HoverPreviewText value={v} maxWidth={240} popupWidth={760} />
      }
    ],
    [detectedNickname]
  );

  const tableColumns = useMemo(
    () => allColumns.filter((c) => visibleColumns.includes(String(c.key))),
    [allColumns, visibleColumns]
  );

  const columnOptions = useMemo(
    () => allColumns.map((c) => {
      const key = String(c.key);
      return { label: COLUMN_LABEL_MAP[key] || key, value: key };
    }),
    [allColumns]
  );

  return (
    <Card
      title={(
        <Space direction="vertical" size={0}>
          <span>消息监控（{source === 'local' ? '本平台处理记录' : 'WorkTool 回调记录'}）</span>
          <Typography.Text type="secondary">查看机器人有没有按预期读消息</Typography.Text>
        </Space>
      )}
      extra={(
        <Button icon={<ReloadOutlined />} onClick={() => loadLogs(page, pageSize)}>
          刷新
        </Button>
      )}
    >
      <Space style={{ marginBottom: 12 }}>
        <Select
          style={{ width: 340 }}
          value={robotId}
          onChange={selectRobot}
          options={robotOptions}
          placeholder="选择机器人"
          showSearch
          optionFilterProp="label"
        />
        <Select
          style={{ width: 120 }}
          value={sceneFilter}
          onChange={(v) => setSceneFilter(v as 'all' | 'group' | 'private')}
          options={[
            { label: '全部', value: 'all' },
            { label: '群聊', value: 'group' },
            { label: '私聊', value: 'private' }
          ]}
        />
        <Input
          style={{ width: 260 }}
          placeholder="聊天对象筛选（群名/提问者）"
          value={nameKeyword}
          onChange={(e) => setNameKeyword(e.target.value)}
          onPressEnter={() => loadLogs(1, pageSize)}
        />
        <Button onClick={() => loadLogs(1, pageSize)}>查询</Button>
        <Popover
          trigger="click"
          placement="bottomRight"
          content={(
            <Space direction="vertical" size={8} style={{ width: 520, maxWidth: '90vw' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                  gap: 8,
                }}
              >
                {columnOptions.map((opt) => (
                  <Checkbox
                    key={String(opt.value)}
                    checked={visibleColumns.includes(String(opt.value))}
                    onChange={(e) => {
                      const value = String(opt.value);
                      const checked = Boolean(e.target.checked);
                      let next = checked
                        ? [...visibleColumns, value]
                        : visibleColumns.filter((x) => x !== value);
                      next = allColumns.map((c) => String(c.key)).filter((k) => next.includes(k));
                      if (next.length === 0) {
                        message.warning('至少保留一列');
                        return;
                      }
                      setVisibleColumns(next);
                    }}
                  >
                    {String(opt.label)}
                  </Checkbox>
                ))}
              </div>
              <Button size="small" onClick={() => setVisibleColumns(DEFAULT_VISIBLE_COLUMNS)}>恢复默认</Button>
            </Space>
          )}
        >
          <Button icon={<SettingOutlined />}>显示列</Button>
        </Popover>
      </Space>
      <Alert
        type={source === 'local' ? 'success' : 'info'}
        showIcon
        style={{ marginBottom: 12 }}
        message={source === 'local' ? '当前展示：本平台消息监控库（包含AI回答）' : '当前展示：WorkTool 回调记录'}
        description={
          source === 'local'
            ? '检测到该机器人消息回调由本平台处理，列表中的“回答”会显示本平台实际AI回复结果。'
            : '该机器人消息回调未走本平台处理，系统将展示 WorkTool 原始回调记录；该类消息不会计入本平台本地统计。'
        }
      />

      <Table
        rowKey={(r, idx) => `${r.messageId || 'no-id'}-${r.startTime}-${idx}`}
        loading={loading}
        dataSource={logs}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => {
            void loadLogs(p, ps);
          }
        }}
        columns={tableColumns}
        scroll={{ x: 2200 }}
      />
    </Card>
  );
}
