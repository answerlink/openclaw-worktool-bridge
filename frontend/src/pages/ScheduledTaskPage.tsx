import { useEffect, useMemo, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  DatePicker,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  TimePicker,
  Typography,
  message,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { api } from '../api';
import type { Robot } from '../types';
import { getLastSelectedRobotId, maskRobotIdForDisplay, setLastSelectedRobotId } from '../robotSelection';
import HoverPreviewText from '../components/HoverPreviewText';

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

interface FormValues {
  robot_id?: string;
  name?: string;
  action?: string;
  tag_ids?: number[];
  target_names_text?: string;
  content?: string;
  at_list_text?: string;
  object_name?: string;
  file_url?: string;
  file_type?: string;
  extra_text?: string;
  group_name?: string;
  select_list_text?: string;
  group_announcement?: string;
  group_remark?: string;
  group_template?: string;
  new_group_name?: string;
  new_group_announcement?: string;
  show_message_history?: boolean;
  remove_list_text?: string;
  phone?: string;
  mark_name?: string;
  mark_extra?: string;
  friend_tag_list_text?: string;
  leaving_msg?: string;
  clear_wework_storage?: boolean;
  schedule_type?: 'once' | 'daily' | 'weekly' | 'cron';
  run_at_date?: Dayjs;
  daily_time?: Dayjs;
  weekly_days?: number[];
  cron_expr?: string;
  status?: 'draft' | 'enabled' | 'paused';
  timezone?: string;
  misfire_policy?: 'skip' | 'fire_once';
}

function splitLines(text: string): string[] {
  return String(text || '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
}

function actionLabel(v: string) {
  const m: Record<string, string> = {
    send_text: '发送消息',
    send_file: '发送图片/文件',
    create_external_group: '创建外部群',
    update_group: '修改群信息',
    dissolve_group: '解散群',
    add_friend_by_phone: '按手机号加好友',
    clear_wework_storage: '清理企微存储空间',
  };
  return m[v] || v;
}

function statusTag(v: string) {
  const m: Record<string, { text: string; color: string }> = {
    enabled: { text: '运行中', color: 'green' },
    paused: { text: '已暂停', color: 'orange' },
    draft: { text: '草稿', color: 'default' },
    disabled: { text: '已停用', color: 'default' },
  };
  const c = m[v] || { text: v, color: 'default' };
  return <Tag color={c.color}>{c.text}</Tag>;
}

function scheduleLabel(row: TaskRow) {
  if (row.schedule_type === 'once') return `${row.run_at || '-'} 执行一次`;
  if (row.schedule_type === 'daily') return `每天 ${row.daily_time || '-'} 执行`;
  if (row.schedule_type === 'weekly') {
    const days = String(row.weekly_days || '')
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((x) => x >= 1 && x <= 7)
      .map((x) => ['一', '二', '三', '四', '五', '六', '日'][x - 1])
      .join('、');
    return `每周${days || '-'} ${row.daily_time || '-'} 执行`;
  }
  return `Cron: ${row.cron_expr || '-'}`;
}

function toDayjsDateTime(v: string): Dayjs | undefined {
  if (!v) return undefined;
  const d = dayjs(v);
  return d.isValid() ? d : undefined;
}

function toDayjsTime(v: string): Dayjs | undefined {
  if (!v) return undefined;
  const d = dayjs(v, ['HH:mm:ss', 'HH:mm']);
  return d.isValid() ? d : undefined;
}

export default function ScheduledTaskPage() {
  const [robots, setRobots] = useState<Robot[]>([]);
  const [robotId, setRobotId] = useState<string | undefined>(() => getLastSelectedRobotId());
  const [tagOptions, setTagOptions] = useState<{ label: string; value: number }[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<FormValues>();

  const [runsOpen, setRunsOpen] = useState(false);
  const [runRows, setRunRows] = useState<RunRow[]>([]);
  const [runLoading, setRunLoading] = useState(false);
  const [currentTask, setCurrentTask] = useState<TaskRow | null>(null);

  const scheduleType = Form.useWatch('schedule_type', form);
  const actionType = Form.useWatch('action', form);

  const robotOptions = useMemo(
    () => robots.map((r) => ({ label: r.name ? `${r.name} (${maskRobotIdForDisplay(r.robot_id)})` : maskRobotIdForDisplay(r.robot_id), value: r.robot_id })),
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

  const loadTags = async (rid?: string) => {
    const nextRid = (rid || robotId || '').trim();
    if (!nextRid) {
      setTagOptions([]);
      return;
    }
    setLoadingTags(true);
    try {
      const res = await api.listGroupTags(nextRid);
      const items = (res?.items || []).map((x: any) => ({ label: `${x.name} (${Number(x.item_count || 0)})`, value: Number(x.id) }));
      setTagOptions(items);
    } catch {
      setTagOptions([]);
    } finally {
      setLoadingTags(false);
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

  const openCreate = async () => {
    if (!robotId) return message.warning('请先选择机器人');
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      robot_id: robotId,
      name: '',
      action: 'send_text',
      tag_ids: [],
      target_names_text: '',
      content: '',
      schedule_type: 'daily',
      daily_time: dayjs('09:00', 'HH:mm'),
      weekly_days: [1, 2, 3, 4, 5],
      status: 'enabled',
      timezone: 'Asia/Shanghai',
      misfire_policy: 'skip',
      file_type: 'image',
      show_message_history: false,
    });
    await loadTags(robotId);
    setModalOpen(true);
  };

  const openEdit = async (row: TaskRow) => {
    setEditing(row);
    const p = row.payload_json || {};
    form.setFieldsValue({
      robot_id: row.robot_id,
      name: row.name,
      action: row.action,
      tag_ids: Array.isArray(p.tag_ids) ? p.tag_ids.map((x: any) => Number(x)).filter((x: number) => x > 0) : [],
      target_names_text: Array.isArray(p.target_names) ? p.target_names.join('\n') : '',
      content: String(p.content || ''),
      at_list_text: Array.isArray(p.at_list) ? p.at_list.join('\n') : '',
      object_name: String(p.object_name || ''),
      file_url: String(p.file_url || ''),
      file_type: String(p.file_type || 'image') || 'image',
      extra_text: String(p.extra_text || ''),
      group_name: String(p.group_name || ''),
      select_list_text: Array.isArray(p.select_list) ? p.select_list.join('\n') : '',
      group_announcement: String(p.group_announcement || ''),
      group_remark: String(p.group_remark || ''),
      group_template: String(p.group_template || ''),
      new_group_name: String(p.new_group_name || ''),
      new_group_announcement: String(p.new_group_announcement || ''),
      show_message_history: Boolean(p.show_message_history),
      remove_list_text: Array.isArray(p.remove_list) ? p.remove_list.join('\n') : '',
      phone: String(p.phone || ''),
      mark_name: String(p.mark_name || ''),
      mark_extra: String(p.mark_extra || ''),
      friend_tag_list_text: Array.isArray(p.friend_tag_list) ? p.friend_tag_list.join('\n') : '',
      leaving_msg: String(p.leaving_msg || ''),
      schedule_type: row.schedule_type,
      run_at_date: toDayjsDateTime(row.run_at),
      daily_time: toDayjsTime(row.daily_time),
      weekly_days: String(row.weekly_days || '')
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((x) => x >= 1 && x <= 7),
      cron_expr: row.cron_expr,
      status: row.status === 'disabled' ? 'paused' : row.status,
      timezone: row.timezone || 'Asia/Shanghai',
      misfire_policy: row.misfire_policy || 'skip',
    });
    await loadTags(row.robot_id);
    setModalOpen(true);
  };

  const buildPayload = (v: FormValues): Record<string, any> => {
    const action = String(v.action || '');
    const payload: Record<string, any> = {};

    if (action === 'send_text') {
      payload.tag_ids = (v.tag_ids || []).map((x) => Number(x)).filter((x) => x > 0);
      payload.target_names = splitLines(String(v.target_names_text || ''));
      payload.content = String(v.content || '');
      payload.at_list = splitLines(String(v.at_list_text || ''));
    } else if (action === 'send_file') {
      payload.tag_ids = (v.tag_ids || []).map((x) => Number(x)).filter((x) => x > 0);
      payload.target_names = splitLines(String(v.target_names_text || ''));
      payload.object_name = String(v.object_name || '');
      payload.file_url = String(v.file_url || '');
      payload.file_type = String(v.file_type || '*') || '*';
      payload.extra_text = String(v.extra_text || '');
    } else if (action === 'create_external_group') {
      payload.group_name = String(v.group_name || '');
      payload.select_list = splitLines(String(v.select_list_text || ''));
      payload.group_announcement = String(v.group_announcement || '');
      payload.group_remark = String(v.group_remark || '');
      payload.group_template = String(v.group_template || '');
    } else if (action === 'update_group') {
      payload.tag_ids = (v.tag_ids || []).map((x) => Number(x)).filter((x) => x > 0);
      payload.target_names = splitLines(String(v.target_names_text || ''));
      payload.group_name = String(v.group_name || '');
      payload.new_group_name = String(v.new_group_name || '');
      payload.new_group_announcement = String(v.new_group_announcement || '');
      payload.select_list = splitLines(String(v.select_list_text || ''));
      payload.show_message_history = Boolean(v.show_message_history);
      payload.remove_list = splitLines(String(v.remove_list_text || ''));
      payload.group_remark = String(v.group_remark || '');
      payload.group_template = String(v.group_template || '');
    } else if (action === 'dissolve_group') {
      payload.group_name = String(v.group_name || '');
    } else if (action === 'add_friend_by_phone') {
      payload.phone = String(v.phone || '');
      payload.mark_name = String(v.mark_name || '');
      payload.mark_extra = String(v.mark_extra || '');
      payload.friend_tag_list = splitLines(String(v.friend_tag_list_text || ''));
      payload.leaving_msg = String(v.leaving_msg || '');
    } else if (action === 'clear_wework_storage') {
      payload.clear_wework_storage = true;
    }

    return payload;
  };

  const submit = async () => {
    const v = await form.validateFields();
    const rid = String(v.robot_id || '').trim();
    if (!rid) return message.warning('robot_id 不能为空');

    const action = String(v.action || '');
    const scheduleType = String(v.schedule_type || 'daily');

    if (scheduleType === 'weekly' && (!v.weekly_days || v.weekly_days.length === 0)) {
      return message.warning('每周执行至少选择一天');
    }

    if (action === 'dissolve_group') {
      const ok = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: '确认保存“解散群”定时任务？',
          content: '该动作风险较高，请确认目标群配置正确。',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!ok) return;
    }

    const payload = {
      robot_id: rid,
      name: String(v.name || '').trim(),
      action,
      payload_json: buildPayload(v),
      schedule_type: scheduleType,
      timezone: String(v.timezone || 'Asia/Shanghai').trim() || 'Asia/Shanghai',
      run_at: scheduleType === 'once' && v.run_at_date ? v.run_at_date.format('YYYY-MM-DD HH:mm:ss') : undefined,
      daily_time:
        (scheduleType === 'daily' || scheduleType === 'weekly') && v.daily_time
          ? v.daily_time.format('HH:mm:ss')
          : undefined,
      weekly_days: scheduleType === 'weekly' ? (v.weekly_days || []) : [],
      cron_expr: scheduleType === 'cron' ? String(v.cron_expr || '').trim() : undefined,
      misfire_policy: v.misfire_policy || 'skip',
      status: v.status || 'enabled',
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
    if (row.action === 'dissolve_group') {
      const ok = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: '确认立即执行“解散群”吗？',
          content: '该操作不可撤销，请谨慎操作。',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!ok) return;
    }
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
    void Promise.all([loadTasks(robotId), loadTags(robotId)]);
  }, [robotId]);

  return (
    <Card
      title={(
        <Space direction="vertical" size={0}>
          <span>定时任务</span>
          <Typography.Text type="secondary">默认只需要填任务内容和执行时间；高级设置可按需展开。</Typography.Text>
        </Space>
      )}
      extra={
        <Button icon={<ReloadOutlined />} onClick={() => void loadTasks()}>
          刷新
        </Button>
      }
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
        <Button type="primary" onClick={() => void openCreate()}>
          新建定时任务
        </Button>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        size="small"
        columns={[
          { title: '任务名称', dataIndex: 'name', width: 220, render: (v: string) => <HoverPreviewText value={v} maxWidth={200} /> },
          { title: '执行内容', dataIndex: 'action', width: 180, render: (v: string) => actionLabel(v) },
          { title: '执行计划', width: 270, render: (_, row: TaskRow) => scheduleLabel(row) },
          { title: '下次执行', dataIndex: 'next_run_at', width: 170, render: (v: string) => v || '-' },
          { title: '上次执行', dataIndex: 'last_run_at', width: 170, render: (v: string) => v || '-' },
          { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => statusTag(v) },
          {
            title: '操作',
            width: 340,
            render: (_, row: TaskRow) => (
              <Space size={4}>
                <Button type="link" size="small" onClick={() => void openEdit(row)}>
                  编辑
                </Button>
                <Button type="link" size="small" onClick={() => void onRunNow(row)}>
                  立即执行一次
                </Button>
                <Button type="link" size="small" onClick={() => void openRuns(row)}>
                  运行记录
                </Button>
                {row.status === 'enabled' ? (
                  <Button type="link" size="small" onClick={() => void onToggle(row, false)}>
                    暂停
                  </Button>
                ) : (
                  <Button type="link" size="small" onClick={() => void onToggle(row, true)}>
                    启用
                  </Button>
                )}
                <Popconfirm title="确认删除该任务？" onConfirm={() => void onDelete(row)}>
                  <Button type="link" size="small" danger>
                    删除
                  </Button>
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
        width={900}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" initialValues={{ misfire_policy: 'skip', timezone: 'Asia/Shanghai' }}>
          <Form.Item name="robot_id" label="机器人ID" rules={[{ required: true, message: '请选择机器人' }]}> 
            <Select options={robotOptions} showSearch optionFilterProp="label" onChange={(v) => void loadTags(v)} />
          </Form.Item>

          <Form.Item name="name" label="任务名称" rules={[{ required: true, message: '请输入任务名称' }]}> 
            <Input maxLength={128} placeholder="例如：早报群发" />
          </Form.Item>

          <Form.Item name="action" label="执行内容" rules={[{ required: true, message: '请选择执行内容' }]}> 
            <Select
              options={[
                { label: '发送消息', value: 'send_text' },
                { label: '发送图片/文件', value: 'send_file' },
                { label: '创建外部群', value: 'create_external_group' },
                { label: '修改群信息', value: 'update_group' },
                { label: '解散群', value: 'dissolve_group' },
                { label: '按手机号加好友', value: 'add_friend_by_phone' },
                { label: '清理企微存储空间', value: 'clear_wework_storage' },
              ]}
            />
          </Form.Item>

          {(actionType === 'send_text' || actionType === 'send_file') && (
            <>
              <Alert type="info" showIcon style={{ marginBottom: 12 }} message="发送对象支持：手动输入目标名 + 标签组（可同时使用）" />
              <Form.Item name="tag_ids" label="标签组"> 
                <Select mode="multiple" options={tagOptions} placeholder={loadingTags ? '加载中...' : '选择标签组'} allowClear loading={loadingTags} />
              </Form.Item>
              <Form.Item name="target_names_text" label="手动目标名（每行一个，群名或备注名）"> 
                <Input.TextArea rows={3} placeholder={'例如：\n测试群A\n张三备注'} />
              </Form.Item>
            </>
          )}

          {actionType === 'send_text' && (
            <>
              <Form.Item name="content" label="消息内容" rules={[{ required: true, message: '请输入消息内容' }]}> 
                <Input.TextArea rows={4} />
              </Form.Item>
              <Form.Item name="at_list_text" label="@名单（每行一个，可选）"> 
                <Input.TextArea rows={2} placeholder={'例如：\n@所有人\n张三'} />
              </Form.Item>
            </>
          )}

          {actionType === 'send_file' && (
            <>
              <Form.Item name="object_name" label="文件名" rules={[{ required: true, message: '请输入文件名' }]}> 
                <Input />
              </Form.Item>
              <Form.Item name="file_url" label="文件URL" rules={[{ required: true, message: '请输入文件URL' }]}> 
                <Input />
              </Form.Item>
              <Form.Item name="file_type" label="文件类型" initialValue="image"> 
                <Select options={[{ label: '图片', value: 'image' }, { label: '音频', value: 'audio' }, { label: '视频', value: 'video' }, { label: '其他', value: '*' }]} />
              </Form.Item>
              <Form.Item name="extra_text" label="附加留言（可选）"> 
                <Input />
              </Form.Item>
            </>
          )}

          {actionType === 'create_external_group' && (
            <>
              <Form.Item name="group_name" label="群名" rules={[{ required: true, message: '请输入群名' }]}><Input /></Form.Item>
              <Form.Item name="select_list_text" label="拉人名单（每行一个）" rules={[{ required: true, message: '请至少输入一个成员' }]}><Input.TextArea rows={3} /></Form.Item>
              <Form.Item name="group_announcement" label="群公告"><Input.TextArea rows={3} /></Form.Item>
              <Form.Item name="group_remark" label="群备注"><Input /></Form.Item>
              <Form.Item name="group_template" label="群模板"><Input /></Form.Item>
            </>
          )}

          {actionType === 'update_group' && (
            <>
              <Alert type="info" showIcon style={{ marginBottom: 12 }} message="支持批量：可选择标签组或手动填写多个目标名；若只改单个群，也可直接填“单个目标群名”。" />
              <Form.Item name="tag_ids" label="标签组">
                <Select mode="multiple" options={tagOptions} placeholder={loadingTags ? '加载中...' : '选择标签组'} allowClear loading={loadingTags} />
              </Form.Item>
              <Form.Item name="target_names_text" label="手动目标名（每行一个，群名或备注名）">
                <Input.TextArea rows={3} placeholder={'例如：\n测试群A\n测试群B'} />
              </Form.Item>
              <Form.Item name="group_name" label="单个目标群名（可选）"><Input /></Form.Item>
              <Form.Item name="new_group_name" label="新群名"><Input /></Form.Item>
              <Form.Item name="new_group_announcement" label="新群公告"><Input.TextArea rows={3} /></Form.Item>
              <Form.Item name="select_list_text" label="拉人名单（每行一个）"><Input.TextArea rows={3} /></Form.Item>
              <Form.Item name="show_message_history" label="拉人附带历史消息" valuePropName="checked"><Checkbox /></Form.Item>
              <Form.Item name="remove_list_text" label="踢人名单（每行一个）"><Input.TextArea rows={3} /></Form.Item>
              <Form.Item name="group_remark" label="群备注"><Input /></Form.Item>
              <Form.Item name="group_template" label="群模板"><Input /></Form.Item>
            </>
          )}

          {actionType === 'dissolve_group' && (
            <>
              <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="该任务会尝试解散群，操作不可撤销。" />
              <Form.Item name="group_name" label="群名/备注名" rules={[{ required: true, message: '请输入群名' }]}><Input /></Form.Item>
            </>
          )}

          {actionType === 'add_friend_by_phone' && (
            <>
              <Form.Item name="phone" label="手机号" rules={[{ required: true, message: '请输入手机号' }]}><Input /></Form.Item>
              <Form.Item name="mark_name" label="备注名"><Input /></Form.Item>
              <Form.Item name="mark_extra" label="备注其他信息"><Input /></Form.Item>
              <Form.Item name="friend_tag_list_text" label="标签（每行一个）"><Input.TextArea rows={3} /></Form.Item>
              <Form.Item name="leaving_msg" label="附言"><Input.TextArea rows={3} /></Form.Item>
            </>
          )}

          {actionType === 'clear_wework_storage' && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="该任务会直接向机器人发送清理企微存储空间指令，不需要额外参数。"
            />
          )}

          <Space style={{ width: '100%' }} align="start" wrap>
            <Form.Item name="schedule_type" label="执行频率" rules={[{ required: true, message: '请选择执行频率' }]} initialValue="daily">
              <Select
                style={{ width: 180 }}
                options={[
                  { label: '执行一次', value: 'once' },
                  { label: '每天执行', value: 'daily' },
                  { label: '每周执行', value: 'weekly' },
                  { label: '自定义Cron（高级）', value: 'cron' },
                ]}
              />
            </Form.Item>

            {scheduleType === 'once' && (
              <Form.Item name="run_at_date" label="执行时间" rules={[{ required: true, message: '请选择执行时间' }]}> 
                <DatePicker showTime format="YYYY-MM-DD HH:mm:ss" style={{ width: 240 }} />
              </Form.Item>
            )}

            {(scheduleType === 'daily' || scheduleType === 'weekly') && (
              <Form.Item name="daily_time" label="每天几点" rules={[{ required: true, message: '请选择执行时间' }]}> 
                <TimePicker format="HH:mm:ss" style={{ width: 160 }} />
              </Form.Item>
            )}

            {scheduleType === 'weekly' && (
              <Form.Item name="weekly_days" label="每周几" rules={[{ required: true, message: '请选择每周执行日' }]}> 
                <Checkbox.Group
                  options={[
                    { label: '周一', value: 1 },
                    { label: '周二', value: 2 },
                    { label: '周三', value: 3 },
                    { label: '周四', value: 4 },
                    { label: '周五', value: 5 },
                    { label: '周六', value: 6 },
                    { label: '周日', value: 7 },
                  ]}
                />
              </Form.Item>
            )}
          </Space>

          {scheduleType === 'cron' && (
            <Form.Item name="cron_expr" label="Cron 表达式" rules={[{ required: true, message: '请输入 Cron 表达式' }]}> 
              <Input placeholder="例如 */10 * * * *" />
            </Form.Item>
          )}

          <Form.Item name="status" label="保存状态" initialValue="enabled">
            <Select style={{ width: 180 }} options={[{ label: '立即启用', value: 'enabled' }, { label: '先存草稿', value: 'draft' }, { label: '保存为暂停', value: 'paused' }]} />
          </Form.Item>

          <Collapse
            items={[
              {
                key: 'advanced',
                label: '高级设置（可选）',
                children: (
                  <Space style={{ width: '100%' }} align="start" wrap>
                    <Form.Item name="timezone" label="时区" initialValue="Asia/Shanghai">
                      <Input style={{ width: 180 }} />
                    </Form.Item>
                    <Form.Item name="misfire_policy" label="错过执行时" initialValue="skip" tooltip="默认策略：10分钟内补执行一次，超过10分钟跳过">
                      <Select
                        style={{ width: 340 }}
                        options={[
                          { label: '默认：10分钟内补执行一次，超过10分钟跳过', value: 'skip' },
                          { label: '始终补执行一次（不限制延迟）', value: 'fire_once' },
                        ]}
                      />
                    </Form.Item>
                  </Space>
                ),
              },
            ]}
          />
        </Form>
      </Modal>

      <Drawer title={currentTask ? `运行记录：${currentTask.name}` : '运行记录'} open={runsOpen} onClose={() => setRunsOpen(false)} width={860}>
        <Table
          rowKey="id"
          size="small"
          loading={runLoading}
          dataSource={runRows}
          columns={[
            { title: '计划时间', dataIndex: 'planned_at', width: 170 },
            { title: '状态', dataIndex: 'status', width: 120, render: (v: string) => statusTag(v) },
            { title: '开始时间', dataIndex: 'started_at', width: 170, render: (v: string) => v || '-' },
            { title: '结束时间', dataIndex: 'finished_at', width: 170, render: (v: string) => v || '-' },
            { title: '错误信息', dataIndex: 'error_text', render: (v: string) => <HoverPreviewText value={v} maxWidth={280} popupWidth={760} /> },
          ]}
          pagination={false}
        />
      </Drawer>
    </Card>
  );
}
