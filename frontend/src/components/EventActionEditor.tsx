import { Button, Card, Form, Input, Select, Space, Switch, Typography } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined } from '@ant-design/icons';
import { actionNames, defaultEventAction } from '../eventActionConfig';

export default function EventActionEditor({ index, kind, count, remove, move }: {
  index: number; kind: number; count: number; remove: () => void; move: (to: number) => void;
}) {
  const form = Form.useFormInstance();
  const value = Form.useWatch(['actions', index], form) || {};
  const action = value.action || 'send_text';
  const target = value.target || 'source';
  const groupAction = action === 'create_external_group' || action === 'update_group';
  const sourceAvailable = ![-1, -2, 103, 104].includes(kind) && !(kind === 105 && action === 'update_group');
  const variables = [['currentDate', '日期'], ...(kind === 105 ? [['friendName', '联系人名称'], ['friendRemark', '联系人备注']] : kind > 0 ? [['groupName', '群名'], ['groupRemark', '群备注']] : [])];
  const insert = (field: string, variable: string) => form.setFieldValue(['actions', index, field], (form.getFieldValue(['actions', index, field]) || '') + `{{${variable}}}`);
  const variableButtons = (field: string) => <Space wrap style={{ marginBottom: 12 }}>{variables.map(([v, label]) => <Button size="small" key={v} onClick={() => insert(field, v)}>插入{label}</Button>)}</Space>;
  return <Card size="small" title={`动作 ${index + 1}`} style={{ marginBottom: 16 }} extra={<Space size={4}>
    <Button size="small" aria-label={`上移动作${index + 1}`} icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => move(index - 1)} />
    <Button size="small" aria-label={`下移动作${index + 1}`} icon={<ArrowDownOutlined />} disabled={index === count - 1} onClick={() => move(index + 1)} />
    <Button size="small" danger aria-label={`删除动作${index + 1}`} icon={<DeleteOutlined />} disabled={count === 1} onClick={remove} />
  </Space>}>
    <Form.Item name={[index, 'action']} label="执行什么动作" rules={[{ required: true }]}><Select options={Object.entries(actionNames).map(([value, label]) => ({ value, label }))}
      onChange={next => form.setFieldValue(['actions', index], defaultEventAction(kind, next))} /></Form.Item>
    {action !== 'create_external_group' && <>
      <Form.Item name={[index, 'target']} label={action === 'update_group' ? '操作哪个群' : '发送到哪里'}><Select options={[
        ...(sourceAvailable ? [{ value: 'source', label: kind === 105 ? '事件中的联系人' : '事件发生的群' }] : []),
        { value: 'fixed', label: action === 'update_group' ? '指定群聊' : '指定群或联系人' },
      ]} /></Form.Item>
      {target === 'fixed' && <Form.Item name={[index, 'target_names']} label="目标名称或备注名" rules={[{ required: true, message: '请填写目标名称' }]} extra="输入后按回车，最多20个；支持使用事件变量，例如 {{friendName}}的服务群。"><Select mode="tags" open={false} /></Form.Item>}
    </>}
    {action === 'send_text' && <>
      <Form.Item name={[index, 'content']} label="发送内容" rules={[{ required: true, whitespace: true, message: '请输入发送内容' }]}><Input.TextArea rows={3} maxLength={2000} showCount /></Form.Item>
      {variableButtons('content')}
    </>}
    {action === 'send_file' && <>
      <Form.Item name={[index, 'object_name']} label="文件名称" rules={[{ required: true, whitespace: true }]}><Input maxLength={128} placeholder="例如：欢迎指南.pdf" /></Form.Item>
      <Form.Item name={[index, 'file_url']} label="文件下载地址" rules={[{ required: true }, { type: 'url', message: '请输入有效的文件下载地址' }]}><Input placeholder="https://…" maxLength={2048} /></Form.Item>
      <Form.Item name={[index, 'file_type']} label="文件类型" extra="图片填写 image；其他文件可保留 *。"><Input maxLength={32} /></Form.Item>
      <Form.Item name={[index, 'extra_text']} label="附带文本消息（可选）"><Input.TextArea rows={3} maxLength={2000} showCount /></Form.Item>
      {variableButtons('extra_text')}
    </>}
    {action === 'create_external_group' && <>
      <Form.Item name={[index, 'group_name']} label="新群名称" rules={[{ required: true, whitespace: true }]}><Input maxLength={128} /></Form.Item>
      {variableButtons('group_name')}
      <Form.Item name={[index, 'group_announcement']} label="群公告（可选）"><Input.TextArea maxLength={2000} rows={2} /></Form.Item>
      <Form.Item name={[index, 'group_remark']} label="群备注（可选）"><Input maxLength={128} /></Form.Item>
    </>}
    {groupAction && <>
      {kind === 105 && <Form.Item name={[index, 'include_event_friend']} label="拉入本次通过申请的联系人" valuePropName="checked"><Switch /></Form.Item>}
      <Form.Item name={[index, 'extra_members']} label={kind === 105 ? '同时拉入的其他成员（可选）' : '拉入的成员（可选）'} extra="填写联系人名称或备注，输入后按回车；支持事件变量。"><Select mode="tags" open={false} /></Form.Item>
    </>}
    {action === 'update_group' && <>
      <Form.Item name={[index, 'new_group_name']} label="新群名（可选）"><Input maxLength={128} /></Form.Item>
      <Form.Item name={[index, 'new_group_announcement']} label="新群公告（可选）"><Input.TextArea maxLength={2000} rows={2} /></Form.Item>
      <Form.Item name={[index, 'group_remark']} label="新群备注（可选）"><Input maxLength={128} /></Form.Item>
      <Form.Item name={[index, 'show_message_history']} label="拉人时展示历史消息" valuePropName="checked"><Switch /></Form.Item>
      <Typography.Paragraph type="secondary">至少填写一项群修改内容或拉人成员。</Typography.Paragraph>
    </>}
  </Card>;
}
