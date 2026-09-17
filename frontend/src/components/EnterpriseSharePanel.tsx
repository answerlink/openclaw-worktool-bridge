import { useEffect, useState } from 'react';
import { Alert, Button, Input, Popconfirm, Space, Spin, Typography, message } from 'antd';
import { CopyOutlined, LinkOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { api } from '../api';

type Share = { enabled: boolean; path: string };

export default function EnterpriseSharePanel({ corpId, onChanged }: { corpId: string; onChanged: () => void }) {
  const [share, setShare] = useState<Share | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.adminEnterpriseShareGet(corpId).then((data) => {
      if (active) setShare(data);
    }).catch(() => {
      if (active) setError('分享状态加载失败，请重试');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [corpId, retry]);

  const change = async (action: 'create' | 'rotate' | 'revoke') => {
    setBusy(true);
    try {
      const data = action === 'revoke'
        ? await api.adminEnterpriseShareRevoke(corpId)
        : await api.adminEnterpriseShareCreate(corpId, action === 'rotate');
      setShare(data);
      message.success(action === 'revoke' ? '分享已关闭，旧链接已失效' : action === 'rotate' ? '分享链接已更新，旧链接已失效' : '分享链接已生成');
      onChanged();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '操作失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  const url = share?.path ? `${window.location.origin}${share.path}` : '';
  return (
    <section style={{ borderTop: '1px solid #e8e8e8', paddingTop: 16 }} aria-label="分享链接">
      <Typography.Text strong>分享链接</Typography.Text>
      <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
        客户无需登录，仅可查看此条已保存的授权信息，不展示备注。链接长期有效，可随时关闭。
      </Typography.Paragraph>
      {loading ? <Spin size="small" /> : error ? (
        <Alert type="error" message={error} action={<Button size="small" onClick={() => setRetry((value) => value + 1)}>重试</Button>} />
      ) : share?.enabled ? (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input value={url} readOnly aria-label="企业授权分享链接" onFocus={(event) => event.target.select()} />
          <Space wrap>
            <Button icon={<CopyOutlined />} onClick={async () => {
              try { await navigator.clipboard.writeText(url); message.success('分享链接已复制'); }
              catch { message.info('请选中上方链接手动复制'); }
            }}>复制链接</Button>
            <Button icon={<LinkOutlined />} href={url} target="_blank" rel="noopener noreferrer">预览</Button>
            <Popconfirm title="重新生成后，旧链接将立即失效，确认继续？" onConfirm={() => change('rotate')} disabled={busy}>
              <Button icon={<ReloadOutlined />} disabled={busy}>重新生成</Button>
            </Popconfirm>
            <Popconfirm title="关闭后，客户将无法通过当前链接查看，确认关闭？" onConfirm={() => change('revoke')} disabled={busy}>
              <Button danger icon={<StopOutlined />} disabled={busy}>关闭分享</Button>
            </Popconfirm>
          </Space>
        </Space>
      ) : <Button icon={<LinkOutlined />} loading={busy} onClick={() => void change('create')}>生成分享链接</Button>}
    </section>
  );
}
