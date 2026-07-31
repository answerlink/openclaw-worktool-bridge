import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Input, Modal, Select, Space, Table, Tag, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { api } from '../api';
import HoverPreviewText from '../components/HoverPreviewText';

interface AuditLogRow {
  id: number;
  module: string;
  action_key: string;
  action_name: string;
  target_type: string;
  target_id: string;
  target_name: string;
  operator_phone: string;
  source_ip: string;
  before: any;
  after: any;
  upstream_path: string;
  status: 'pending' | 'success' | 'failed' | 'unknown';
  error_text: string;
  created_at: string;
  finished_at: string;
}

const moduleOptions = [
  { label: '全部模块', value: '' },
  { label: '企业定制开通', value: 'enterprise_authorization' },
  { label: '黑名单管理', value: 'ip_blacklist' },
  { label: '站内信配置', value: 'inbox' },
  { label: 'App 管理', value: 'app_update' },
  { label: '用户管理', value: 'user_management' },
  { label: '机器人更换', value: 'robot_migrate' },
  { label: '私有化授权', value: 'private_license' },
];

function statusTag(status: AuditLogRow['status']) {
  const color = status === 'success' ? 'green' : status === 'failed' ? 'red' : status === 'unknown' ? 'orange' : 'blue';
  const label = status === 'success' ? '成功' : status === 'failed' ? '失败' : status === 'unknown' ? '待核对' : '处理中';
  return <Tag color={color}>{label}</Tag>;
}

export default function AdminAuditLogPage() {
  const [module, setModule] = useState('');
  const [target, setTarget] = useState('');
  const [operatorPhone, setOperatorPhone] = useState('');
  const [status, setStatus] = useState<string>('');
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);

  const load = async (nextPage = page, nextPageSize = pageSize) => {
    setLoading(true);
    try {
      const res = await api.adminAuditLogs({
        module: module || undefined,
        target_id: target.trim() || undefined,
        target_name: target.trim() || undefined,
        operator_phone: operatorPhone.trim() || undefined,
        status: (status || undefined) as any,
        page: nextPage,
        page_size: nextPageSize,
      });
      setRows(res?.items || []);
      setTotal(Number(res?.total || 0));
      setPage(Number(res?.page || nextPage));
      setPageSize(Number(res?.page_size || nextPageSize));
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '加载审计日志失败');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(1, pageSize);
  }, []);

  const columns = useMemo(
    () => [
      { title: '时间', dataIndex: 'created_at', width: 180 },
      { title: '模块', dataIndex: 'module', width: 160 },
      { title: '动作', dataIndex: 'action_name', width: 150 },
      { title: '目标', width: 220, render: (_: unknown, row: AuditLogRow) => <HoverPreviewText value={row.target_name || row.target_id || '-'} maxWidth={200} popupWidth={680} /> },
      { title: '操作者', dataIndex: 'operator_phone', width: 140, render: (v: string) => v || '-' },
      { title: '来源 IP', dataIndex: 'source_ip', width: 140, render: (v: string) => v || '-' },
      { title: '结果', dataIndex: 'status', width: 100, render: (v: AuditLogRow['status']) => statusTag(v) },
      {
        title: '详情',
        width: 90,
        render: (_: unknown, row: AuditLogRow) => (
          <Button
            size="small"
            onClick={() => {
              Modal.info({
                title: `${row.action_name} - 审计详情`,
                width: 860,
                content: (
                  <pre style={{ margin: 0, maxHeight: '60vh', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {JSON.stringify({ before: row.before, after: row.after, upstream_path: row.upstream_path, error_text: row.error_text }, null, 2)}
                  </pre>
                ),
              });
            }}
          >
            查看
          </Button>
        ),
      },
    ],
    []
  );

  return (
    <Card title="管理员审计日志" extra={<Button icon={<ReloadOutlined />} onClick={() => void load(1, pageSize)}>刷新</Button>}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Select style={{ width: 180 }} value={module} options={moduleOptions} onChange={setModule} />
        <Input style={{ width: 220 }} value={target} placeholder="目标 ID 或名称" onChange={(e) => setTarget(e.target.value)} onPressEnter={() => void load(1, pageSize)} />
        <Input style={{ width: 160 }} value={operatorPhone} placeholder="操作者手机号" onChange={(e) => setOperatorPhone(e.target.value)} onPressEnter={() => void load(1, pageSize)} />
        <Select
          style={{ width: 130 }}
          value={status}
          options={[{ label: '全部结果', value: '' }, { label: '成功', value: 'success' }, { label: '失败', value: 'failed' }, { label: '待核对', value: 'unknown' }, { label: '处理中', value: 'pending' }]}
          onChange={setStatus}
        />
        <Button type="primary" onClick={() => void load(1, pageSize)}>查询</Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        scroll={{ x: 1180 }}
        columns={columns}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (value) => `共 ${value} 条`,
          onChange: (nextPage, nextPageSize) => void load(nextPage, nextPageSize),
        }}
      />
    </Card>
  );
}
