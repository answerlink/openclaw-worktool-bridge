import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Input, Select, Space, Table, Tag, Typography, message } from 'antd';
import { ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { Robot } from '../types';
import { getLastSelectedRobotId, maskRobotIdForDisplay, setLastSelectedRobotId } from '../robotSelection';
import HoverPreviewText from '../components/HoverPreviewText';

interface GroupRow {
  group_name: string;
  master_name: string;
  msg_insert_time: string;
  msg_num: number | null;
  members_num: number | null;
  group_announcement: string;
  level: number | null;
  source_create_time: string;
  source_update_time: string;
  synced_at: string;
}

export default function GroupListPage() {
  const [robots, setRobots] = useState<Robot[]>([]);
  const [robotsLoaded, setRobotsLoaded] = useState(false);
  const [robotId, setRobotId] = useState<string | undefined>(() => getLastSelectedRobotId());
  const [keyword, setKeyword] = useState('');
  const [rows, setRows] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [latestSyncAt, setLatestSyncAt] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);

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
      setRobots(items || []);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '加载机器人失败');
      setRobots([]);
    } finally {
      setRobotsLoaded(true);
    }
  };

  const load = async (nextPage = page, nextPageSize = pageSize) => {
    if (!robotId) return;
    setLoading(true);
    try {
      const res = await api.listGroups({
        robot_id: robotId,
        keyword: keyword.trim() || undefined,
        page: nextPage,
        page_size: nextPageSize,
      });
      setRows((res?.items || []) as GroupRow[]);
      setTotal(Number(res?.total || 0));
      setPage(Number(res?.page || nextPage));
      setPageSize(Number(res?.page_size || nextPageSize));
      setLatestSyncAt(String(res?.latest_sync_at || ''));
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '加载群列表失败');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  const syncNow = async () => {
    if (!robotId) {
      message.warning('请先选择机器人');
      return;
    }
    setSyncing(true);
    try {
      const res = await api.syncGroups(robotId);
      message.success(`同步完成，抓取 ${Number(res?.fetched || 0)} 条`);
      await load(1, pageSize);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '同步失败');
    } finally {
      setSyncing(false);
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
    void load(1, pageSize);
  }, [robotId]);

  return (
    <Card
      title="群列表"
      extra={(
        <Space>
          <Button icon={<SyncOutlined />} loading={syncing} onClick={() => void syncNow()}>
            立即同步
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => void load(page, pageSize)}>
            刷新
          </Button>
        </Space>
      )}
    >
      <Space style={{ marginBottom: 12 }}>
        <Select
          style={{ width: 360 }}
          value={robotId}
          onChange={selectRobot}
          options={robotOptions}
          placeholder="选择机器人"
          showSearch
          optionFilterProp="label"
        />
        <Input
          style={{ width: 260 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={() => void load(1, pageSize)}
          placeholder="群名 / 群主搜索"
        />
        <Button onClick={() => void load(1, pageSize)}>查询</Button>
        <Typography.Text type="secondary">最近同步：{latestSyncAt || '-'}</Typography.Text>
      </Space>
      <Table
        rowKey={(r, idx) => `${r.group_name}-${idx}`}
        loading={loading}
        dataSource={rows}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => void load(p, ps),
        }}
        scroll={{ x: 1300 }}
        columns={[
          { title: '群名', dataIndex: 'group_name', width: 220, render: (v: string) => <HoverPreviewText value={v} maxWidth={200} /> },
          { title: '群主', dataIndex: 'master_name', width: 160, render: (v: string) => <HoverPreviewText value={v} maxWidth={140} /> },
          { title: '成员数', dataIndex: 'members_num', width: 90, render: (v: number | null) => v ?? '-' },
          { title: '消息数', dataIndex: 'msg_num', width: 90, render: (v: number | null) => v ?? '-' },
          { title: '最近消息时间', dataIndex: 'msg_insert_time', width: 170, render: (v: string) => v || '-' },
          { title: '创建时间', dataIndex: 'source_create_time', width: 170, render: (v: string) => v || '-' },
          { title: '更新时间', dataIndex: 'source_update_time', width: 170, render: (v: string) => v || '-' },
          {
            title: '等级',
            dataIndex: 'level',
            width: 90,
            render: (v: number | null) => (v === null || v === undefined ? '-' : <Tag>{String(v)}</Tag>),
          },
          { title: '群公告', dataIndex: 'group_announcement', render: (v: string) => <HoverPreviewText value={v} maxWidth={360} popupWidth={780} /> },
        ]}
      />
    </Card>
  );
}
