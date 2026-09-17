import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button, Card, Descriptions, Result, Space, Spin, Tag, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

type SharedAuthorization = {
  corpId: string;
  corpName: string;
  agentId: string;
  deploymentType: 'all' | 'saas' | 'private';
  isEnabled: boolean;
  expireTime: string;
};

export default function EnterpriseSharePage() {
  const { pathname } = useLocation();
  const token = /^\/share\/enterprise\/([A-Za-z0-9_-]{43})\/?$/.exec(pathname)?.[1] || '';
  const [record, setRecord] = useState<SharedAuthorization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'missing' | 'unavailable' | ''>('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = '企业定制开通信息';
    const robots = document.querySelector('meta[name="robots"]');
    const previousRobots = robots?.getAttribute('content');
    robots?.setAttribute('content', 'noindex,nofollow,noarchive');
    return () => {
      document.title = previousTitle;
      if (previousRobots) robots?.setAttribute('content', previousRobots);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setRecord(null);
    setError('');
    setLoading(true);
    if (!token) { setError('missing'); setLoading(false); return; }
    const timer = window.setTimeout(() => controller.abort(), 20000);
    // Deliberately separate from the authenticated API client: no login redirects or credentials.
    fetch(`/api/v1/public/enterprise-authorization/${encodeURIComponent(token)}`, {
      signal: controller.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    }).then(async (response) => {
      if (!active) return;
      if (!response.ok) { setError(response.status === 404 ? 'missing' : 'unavailable'); return; }
      const data = await response.json();
      if (active) setRecord(data);
    }).catch(() => {
      if (active) setError('unavailable');
    }).finally(() => {
      window.clearTimeout(timer);
      if (active) setLoading(false);
    });
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [token, refresh]);

  const expiry = record?.expireTime && dayjs(record.expireTime).isValid()
    ? dayjs(record.expireTime).format('YYYY-MM-DD HH:mm:ss') : record?.expireTime || '-';
  return (
    <main style={{ minHeight: '100vh', padding: '48px 16px', background: '#f6f3ed' }}>
      <Card style={{ maxWidth: 760, margin: '0 auto' }}>
        <Typography.Text type="secondary">WorkTool</Typography.Text>
        <Typography.Title level={3}>企业定制开通信息</Typography.Title>
        {loading ? <div style={{ padding: '48px 0', textAlign: 'center' }}><Spin tip="正在加载授权信息"><div style={{ height: 48 }} /></Spin></div> : error ? (
          <Result status={error === 'missing' ? '404' : 'warning'}
            title={error === 'missing' ? '分享链接不存在或已失效' : '暂时无法加载授权信息'}
            subTitle={error === 'missing' ? '请联系提供链接的管理员获取有效链接。' : '请稍后重试。'}
            extra={error === 'unavailable' ? <Button onClick={() => setRefresh((value) => value + 1)}>重新加载</Button> : undefined} />
        ) : record ? (
          <Space direction="vertical" size={20} style={{ width: '100%' }}>
            <Descriptions bordered column={1} size="middle" styles={{ content: { overflowWrap: 'anywhere' } }}>
              <Descriptions.Item label="企业名称">{record.corpName || '-'}</Descriptions.Item>
              <Descriptions.Item label="CorpId">{record.corpId}</Descriptions.Item>
              <Descriptions.Item label="AgentId">{record.agentId || '-'}</Descriptions.Item>
              <Descriptions.Item label="部署类型">{record.deploymentType === 'private' ? 'Private' : record.deploymentType === 'saas' ? 'SaaS' : '全部'}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color={record.isEnabled ? 'green' : 'default'}>{record.isEnabled ? '启用' : '停用'}</Tag></Descriptions.Item>
              <Descriptions.Item label="到期时间">{expiry}</Descriptions.Item>
            </Descriptions>
            <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
              <Typography.Text type="secondary">此页面仅供查看，信息以最新保存的记录为准。</Typography.Text>
              <Button icon={<ReloadOutlined />} onClick={() => setRefresh((value) => value + 1)}>刷新信息</Button>
            </Space>
          </Space>
        ) : null}
      </Card>
    </main>
  );
}
