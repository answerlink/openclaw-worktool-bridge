import { useEffect, useState } from 'react';
import { Alert, Button, Input, Space, Spin, Switch, Tag, Typography, message } from 'antd';
import { api } from '../api';

interface Props {
  robotId?: string;
  messageUrl: string;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onSaved: () => Promise<void>;
}

export default function EventCallbackPanel({ robotId, messageUrl, disabled, onBusyChange, onSaved }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [url, setUrl] = useState('');
  const [savedEnabled, setSavedEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    if (!robotId) { setLoading(false); return; }
    api.getRobotEventCallback(robotId).then((config) => {
      if (!active) return;
      setUrl(config.event_callback_url || '');
      setEnabled(config.enabled ?? true);
      setSavedEnabled(config.enabled);
    }).catch((e) => {
      if (active) setError(e?.response?.data?.detail || '读取事件回调配置失败');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [robotId, reload]);

  const save = async () => {
    if (!robotId || loading || error) return;
    const target = url.trim();
    if (target) {
      try {
        const parsed = new URL(target);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
      } catch {
        message.warning('请输入有效的 HTTP 或 HTTPS 回调地址');
        return;
      }
    }
    if (enabled && !target && !messageUrl.trim()) {
      message.warning('请填写事件回调地址，或先配置消息回调地址');
      return;
    }
    setSaving(true);
    onBusyChange(true);
    try {
      await api.saveRobotEventCallback(robotId, target, enabled);
      setSavedEnabled(enabled);
      setUrl(target);
      message.success('事件回调设置已保存');
      await onSaved();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '保存事件回调失败');
    } finally {
      setSaving(false);
      onBusyChange(false);
    }
  };

  if (error) return <Alert type="error" showIcon message={error} action={<Button onClick={() => setReload((v) => v + 1)}>重试</Button>} />;
  return <Spin spinning={loading}>
    <section className="event-callback-panel" aria-label="事件回调设置">
      <div className="event-callback-heading">
        <div>
          <Typography.Text strong>事件回调</Typography.Text>
          <Tag color={savedEnabled === null ? 'default' : savedEnabled ? 'green' : 'default'}>
            {savedEnabled === null ? '未单独配置' : savedEnabled ? '已开启' : '已关闭'}
          </Tag>
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
            接收群成员、联系人、会议等业务事件，以及机器人上线和下线事件，使用 JSON 格式。
          </Typography.Paragraph>
        </div>
        <Switch aria-label="开启事件回调" checked={enabled} onChange={setEnabled}
          checkedChildren="开启" unCheckedChildren="关闭" disabled={disabled || loading || !robotId} />
      </div>
      <label className="callback-field-label" htmlFor="event-callback-url">事件回调地址</label>
      <Input id="event-callback-url" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={2048}
        placeholder="https://你的域名/callback/events（可留空）" disabled={disabled || loading || !robotId} />
      <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
        留空沿用消息回调地址。图片仍发送到消息回调；上下线通知可另外配置，同时接收。
      </Typography.Paragraph>
      <Space wrap>
        <Button type="primary" loading={saving} disabled={disabled || loading || !robotId} onClick={save}>保存事件设置</Button>
        <Typography.Text type="secondary">修改后点击保存生效。</Typography.Text>
      </Space>
    </section>
  </Spin>;
}
