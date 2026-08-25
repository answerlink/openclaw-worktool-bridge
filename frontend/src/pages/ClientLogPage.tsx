import { useState } from 'react';
import { Alert, Button, Card, Descriptions, Input, Space, Spin, Typography, message } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { api } from '../api';

type QueryResult = {
  status: 'success' | 'timeout';
  message_id: string;
  robot_id: string;
  attempts: number;
  elapsed_seconds: number;
  data?: unknown;
};

export default function ClientLogPage() {
  const [messageId, setMessageId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);

  const query = async () => {
    const value = messageId.trim();
    if (!value) {
      message.warning('请输入 messageId');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      let data = await api.requestClientLogSnippet(value);
      if (data?.status === 'pending') {
        for (let attempt = 1; attempt <= 12; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 5000));
          data = await api.getClientLogSnippetDetail(value, String(data.robot_id || ''));
          if (data?.status === 'success') {
            data = { ...data, attempts: attempt, elapsed_seconds: attempt * 5 };
            break;
          }
          if (attempt === 12) {
            data = { ...data, status: 'timeout', attempts: attempt, elapsed_seconds: attempt * 5 };
          }
        }
      } else {
        data = { ...data, attempts: 0, elapsed_seconds: 0 };
      }
      setResult(data);
      if (data?.status === 'success') message.success('客户端日志获取成功');
      else message.warning('等待 60 秒仍未收到客户端日志');
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || '客户端日志查询失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="客户端日志查询">
        <Space.Compact style={{ width: '100%', maxWidth: 680 }}>
          <Input
            value={messageId}
            onChange={(e) => setMessageId(e.target.value)}
            onPressEnter={() => void query()}
            placeholder="请输入指令 messageId"
            disabled={loading}
          />
          <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => void query()}>
            查询
          </Button>
        </Space.Compact>
        <Typography.Paragraph type="secondary" style={{ marginTop: 10, marginBottom: 0 }}>
          系统会根据 messageId 从 WorkTool 指令记录中反查机器人，并等待客户端回传日志，最长等待 60 秒。
        </Typography.Paragraph>
      </Card>

      {loading ? (
        <Card>
          <Space><Spin size="small" />正在请求客户端日志，最长等待 60 秒，请勿重复提交。</Space>
        </Card>
      ) : null}

      {result ? (
        <Card title="查询结果">
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="状态">
              {result.status === 'success' ? <Alert type="success" showIcon message="已收到客户端日志" /> : <Alert type="warning" showIcon message="查询超时" />}
            </Descriptions.Item>
            <Descriptions.Item label="机器人 ID">{result.robot_id}</Descriptions.Item>
            <Descriptions.Item label="Message ID">{result.message_id}</Descriptions.Item>
            <Descriptions.Item label="轮询次数">{result.attempts}</Descriptions.Item>
            <Descriptions.Item label="耗时（秒）">{result.elapsed_seconds}</Descriptions.Item>
          </Descriptions>
          {result.status === 'timeout' ? (
            <Alert
              style={{ marginTop: 12 }}
              type="warning"
              showIcon
              message="客户端未在 60 秒内回传日志"
              description="请确认机器人在线、客户端版本支持该功能，并检查 messageId 是否对应正确的指令。"
            />
          ) : null}
          <Typography.Title level={5} style={{ marginTop: 18 }}>原始返回</Typography.Title>
          <pre style={{ maxHeight: 600, overflow: 'auto', whiteSpace: 'pre-wrap', background: '#f7f7f7', padding: 12, borderRadius: 4 }}>
            {JSON.stringify(result.data ?? {}, null, 2)}
          </pre>
        </Card>
      ) : null}
    </Space>
  );
}
