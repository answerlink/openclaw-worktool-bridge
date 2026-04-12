import { useEffect, useMemo, useState } from 'react';
import { Alert, Card, Col, Row, Space, Statistic, Tag, Typography } from 'antd';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api } from '../api';

interface TrendItem {
  date: string;
  inbound: number;
  outbound_success: number;
}

export default function DashboardPage() {
  const [overview, setOverview] = useState<any>(null);
  const [trends, setTrends] = useState<TrendItem[]>([]);

  useEffect(() => {
    api.getOverview().then(setOverview);
    api.getTrends(7).then((res) => setTrends(res.items || []));
  }, []);

  const stats = useMemo(
    () => [
      { title: '机器人总数', value: overview?.robots_total ?? 0 },
      { title: '今日入站消息', value: overview?.inbound_today ?? 0 },
      { title: '今日成功回复', value: overview?.outbound_success_today ?? 0 },
      { title: '发送失败率', value: `${((overview?.fail_rate ?? 0) * 100).toFixed(2)}%` }
    ],
    [overview]
  );

  return (
    <>
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space size={8} wrap>
          <Typography.Title level={5} style={{ margin: 0 }}>
            运营概览
          </Typography.Title>
          <Tag color="blue">当前统计来源：本平台消息处理库</Tag>
        </Space>
        <Alert
          type="info"
          showIcon
          message="若机器人绑定第三方消息回调，该机器人消息不会计入本页统计。"
          description="本页仅统计由本平台回调链路处理并入库的数据。"
        />
      </Space>
      <Row gutter={[16, 16]} style={{ marginTop: 8 }}>
        {stats.map((item) => (
          <Col span={6} key={item.title}>
            <Card>
              <Statistic title={item.title} value={item.value} />
            </Card>
          </Col>
        ))}
      </Row>

      <Card style={{ marginTop: 16 }} title="近7天消息趋势">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={trends}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="inbound" stroke="#1677ff" name="入站" />
            <Line type="monotone" dataKey="outbound_success" stroke="#52c41a" name="成功回复" />
          </LineChart>
        </ResponsiveContainer>
      </Card>
    </>
  );
}
