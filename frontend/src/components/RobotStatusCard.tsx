import { Alert, Card, Descriptions, Empty, Tag } from 'antd';
import dayjs from 'dayjs';

function formatLoginTime(value: unknown): string {
  if (value === null || value === undefined || value === '' || value === '-') return '-';
  const raw = String(value).trim();
  const date = dayjs(/^\d+$/.test(raw) ? Number(raw) : raw);
  return date.isValid() ? date.format('YYYY-MM-DD HH:mm:ss') : '-';
}

export default function RobotStatusCard({ status, loading = false, error = '' }: {
  status: Record<string, unknown> | null;
  loading?: boolean;
  error?: string;
}) {
  return (
    <Card title="机器人状态" loading={loading}>
      {error ? <Alert type="warning" showIcon message="机器人状态获取失败" description={error} /> :
        status && Object.keys(status).length ? (
          <Descriptions column={{ xs: 1, sm: 1, md: 2 }} size="small" bordered>
            {Object.entries(status).map(([key, value]) => (
              <Descriptions.Item key={key} label={key}>
                {typeof value === 'boolean' ? <Tag color={value ? 'blue' : 'red'}>{value ? '是' : '否'}</Tag>
                  : key === '最近登录' ? formatLoginTime(value) : String(value ?? '-')}
              </Descriptions.Item>
            ))}
          </Descriptions>
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无机器人状态" />}
    </Card>
  );
}
