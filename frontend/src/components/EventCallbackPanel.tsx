import { useEffect, useState } from 'react';
import { Alert, Button, Input, Modal, Spin, Switch, Typography, message } from 'antd';
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
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    if (!robotId) { setLoading(false); return; }
    api.getRobotEventCallback(robotId).then((config) => {
      if (!active) return;
      setUrl(config.event_callback_url || '');
      setEnabled(config.enabled ?? true);
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

  const test = async () => {
    const target = url.trim() || messageUrl.trim();
    if (!target) { message.warning('请填写回调地址，或先配置消息回调地址'); return; }
    setTesting(true);
    onBusyChange(true);
    try {
      const result = await api.testRobotCallback2xx(target);
      message.success(result.request_sent ? '测试通过：已发送空请求并收到 HTTP 200' : '地址格式校验通过，未发送请求');
    } catch (e: any) {
      Modal.error({ title: '测试失败', content: e?.response?.data?.detail || e?.message || '未知错误' });
    } finally {
      setTesting(false);
      onBusyChange(false);
    }
  };

  if (error) return <Alert type="error" showIcon message={error} action={<Button onClick={() => setReload((v) => v + 1)}>重试</Button>} />;
  return <Spin spinning={loading}>
    <section aria-label="事件回调设置">
      <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 16 }}>
        接收机器人入群、群名变更、通过好友申请等事件及查询结果，使用 JSON 格式，便于触发业务流程。
      </Typography.Paragraph>
      <div className="callback-form-row">
        <label htmlFor="event-callback-enabled">启用回调</label>
        <div><Switch id="event-callback-enabled" aria-label="启用回调" checked={enabled} onChange={setEnabled}
          checkedChildren="开启" unCheckedChildren="关闭" disabled={disabled || loading || !robotId} /></div>
      </div>
      <div className="callback-form-row">
        <label htmlFor="event-callback-url">回调地址</label>
        <div>
          <Input id="event-callback-url" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={2048}
            placeholder="https://你的域名/callback（可留空）" disabled={disabled || loading || !robotId} />
          <Typography.Text type="secondary">留空沿用消息回调地址。</Typography.Text>
        </div>
      </div>
      <div className="callback-action-row">
        <Button type="primary" loading={saving} disabled={disabled || loading || !robotId} onClick={save}>保存设置</Button>
        <Button type="link" loading={testing} disabled={disabled || loading || !robotId} onClick={test}>测试回调地址</Button>
        <Button type="link" href="https://worktool.apifox.cn/doc-9564531" target="_blank" rel="noopener noreferrer">回调说明</Button>
      </div>
    </section>
  </Spin>;
}
