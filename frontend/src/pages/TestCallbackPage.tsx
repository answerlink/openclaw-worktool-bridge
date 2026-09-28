import { useEffect, useState } from 'react';
import { Button, Card, Descriptions, Input, Modal, Space, Table, Typography, message } from 'antd';
import { CopyOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '../api';

type CallbackRequest = {
  id: number;
  method: string;
  source_ip: string;
  content_type: string;
  query_string: string;
  body_text: string;
  received_at: string;
};

export default function TestCallbackPage() {
  const [url, setUrl] = useState('');
  const [items, setItems] = useState<CallbackRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<CallbackRequest | null>(null);

  const load = async (nextPage = page, nextPageSize = pageSize) => {
    setLoading(true);
    try {
      const result = await api.adminTestCallbackRequests({ page: nextPage, page_size: nextPageSize });
      setItems(result.items || []);
      setTotal(result.total || 0);
      setPage(nextPage);
      setPageSize(nextPageSize);
    } catch (error: any) {
      message.error(error?.response?.data?.detail || '加载回调记录失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api.adminTestCallbackAddress().then((result) => setUrl(result.url)).catch(() => message.error('获取测试回调地址失败'));
    void load(1, 20);
  }, []);

  const bodyForDisplay = (item: CallbackRequest) => {
    try { return JSON.stringify(JSON.parse(item.body_text), null, 2); }
    catch { return item.body_text || '(空)'; }
  };

  return <Card title="测试回调地址" extra={<Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新记录</Button>}>
    <Typography.Paragraph>将以下地址复制到机器人配置的消息回调、指令回调或上下线回调中。收到请求后会返回 HTTP 200，并记录最近 1000 条请求。</Typography.Paragraph>
    <Space.Compact style={{ maxWidth: '100%', marginBottom: 24 }}>
      <Input value={url} readOnly aria-label="测试回调地址" style={{ width: `${Math.max(url.length + 2, 48)}ch`, maxWidth: 'calc(100vw - 180px)' }} />
      <Button icon={<CopyOutlined />} disabled={!url} onClick={() => navigator.clipboard.writeText(url).then(() => message.success('已复制'))}>复制</Button>
    </Space.Compact>
    <Table<CallbackRequest>
      rowKey="id" loading={loading} dataSource={items} scroll={{ x: 850 }}
      pagination={{ current: page, pageSize, total, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: (n) => `共 ${n} 条`, onChange: (p, size) => void load(p, size) }}
      columns={[
        { title: '请求时间', dataIndex: 'received_at', width: 190 },
        { title: '请求方 IP', dataIndex: 'source_ip', width: 180 },
        { title: '方法', dataIndex: 'method', width: 90 },
        { title: '请求体', dataIndex: 'body_text', ellipsis: true, render: (value: string) => <Typography.Text>{value || '(空)'}</Typography.Text> },
        { title: '操作', width: 90, render: (_: unknown, item: CallbackRequest) => <Button type="link" onClick={() => setSelected(item)}>详情</Button> },
      ]}
    />
    <Modal title="回调请求详情" open={!!selected} onCancel={() => setSelected(null)} footer={null} width={800}>
      {selected && <>
        <Descriptions column={1} size="small" bordered items={[
          { key: 'time', label: '请求时间', children: selected.received_at },
          { key: 'ip', label: '请求方 IP', children: selected.source_ip },
          { key: 'method', label: '请求方法', children: selected.method },
          { key: 'type', label: 'Content-Type', children: selected.content_type || '-' },
          { key: 'query', label: '查询参数', children: selected.query_string || '-' },
        ]} />
        <Typography.Title level={5} style={{ marginTop: 20 }}>请求体</Typography.Title>
        <pre style={{ maxHeight: 440, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#f5f5f5', padding: 12 }}>{bodyForDisplay(selected)}</pre>
      </>}
    </Modal>
  </Card>;
}
