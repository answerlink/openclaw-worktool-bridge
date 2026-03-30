import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Drawer, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import { api } from '../api';
import type { Robot } from '../types';
import { getLastSelectedRobotId, setLastSelectedRobotId } from '../robotSelection';

interface TaskRow {
  id: number;
  robot_id: string;
  name: string;
  action: string;
  payload_json: Record<string, any>;
  schedule_type: 'once' | 'daily' | 'weekly' | 'cron';
  timezone: string;
  run_at: string;
  daily_time: string;
  weekly_days: string;
  cron_expr: string;
  misfire_policy: 'skip' | 'fire_once';
  status: 'draft' | 'enabled' | 'paused' | 'disabled';
  next_run_at: string;
  last_run_at: string;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: number;
  planned_at: string;
  started_at: string;
  finished_at: string;
  status: string;
  attempt: number;
  error_text: string;
  created_at: string;
}

function actionLabel(v: string) {
  const m: Record<string, string> = {
    send_text: '发送消息',
    send_file: '发送文件',
    create_external_group: '创建外部群',
    update_group: '修改群信息',
    dissolve_group: '解散群',
    add_friend_by_phone: '按手机号加好友',
  };
  return m[v] || v;
}

function scheduleLabel(row: TaskRow) {
  if (row.schedule_type === 'once') return `一次性 ${row.run_at || '-'}`;
  if (row.schedule_type === 'daily') return `每天 ${row.daily_time || '-'}`;
  if (row.schedule_type === 'weekly') return `每周[${row.weekly_days || '-'}] ${row.daily_time || '-'}`;
  return `Cron ${row.cron_expr || '-'}`;
}

export default function ScheduledTaskPage() {
  const [robots, setRobots] = useState<Robot[]>([]);
  const [robotId, setRobotId] = useState<string | undefined>(() => getLastSelectedRobotId());
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const [runsOpen, setRunsOpen] = useState(false);
  const [runRows, setRunRows] = useState<RunRow[]>([]);
  const [runLoading, setRunLoading] = useState(false);
  const [currentTask, setCurrentTask] = useState<TaskRow | null>(null);

  const robotOptions = useMemo(
    () => robots.map((r) => ({ label: r.name ? `${r.name} (${r.robot_id})` : r.robot_id, value: r.robot_id })),
    [robots]
  );

  const loadRobots = async () => {
    try {
      const list = await api.listRobots();
      setRobots(list || []);
      if (!robotId && list?.length) {
        setRobotId(list[0].robot_id);
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '加载机器人失败');
      setRobots([]);
    }
  };

  const loadTasks = async (rid?: string) => {
    const nextRid = (rid || robotId || '').trim();
    if (!nextRid) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const res = await api.listScheduledTasks(nextRid);
      setRows((res?.items || []) as TaskRow[]);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '加载定时任务失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    if (!robotId) return message.warning('请先选择机器人');
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      robot_id: robotId,
      name: '',
      action: 'send_text',
      payload_json_text: '{\n  "target_names": [],\n  "tag_ids": [],\n  "content": ""\n}',
      schedule_type: 'once',
      timezone: 'Asia/Shanghai',
      misfire_policy: 'skip',
      status: 'draft',
    });
    setModalOpen(true);
  };

  const openEdit = (row: TaskRow) => {
    setEditing(row);
    form.setFieldsValue({
      robot_id: row.robot_id,
      name: row.name,
      action: row.action,
      payload_json_text: JSON.stringify(row.payload_json || {}, null, 2),
      schedule_type: row.schedule_type,
      timezone: row.timezone || 'Asia/Shanghai',
      run_at: row.run_at,
      daily_time: row.daily_time,
      weekly_days_text: row.weekly_days,
      cron_expr: row.cron_expr,
      misfire_policy: row.misfire_policy,
      status: row.status,
    });
    setModalOpen(true);
  };

  const submit = async () => {
    const v = await form.validateFields();
    const rid = String(v.robot_id || '').trim();
    if (!rid) return message.warning('robot_id 不能为空');

    let payloadJson = {};
    try {
      payloadJson = JSON.parse(String(v.payload_json_text || '{}'));
    } catch {
      return message.error('payload_json 不是有效 JSON');
    }

    const weeklyDays = String(v.weekly_days_text || '')
      .split(',')
      .map((x: string) => Number(x.trim()))
      .filter((x: number) => Number.isInteger(x) && x >= 1 && x <= 7);

    const payload = {
      robot_id: rid,
      name: String(v.name || '').trim(),
      action: v.action,
      payload_json: payloadJson,
      schedule_type: v.schedule_type,
      timezone: String(v.timezone || 'Asia/Shanghai').trim() || 'Asia/Shanghai',
      run_at: v.run_at || undefined,
      daily_time: v.daily_time || undefined,
      weekly_days: weeklyDays,
      cron_expr: v.cron_expr || undefined,
      misfire_policy: v.misfire_policy,
      status: v.status,
    };

    setSaving(true);
    try {
      if (editing) {
        await api.updateScheduledTask(editing.id, payload);
        message.success('定时任务已更新');
      } else {
        await api.createScheduledTask(payload);
        message.success('定时任务已创建');
      }
      setModalOpen(false);
      await loadTasks(rid);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (row: TaskRow) => {
    try {
      await api.deleteScheduledTask(row.id);
      message.success('已删除');
      await loadTasks();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '删除失败');
    }
  };

  const onToggle = async (row: TaskRow, enable: boolean) => {
    try {
      if (enable) {
        await api.enableScheduledTask(row.id);
      } else {
        await api.pauseScheduledTask(row.id);
      }
      message.success(enable ? '已启用' : '已暂停');
      await loadTasks();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '操作失败');
    }
  };

  const onRunNow = async (row: TaskRow) => {
    try {
      await api.runScheduledTaskNow(row.id);
      message.success('已触发执行');
      await loadTasks();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '触发失败');
    }
  };

  const openRuns = async (row: TaskRow) => {
    setCurrentTask(row);
    setRunsOpen(true);
    setRunLoading(true);
    try {
      const res = await api.listScheduledTaskRuns(row.id, { page: 1, page_size: 50 });
      setRunRows((res?.items || []) as RunRow[]);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '加载运行记录失败');
      setRunRows([]);
    } finally {
      setRunLoading(false);
    }
  };

  useEffect(() => {
    void loadRobots();
  }, []);

  useEffect(() => {
    if (!robotId) return;
    setLastSelectedRobotId(robotId);
    void loadTasks(robotId);
  }, [robotId]);

  return (
    <Card
      title={(
        <Space direction="vertical" size={0}>
          <span>定时任务</span>
          <Typography.Text type="secondary">任务定义存 MySQL，由独立 Scheduler Worker 触发执行。V1 支持 once/daily/weekly/cron。</Typography.Text>
        </Space>
      )}
      extra={<Button onClick={() => void loadTasks()}>刷新</Button>}
    >
      <Space style={{ marginBottom: 12 }}>
        <Select
          style={{ width: 360 }}
          value={robotId}
          onChange={setRobotId}
          options={robotOptions}
          placeholder="选择机器人"
          showSearch
          optionFilterProp="label"
        />
        <Button type="primary" onClick={openCreate}>新建定时任务</Button>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        size="small"
        columns={[
          { title: '名称', dataIndex: 'name', width: 180, ellipsis: true },
          { title: '动作', dataIndex: 'action', width: 170, render: (v: string) => actionLabel(v) },
          { title: '计划', width: 240, render: (_, row: TaskRow) => scheduleLabel(row) },
          { title: '下次执行', dataIndex: 'next_run_at', width: 170, render: (v: string) => v || '-' },
          { title: '上次执行', dataIndex: 'last_run_at', width: 170, render: (v: string) => v || '-' },
          { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <Tag>{v}</Tag> },
          {
            title: '操作',
            width: 330,
            render: (_, row: TaskRow) => (
              <Space size={4}>
                <Button type="link" size="small" onClick={() => openEdit(row)}>编辑</Button>
                <Button type="link" size="small" onClick={() => void onRunNow(row)}>执行一次</Button>
                <Button type="link" size="small" onClick={() => void openRuns(row)}>运行记录</Button>
                {row.status === 'enabled' ? (
                  <Button type="link" size="small" onClick={() => void onToggle(row, false)}>暂停</Button>
                ) : (
                  <Button type="link" size="small" onClick={() => void onToggle(row, true)}>启用</Button>
                )}
                <Popconfirm title="确认删除该任务？" onConfirm={() => void onDelete(row)}>
                  <Button type="link" size="small" danger>删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? '编辑定时任务' : '新建定时任务'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => void submit()}
        confirmLoading={saving}
        width={860}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="robot_id" label="机器人ID" rules={[{ required: true, message: '请选择机器人' }]}>
            <Select options={robotOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="name" label="任务名称" rules={[{ required: true, message: '请输入任务名称' }]}>
            <Input maxLength={128} />
          </Form.Item>
          <Form.Item name="action" label="任务动作" rules={[{ required: true }]}> 
            <Select
              options={[
                { label: '发送消息', value: 'send_text' },
                { label: '发送文件', value: 'send_file' },
                { label: '创建外部群', value: 'create_external_group' },
                { label: '修改群信息', value: 'update_group' },
                { label: '解散群', value: 'dissolve_group' },
                { label: '按手机号加好友', value: 'add_friend_by_phone' },
              ]}
            />
          </Form.Item>
          <Form.Item name="payload_json_text" label="任务参数 JSON（与 /tasks/dispatch 的 payload 一致）" rules={[{ required: true, message: '请输入 JSON' }]}> 
            <Input.TextArea rows={10} />
          </Form.Item>
          <Space style={{ width: '100%' }} align="start">
            <Form.Item name="schedule_type" label="计划类型" rules={[{ required: true }]}>
              <Select style={{ width: 140 }} options={[{ label: 'once', value: 'once' }, { label: 'daily', value: 'daily' }, { label: 'weekly', value: 'weekly' }, { label: 'cron', value: 'cron' }]} />
            </Form.Item>
            <Form.Item name="timezone" label="时区" initialValue="Asia/Shanghai">
              <Input style={{ width: 180 }} />
            </Form.Item>
            <Form.Item name="misfire_policy" label="错过策略" initialValue="skip">
              <Select style={{ width: 140 }} options={[{ label: 'skip', value: 'skip' }, { label: 'fire_once', value: 'fire_once' }]} />
            </Form.Item>
            <Form.Item name="status" label="状态" initialValue="draft">
              <Select style={{ width: 140 }} options={[{ label: 'draft', value: 'draft' }, { label: 'enabled', value: 'enabled' }, { label: 'paused', value: 'paused' }]} />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} align="start">
            <Form.Item name="run_at" label="run_at (once)" tooltip="YYYY-MM-DD HH:MM:SS">
              <Input style={{ width: 200 }} />
            </Form.Item>
            <Form.Item name="daily_time" label="daily_time" tooltip="HH:MM 或 HH:MM:SS">
              <Input style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="weekly_days_text" label="weekly_days" tooltip="逗号分隔，例如 1,3,5">
              <Input style={{ width: 180 }} />
            </Form.Item>
            <Form.Item name="cron_expr" label="cron_expr" tooltip="5段表达式，例如 */10 * * * *">
              <Input style={{ width: 180 }} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      <Drawer
        title={currentTask ? `运行记录：${currentTask.name}` : '运行记录'}
        open={runsOpen}
        onClose={() => setRunsOpen(false)}
        width={860}
      >
        <Table
          rowKey="id"
          size="small"
          loading={runLoading}
          dataSource={runRows}
          columns={[
            { title: '计划时间', dataIndex: 'planned_at', width: 170 },
            { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <Tag>{v}</Tag> },
            { title: '开始时间', dataIndex: 'started_at', width: 170, render: (v: string) => v || '-' },
            { title: '结束时间', dataIndex: 'finished_at', width: 170, render: (v: string) => v || '-' },
            { title: '错误', dataIndex: 'error_text', ellipsis: true, render: (v: string) => v || '-' },
          ]}
          pagination={false}
        />
      </Drawer>
    </Card>
  );
}
