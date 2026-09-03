import { useEffect, useMemo, useState } from 'react';
import { CopyOutlined, DeleteOutlined, EyeOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Segmented, Select, Space, Table, Tag, Typography, message } from 'antd';
import { api } from '../api';

type OrderStatus = 'all' | 'unpaid' | 'pending_delivery' | 'delivered' | 'completed' | 'closed';

type ManualOrder = {
  id: number;
  order_no: string;
  customer_name: string;
  customer_contact?: string;
  company_name?: string;
  product_name: string;
  specification?: string;
  unit_price: number;
  quantity: number;
  amount: number;
  status: Exclude<OrderStatus, 'all'>;
  status_label: string;
  payment_method: string;
  ordered_at: string;
  paid_at?: string;
  remark?: string;
};

const statusOptions: { label: string; value: OrderStatus }[] = [
  { label: '全部', value: 'all' },
  { label: '未支付', value: 'unpaid' },
  { label: '待交付', value: 'pending_delivery' },
  { label: '已交付', value: 'delivered' },
  { label: '已完成', value: 'completed' },
  { label: '交易关闭', value: 'closed' },
];

const paymentLabels: Record<string, string> = {
  corporate_transfer: '对公转账', bank_card: '银行卡', wechat: '微信支付', alipay: '支付宝', balance: '余额支付', other: '其他',
};

const statusColors: Record<string, string> = {
  unpaid: 'gold', pending_delivery: 'cyan', delivered: 'blue', completed: 'green', closed: 'default',
};

function toDateTimeInput(value?: string) {
  if (!value) return '';
  return value.replace(' ', 'T').slice(0, 16);
}

function nowDateTimeInput() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function createOrderNo() {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}${Math.floor(1000 + Math.random() * 9000)}`;
}

function amountText(value: number) {
  return `￥${Number(value || 0).toFixed(2)}`;
}

export default function ManualOrderPage() {
  const [items, setItems] = useState<ManualOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<OrderStatus>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ManualOrder | null>(null);
  const [preview, setPreview] = useState<ManualOrder | null>(null);
  const [form] = Form.useForm();

  const load = async (nextPage = page, nextPageSize = pageSize) => {
    setLoading(true);
    try {
      const res = await api.adminManualOrders({ keyword: keyword.trim() || undefined, status, page: nextPage, page_size: nextPageSize });
      setItems(res?.items || []);
      setTotal(Number(res?.total || 0));
      setPage(Number(res?.page || nextPage));
      setPageSize(Number(res?.page_size || nextPageSize));
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || '加载线下订单失败');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(1, pageSize); }, [status]);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      order_no: createOrderNo(), customer_name: '', customer_contact: '', company_name: '', product_name: '', specification: '',
      unit_price: 0, quantity: 1, status: 'completed', payment_method: 'corporate_transfer', ordered_at: nowDateTimeInput(), paid_at: nowDateTimeInput(), remark: '',
    });
    setEditorOpen(true);
  };

  const openEdit = (item: ManualOrder) => {
    setEditing(item);
    form.setFieldsValue({ ...item, ordered_at: toDateTimeInput(item.ordered_at), paid_at: toDateTimeInput(item.paid_at) });
    setEditorOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const payload = { ...values, unit_price: Number(values.unit_price), quantity: Number(values.quantity), paid_at: values.paid_at || undefined };
      if (editing) await api.adminUpdateManualOrder(editing.id, payload);
      else await api.adminCreateManualOrder(payload);
      message.success(editing ? '订单登记已更新' : '线下订单已登记');
      setEditorOpen(false);
      await load(editing ? page : 1, pageSize);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const deleteOrder = async (item: ManualOrder) => {
    try {
      await api.adminDeleteManualOrder(item.id);
      message.success('订单登记已删除');
      await load(items.length === 1 && page > 1 ? page - 1 : page, pageSize);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || '删除失败');
    }
  };

  const previewDescriptions = useMemo(() => preview ? [
    ['订单编号', preview.order_no], ['订单状态', preview.status_label], ['客户名称', preview.customer_name], ['联系信息', preview.customer_contact || '-'],
    ['企业名称', preview.company_name || '-'], ['支付方式', paymentLabels[preview.payment_method] || preview.payment_method],
    ['下单时间', preview.ordered_at], ['支付时间', preview.paid_at || '-'],
  ] : [], [preview]);

  return (
    <Card
      title="线下订单登记"
      extra={<Space><Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button><Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增订单</Button></Space>}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="用于登记已核验的线下付款订单"
        description="订单由管理员人工登记，不与支付渠道订单自动同步；新增、修改和删除均会记录在管理员审计日志中。"
      />
      <Space wrap style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Segmented options={statusOptions} value={status} onChange={(v) => setStatus(v as OrderStatus)} />
        <Input.Search
          allowClear
          style={{ width: 320, maxWidth: '100%' }}
          placeholder="订单号、客户、企业或商品名称"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onSearch={() => void load(1, pageSize)}
        />
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        scroll={{ x: 1240 }}
        pagination={{ current: page, pageSize, total, showSizeChanger: true, showTotal: (n) => `共 ${n} 条`, onChange: (p, ps) => void load(p, ps) }}
        columns={[
          { title: '订单编号', dataIndex: 'order_no', width: 190, render: (value: string) => <Space size={4}><Typography.Text copyable={{ text: value }}>{value}</Typography.Text></Space> },
          { title: '客户 / 企业', width: 220, render: (_: unknown, row: ManualOrder) => <><div>{row.customer_name}</div><Typography.Text type="secondary">{row.company_name || row.customer_contact || '-'}</Typography.Text></> },
          { title: '商品', width: 235, render: (_: unknown, row: ManualOrder) => <><div>{row.product_name}</div><Typography.Text type="secondary">{row.specification || '-'}</Typography.Text></> },
          { title: '金额', width: 130, render: (_: unknown, row: ManualOrder) => <><Typography.Text strong>{amountText(row.amount)}</Typography.Text><br /><Typography.Text type="secondary">{amountText(row.unit_price)} x {row.quantity}</Typography.Text></> },
          { title: '状态', dataIndex: 'status_label', width: 105, render: (value: string, row: ManualOrder) => <Tag color={statusColors[row.status]}>{value}</Tag> },
          { title: '支付方式', width: 110, render: (_: unknown, row: ManualOrder) => paymentLabels[row.payment_method] || row.payment_method },
          { title: '下单 / 支付时间', width: 180, render: (_: unknown, row: ManualOrder) => <><div>{row.ordered_at}</div><Typography.Text type="secondary">{row.paid_at || '-'}</Typography.Text></> },
          { title: '操作', width: 200, fixed: 'right' as const, render: (_: unknown, row: ManualOrder) => <Space size={0}><Button type="link" icon={<EyeOutlined />} onClick={() => setPreview(row)}>预览</Button><Button type="link" onClick={() => openEdit(row)}>编辑</Button><Popconfirm title="删除订单登记" description="删除后无法恢复，确定继续吗？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => void deleteOrder(row)}><Button type="link" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm></Space> },
        ]}
      />

      <Modal title={editing ? '编辑线下订单' : '新增线下订单'} open={editorOpen} onCancel={() => setEditorOpen(false)} onOk={() => void submit()} confirmLoading={saving} okText="保存" width={760} destroyOnClose>
        <Form form={form} layout="vertical" preserve={false}>
          <div className="manual-order-form-grid">
            <Form.Item name="order_no" label="订单编号" rules={[{ required: true, message: '请输入订单编号' }]}><Input maxLength={64} /></Form.Item>
            <Form.Item name="status" label="订单状态" rules={[{ required: true }]}><Select options={statusOptions.filter((x) => x.value !== 'all')} /></Form.Item>
            <Form.Item name="customer_name" label="客户名称" rules={[{ required: true, message: '请输入客户名称' }]}><Input maxLength={128} /></Form.Item>
            <Form.Item name="customer_contact" label="联系信息"><Input placeholder="手机号、邮箱或机器人 ID" maxLength={128} /></Form.Item>
            <Form.Item name="company_name" label="企业名称"><Input maxLength={255} /></Form.Item>
            <Form.Item name="payment_method" label="支付方式" rules={[{ required: true }]}><Select options={Object.entries(paymentLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
            <Form.Item className="manual-order-form-wide" name="product_name" label="商品名称" rules={[{ required: true, message: '请输入商品名称' }]}><Input maxLength={255} /></Form.Item>
            <Form.Item className="manual-order-form-wide" name="specification" label="规格说明"><Input maxLength={255} /></Form.Item>
            <Form.Item name="unit_price" label="商品单价（元）" rules={[{ required: true, message: '请输入商品单价' }]}><InputNumber min={0} max={99999999.99} precision={2} style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="quantity" label="购买数量" rules={[{ required: true, message: '请输入购买数量' }]}><InputNumber min={1} max={99999} precision={0} style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="ordered_at" label="下单时间" rules={[{ required: true, message: '请选择下单时间' }]}><Input type="datetime-local" /></Form.Item>
            <Form.Item name="paid_at" label="支付时间"><Input type="datetime-local" /></Form.Item>
            <Form.Item className="manual-order-form-wide" name="remark" label="备注"><Input.TextArea rows={3} maxLength={1000} showCount /></Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal open={Boolean(preview)} footer={null} onCancel={() => setPreview(null)} width={820} className="manual-order-preview-modal" destroyOnClose>
        {preview ? <div className="manual-order-preview">
          <div className="manual-order-preview-head"><div><Typography.Title level={3}>订单详情</Typography.Title><Typography.Text type="secondary">线下人工登记</Typography.Text></div><Tag color="blue">{preview.status_label}</Tag></div>
          <div className="manual-order-preview-product"><Typography.Text type="secondary">商品名称</Typography.Text><Typography.Title level={4}>{preview.product_name}</Typography.Title>{preview.specification ? <Typography.Text>{preview.specification}</Typography.Text> : null}</div>
          <Descriptions bordered column={2} size="middle">{previewDescriptions.map(([label, value]) => <Descriptions.Item key={label} label={label}>{value}</Descriptions.Item>)}</Descriptions>
          <div className="manual-order-preview-total"><Typography.Text type="secondary">订单金额</Typography.Text><Typography.Title level={2}>{amountText(preview.amount)}</Typography.Title><Typography.Text type="secondary">{amountText(preview.unit_price)} x {preview.quantity}</Typography.Text></div>
          {preview.remark ? <div className="manual-order-preview-remark"><Typography.Text type="secondary">备注</Typography.Text><div>{preview.remark}</div></div> : null}
          <div className="manual-order-preview-foot"><Typography.Text type="secondary">本订单为线下人工登记记录</Typography.Text><Space><Button icon={<CopyOutlined />} onClick={() => navigator.clipboard.writeText(preview.order_no).then(() => message.success('订单编号已复制'))}>复制订单号</Button><Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>打印</Button></Space></div>
        </div> : null}
      </Modal>
    </Card>
  );
}
