import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Form, Input, Select, Space, Switch, Tabs, Typography, message } from 'antd';
import { api } from '../api';
import type { Robot } from '../types';
import { getLastSelectedRobotId, maskRobotIdForDisplay, setLastSelectedRobotId } from '../robotSelection';

function splitLines(text: string): string[] {
  return String(text || '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
}

export default function TaskCenterPage() {
  const [robots, setRobots] = useState<Robot[]>([]);
  const [robotId, setRobotId] = useState<string | undefined>(() => getLastSelectedRobotId());
  const [tagOptions, setTagOptions] = useState<{ label: string; value: number }[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [textForm] = Form.useForm();
  const [fileForm] = Form.useForm();
  const [createGroupForm] = Form.useForm();
  const [updateGroupForm] = Form.useForm();
  const [dissolveForm] = Form.useForm();
  const [addFriendForm] = Form.useForm();

  const robotOptions = useMemo(
    () => robots.map((r) => ({ label: r.name ? `${r.name} (${maskRobotIdForDisplay(r.robot_id)})` : maskRobotIdForDisplay(r.robot_id), value: r.robot_id })),
    [robots]
  );

  const loadRobots = async () => {
    try {
      const rows = await api.listRobots();
      setRobots(rows || []);
      if (!robotId && rows?.length) {
        setRobotId(rows[0].robot_id);
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

  useEffect(() => {
    void loadRobots();
  }, []);

  useEffect(() => {
    if (!robotId) return;
    setLastSelectedRobotId(robotId);
    void loadTags(robotId);
  }, [robotId]);

  const parseTargets = (values: any) => {
    const raw = String(values?.target_names_text || '');
    const targetNames = splitLines(raw);
    const tagIds = (values?.tag_ids || []).map((x: any) => Number(x)).filter((x: number) => x > 0);
    return { targetNames, tagIds };
  };

  const submitSendText = async () => {
    const values = await textForm.validateFields();
    if (!robotId) return message.warning('请先选择机器人');
    const { targetNames, tagIds } = parseTargets(values);
    setSubmitting(true);
    try {
      const res = await api.dispatchTask({
        robot_id: robotId,
        action: 'send_text',
        target_names: targetNames,
        tag_ids: tagIds,
        content: String(values.content || ''),
        at_list: splitLines(String(values.at_list_text || '')),
      });
      message.success(`下发成功：${Number(res?.item_count || 0)} 条`);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '下发失败');
    } finally {
      setSubmitting(false);
    }
  };

  const submitSendFile = async () => {
    const values = await fileForm.validateFields();
    if (!robotId) return message.warning('请先选择机器人');
    const { targetNames, tagIds } = parseTargets(values);
    setSubmitting(true);
    try {
      const res = await api.dispatchTask({
        robot_id: robotId,
        action: 'send_file',
        target_names: targetNames,
        tag_ids: tagIds,
        object_name: String(values.object_name || ''),
        file_url: String(values.file_url || ''),
        file_type: String(values.file_type || '*'),
        extra_text: String(values.extra_text || ''),
      });
      message.success(`下发成功：${Number(res?.item_count || 0)} 条`);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '下发失败');
    } finally {
      setSubmitting(false);
    }
  };

  const submitCreateGroup = async () => {
    const v = await createGroupForm.validateFields();
    if (!robotId) return message.warning('请先选择机器人');
    setSubmitting(true);
    try {
      await api.dispatchTask({
        robot_id: robotId,
        action: 'create_external_group',
        group_name: String(v.group_name || ''),
        select_list: splitLines(String(v.select_list_text || '')),
        group_announcement: String(v.group_announcement || ''),
        group_remark: String(v.group_remark || ''),
        group_template: String(v.group_template || ''),
      });
      message.success('创建外部群指令已下发');
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '下发失败');
    } finally {
      setSubmitting(false);
    }
  };

  const submitUpdateGroup = async () => {
    const v = await updateGroupForm.validateFields();
    if (!robotId) return message.warning('请先选择机器人');
    const { targetNames, tagIds } = parseTargets(v);
    const singleGroupName = String(v.group_name || '').trim();
    if (!singleGroupName && targetNames.length === 0 && tagIds.length === 0) {
      return message.warning('请至少提供一个目标群（可用标签组、手动目标名或单个目标群名）');
    }
    setSubmitting(true);
    try {
      await api.dispatchTask({
        robot_id: robotId,
        action: 'update_group',
        tag_ids: tagIds,
        target_names: targetNames,
        group_name: singleGroupName,
        new_group_name: String(v.new_group_name || ''),
        new_group_announcement: String(v.new_group_announcement || ''),
        group_remark: String(v.group_remark || ''),
        group_template: String(v.group_template || ''),
        select_list: splitLines(String(v.select_list_text || '')),
        show_message_history: Boolean(v.show_message_history),
        remove_list: splitLines(String(v.remove_list_text || '')),
      });
      message.success('修改群信息指令已下发');
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '下发失败');
    } finally {
      setSubmitting(false);
    }
  };

  const submitDissolveGroup = async () => {
    const v = await dissolveForm.validateFields();
    if (!robotId) return message.warning('请先选择机器人');
    setSubmitting(true);
    try {
      await api.dispatchTask({ robot_id: robotId, action: 'dissolve_group', group_name: String(v.group_name || '') });
      message.success('解散群指令已下发');
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '下发失败');
    } finally {
      setSubmitting(false);
    }
  };

  const submitAddFriend = async () => {
    const v = await addFriendForm.validateFields();
    if (!robotId) return message.warning('请先选择机器人');
    setSubmitting(true);
    try {
      await api.dispatchTask({
        robot_id: robotId,
        action: 'add_friend_by_phone',
        phone: String(v.phone || ''),
        mark_name: String(v.mark_name || ''),
        mark_extra: String(v.mark_extra || ''),
        friend_tag_list: splitLines(String(v.friend_tag_list_text || '')),
        leaving_msg: String(v.leaving_msg || ''),
      });
      message.success('加好友指令已下发');
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '下发失败');
    } finally {
      setSubmitting(false);
    }
  };

  const submitClearStorage = async () => {
    if (!robotId) return message.warning('请先选择机器人');
    setSubmitting(true);
    try {
      await api.dispatchTask({
        robot_id: robotId,
        action: 'clear_wework_storage',
      });
      message.success('清理企微存储空间指令已下发');
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '下发失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card
      title={(
        <Space direction="vertical" size={0}>
          <span>指令任务下发</span>
          <Typography.Text type="secondary">对 WorkTool 常用指令提供可视化下发；消息与文件支持按标签组批量下发。</Typography.Text>
        </Space>
      )}
      extra={<Button onClick={() => void loadTags()} loading={loadingTags}>刷新标签</Button>}
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
      </Space>

      <Tabs
        items={[
          {
            key: 'send_text',
            label: '发送消息',
            children: (
              <Form form={textForm} layout="vertical" onFinish={() => void submitSendText()}>
                <Alert type="info" showIcon style={{ marginBottom: 12 }} message="发送对象支持两种来源：手输目标名 + 标签组（可同时使用）" />
                <Form.Item label="标签组" name="tag_ids">
                  <Select mode="multiple" options={tagOptions} placeholder="选择标签组" allowClear />
                </Form.Item>
                <Form.Item label="手动目标名（每行一个，群名或备注名）" name="target_names_text">
                  <Input.TextArea rows={4} placeholder={`例如：
测试群A
张三备注`} />
                </Form.Item>
                <Form.Item label="消息内容" name="content" rules={[{ required: true, message: '请输入消息内容' }]}>
                  <Input.TextArea rows={4} />
                </Form.Item>
                <Form.Item label="@名单（每行一个，可选）" name="at_list_text">
                  <Input.TextArea rows={2} placeholder={`例如：
@所有人
张三`} />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={submitting}>下发发送消息</Button>
              </Form>
            ),
          },
          {
            key: 'send_file',
            label: '发送图片/文件',
            children: (
              <Form form={fileForm} layout="vertical" onFinish={() => void submitSendFile()}>
                <Form.Item label="标签组" name="tag_ids">
                  <Select mode="multiple" options={tagOptions} placeholder="选择标签组" allowClear />
                </Form.Item>
                <Form.Item label="手动目标名（每行一个）" name="target_names_text">
                  <Input.TextArea rows={3} />
                </Form.Item>
                <Form.Item label="文件名" name="object_name" rules={[{ required: true, message: '请输入文件名' }]}>
                  <Input />
                </Form.Item>
                <Form.Item label="文件URL" name="file_url" rules={[{ required: true, message: '请输入文件URL' }]}>
                  <Input />
                </Form.Item>
                <Form.Item label="文件类型" name="file_type" initialValue="image">
                  <Select options={[{ label: 'image', value: 'image' }, { label: 'audio', value: 'audio' }, { label: 'video', value: 'video' }, { label: 'other(*)', value: '*' }]} />
                </Form.Item>
                <Form.Item label="附加留言" name="extra_text">
                  <Input />
                </Form.Item>
                <Button type="primary" htmlType="submit" loading={submitting}>下发发送文件</Button>
              </Form>
            ),
          },
          {
            key: 'create_group',
            label: '创建外部群',
            children: (
              <Form form={createGroupForm} layout="vertical" onFinish={() => void submitCreateGroup()}>
                <Form.Item label="群名" name="group_name" rules={[{ required: true, message: '请输入群名' }]}><Input /></Form.Item>
                <Form.Item label="拉人名单（每行一个）" name="select_list_text" rules={[{ required: true, message: '请至少输入一个成员' }]}><Input.TextArea rows={3} /></Form.Item>
                <Form.Item label="群公告" name="group_announcement"><Input.TextArea rows={3} /></Form.Item>
                <Form.Item label="群备注" name="group_remark"><Input /></Form.Item>
                <Form.Item label="群模板" name="group_template"><Input /></Form.Item>
                <Button type="primary" htmlType="submit" loading={submitting}>下发创建外部群</Button>
              </Form>
            ),
          },
          {
            key: 'update_group',
            label: '修改群信息',
            children: (
              <Form form={updateGroupForm} layout="vertical" onFinish={() => void submitUpdateGroup()}>
                <Alert type="info" showIcon style={{ marginBottom: 12 }} message="支持批量：可选择标签组或手动填写多个目标名；若只改单个群，也可直接填“单个目标群名”。" />
                <Form.Item label="标签组" name="tag_ids">
                  <Select mode="multiple" options={tagOptions} placeholder="选择标签组" allowClear />
                </Form.Item>
                <Form.Item label="手动目标名（每行一个）" name="target_names_text">
                  <Input.TextArea rows={3} placeholder={`例如：
测试群A
测试群B`} />
                </Form.Item>
                <Form.Item label="单个目标群名（可选）" name="group_name"><Input /></Form.Item>
                <Form.Item label="新群名" name="new_group_name"><Input /></Form.Item>
                <Form.Item label="新群公告" name="new_group_announcement"><Input.TextArea rows={3} /></Form.Item>
                <Form.Item label="拉人名单（每行一个）" name="select_list_text"><Input.TextArea rows={3} /></Form.Item>
                <Form.Item label="拉人附带历史消息" name="show_message_history" valuePropName="checked"><Switch /></Form.Item>
                <Form.Item label="踢人名单（每行一个）" name="remove_list_text"><Input.TextArea rows={3} /></Form.Item>
                <Form.Item label="群备注" name="group_remark"><Input /></Form.Item>
                <Form.Item label="群模板" name="group_template"><Input /></Form.Item>
                <Button type="primary" htmlType="submit" loading={submitting}>下发修改群信息</Button>
              </Form>
            ),
          },
          {
            key: 'dissolve_group',
            label: '解散群',
            children: (
              <Form form={dissolveForm} layout="vertical" onFinish={() => void submitDissolveGroup()}>
                <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="需要群主权限，解散后不可撤销。" />
                <Form.Item label="群名/备注名" name="group_name" rules={[{ required: true, message: '请输入群名' }]}><Input /></Form.Item>
                <Button danger type="primary" htmlType="submit" loading={submitting}>下发解散群</Button>
              </Form>
            ),
          },
          {
            key: 'add_friend',
            label: '按手机号加好友',
            children: (
              <Form form={addFriendForm} layout="vertical" onFinish={() => void submitAddFriend()}>
                <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="请合理使用：按文档建议，单日总量控制在安全范围内。" />
                <Form.Item label="手机号" name="phone" rules={[{ required: true, message: '请输入手机号' }]}><Input /></Form.Item>
                <Form.Item label="备注名" name="mark_name"><Input /></Form.Item>
                <Form.Item label="备注其他信息" name="mark_extra"><Input /></Form.Item>
                <Form.Item label="标签（每行一个）" name="friend_tag_list_text"><Input.TextArea rows={3} /></Form.Item>
                <Form.Item label="附言" name="leaving_msg"><Input.TextArea rows={3} /></Form.Item>
                <Button type="primary" htmlType="submit" loading={submitting}>下发加好友</Button>
              </Form>
            ),
          },
          {
            key: 'clear_storage',
            label: '清理企微存储空间',
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Alert type="warning" showIcon message="该动作会向机器人发送清理企微存储空间指令，请确认机器人在线且目标账号允许执行。" />
                <Button danger type="primary" loading={submitting} onClick={() => void submitClearStorage()}>
                  下发清理企微存储空间
                </Button>
              </Space>
            ),
          },
        ]}
      />
    </Card>
  );
}
