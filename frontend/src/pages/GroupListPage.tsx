import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
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
  const [clearingGroups, setClearingGroups] = useState(false);
  const [readingGroups, setReadingGroups] = useState(false);
  const [latestSyncAt, setLatestSyncAt] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState('');
  const loadVersion = useRef(0);
  const busy = loading || syncing || readingGroups || clearingGroups || deleting;

  const selectRobot = (nextRobotId?: string) => {
    loadVersion.current += 1;
    setRows([]);
    setSelectedNames([]);
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
    const version = ++loadVersion.current;
    setSelectedNames([]);
    setLoading(true);
    try {
      const res = await api.listGroups({
        robot_id: robotId,
        keyword: keyword.trim() || undefined,
        page: nextPage,
        page_size: nextPageSize,
      });
      if (version !== loadVersion.current) return;
      setRows((res?.items || []) as GroupRow[]);
      setTotal(Number(res?.total || 0));
      setPage(Number(res?.page || nextPage));
      setPageSize(Number(res?.page_size || nextPageSize));
      setLatestSyncAt(String(res?.latest_sync_at || ''));
    } catch (e: any) {
      if (version !== loadVersion.current) return;
      message.error(e?.response?.data?.detail || '加载群列表失败');
      setRows([]);
      setTotal(0);
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  };

  const syncNow = async () => {
    if (!robotId) {
      message.warning('请先选择机器人');
      return;
    }
    setSelectedNames([]);
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

  const readGroups = async () => {
    if (!robotId || readingGroups || syncing || clearingGroups) return;
    setReadingGroups(true);
    try {
      await api.readGroupsFromClient(robotId);
      message.success('读取指令已下发，客户端执行可能耗时较长，请勿重复下发。完成后可同步到本页查看。', 8);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '指令下发结果暂未确认，请先检查指令执行记录，避免重复操作', 8);
    } finally {
      setReadingGroups(false);
    }
  };

  const clearGroups = async () => {
    if (!robotId || clearingGroups || syncing || readingGroups) return;
    setSelectedNames([]);
    setClearingGroups(true);
    try {
      const result = await api.clearRobotGroups(robotId);
      message.success(`群列表已清空，删除 ${result.groupDeletedCount} 条记录`);
      setRows([]);
      setTotal(0);
      setLatestSyncAt('');
      setPage(1);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '清空群列表失败');
    } finally {
      setClearingGroups(false);
    }
  };

  const deleteSelected = () => {
    if (!robotId || busy || selectedNames.length === 0) return;
    const names = [...selectedNames];
    const targetRobot = robotId;
    Modal.confirm({
      title: `删除选中的 ${names.length} 个群名对应的记录？`,
      content: (
        <Space direction="vertical">
          <Typography.Text>只删除数据库中的群记录，不会退出或解散客户端群。同一机器人下的所有同名记录都会删除，实际删除条数可能大于选中数量。客户端后续上报可能重新生成记录。</Typography.Text>
          <div style={{ maxHeight: 180, overflow: 'auto', wordBreak: 'break-all' }}>{names.map((name) => <div key={name}>{name}</div>)}</div>
        </Space>
      ),
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setDeleting(true);
        let completed = 0;
        let deletedCount = 0;
        try {
          for (const name of names) {
            setDeleteProgress(`${completed + 1}/${names.length}`);
            try {
              const result = await api.deleteRobotGroup(targetRobot, name);
              deletedCount += result.deletedCount;
              completed += 1;
            } catch (e: any) {
              Modal.error({
                title: '删除已停止',
                content: `已处理 ${completed}/${names.length} 个群名，确认删除 ${deletedCount} 条记录。「${name}」：${e?.response?.data?.detail || '请求异常，结果暂未确认，请核实后再操作'}。后续 ${names.length - completed - 1} 个群名未执行。`,
              });
              break;
            }
          }
          if (completed === names.length) message.success(`已处理 ${completed} 个群名，删除 ${deletedCount} 条记录`);
          setSelectedNames([]);
          await load(1, pageSize);
        } finally {
          setDeleting(false);
          setDeleteProgress('');
        }
      },
    });
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
          <Button icon={<SyncOutlined />} disabled={busy || !robotId} loading={syncing} onClick={() => void syncNow()}>
            同步到本页
          </Button>
          <Popconfirm
            title="让客户端全量读取企微群列表？"
            description="机器人会模拟操作手机读取群列表，群越多耗时越长，建议闲时执行。通常首次全量读取一次即可，后续依靠被动更新补充，无需频繁重复执行。"
            onConfirm={readGroups}
            okText="下发读取指令"
            cancelText="取消"
            disabled={busy || !robotId}
          >
            <Button loading={readingGroups} disabled={busy || !robotId}>读取企微群列表</Button>
          </Popconfirm>
          <Popconfirm
            title="清空当前机器人的群列表？"
            description="清理 WorkTool 数据库中的群列表和本平台群列表缓存，不会退出或解散企微客户端的群，也不会清理好友列表、聊天记录或群配置。"
            onConfirm={clearGroups}
            okText="清空群列表"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            disabled={busy || !robotId}
          >
            <Button danger disabled={busy || !robotId} loading={clearingGroups}>清空群列表</Button>
          </Popconfirm>
          <Button icon={<ReloadOutlined />} disabled={busy} onClick={() => void load(page, pageSize)}>
            刷新
          </Button>
        </Space>
      )}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="全量读取建议闲时执行，通常只需执行一次"
        description="「读取企微群列表」会让机器人模拟操作手机，群越多耗时越长。后续依靠被动更新补充，无需频繁重复执行。「同步到本页」用于获取 WorkTool 已有的群列表。"
      />
      <Space style={{ marginBottom: 12 }}>
        <Select
          style={{ width: 360 }}
          disabled={busy}
          value={robotId}
          onChange={selectRobot}
          options={robotOptions}
          placeholder="选择机器人"
          showSearch
          optionFilterProp="label"
        />
        <Input
          style={{ width: 260 }}
          disabled={busy}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={() => void load(1, pageSize)}
          placeholder="群名 / 群主搜索"
        />
        <Button disabled={busy} onClick={() => void load(1, pageSize)}>查询</Button>
        <Typography.Text type="secondary">最近同步：{latestSyncAt || '-'}</Typography.Text>
      </Space>
      <Space style={{ marginBottom: 12 }}>
        <Button danger disabled={busy || !robotId || selectedNames.length === 0} loading={deleting} onClick={deleteSelected}>
          {deleting ? `删除中 ${deleteProgress}` : `删除选中（${selectedNames.length}）`}
        </Button>
        <Typography.Text type="secondary">仅选择当前页；按群名删除所有匹配记录，不会退出或解散群。</Typography.Text>
      </Space>
      <Table
        rowKey="group_name"
        rowSelection={{
          selectedRowKeys: selectedNames,
          onChange: (keys) => setSelectedNames(keys.map(String)),
          getCheckboxProps: (row: GroupRow) => ({ disabled: busy || !row.group_name.trim() }),
        }}
        loading={loading}
        dataSource={rows}
        pagination={{
          disabled: busy,
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
