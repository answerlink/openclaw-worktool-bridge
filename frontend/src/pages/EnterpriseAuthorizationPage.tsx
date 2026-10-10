import { useEffect, useMemo, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { Alert, Button, Card, Checkbox, DatePicker, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import { CopyOutlined, DownloadOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '../api';
import HoverPreviewText from '../components/HoverPreviewText';
import EnterpriseSharePanel from '../components/EnterpriseSharePanel';

interface AuthRow {
  corpId: string;
  tags?: { id: number; name: string }[];
  corpName?: string;
  agentId?: string;
  isEnabled?: boolean;
  expireTime?: string;
  createdAt?: string;
  remark?: string;
  deploymentType?: 'all' | 'saas' | 'private';
}

interface EnterpriseAuditRow {
  id: number;
  action_name: string;
  target_id: string;
  target_name: string;
  operator_phone: string;
  status: 'pending' | 'success' | 'failed' | 'unknown';
  before: any;
  after: any;
  upstream_path: string;
  error_text: string;
  created_at: string;
}

interface PrivateLicenseLogRow {
  id: number;
  operator_phone: string;
  machine_code: string;
  license_version: 1 | 2;
  remark: string;
  expire_date: string;
  expire_epoch_ms: number;
  restrict_robot: boolean;
  robot_start: string;
  robot_end: string;
  robot_limit?: number | null;
  created_at: string;
}

const MAX_ROBOT_SCOPE = 100000;

function pickRows(res: any): AuthRow[] {
  const data = res?.data;
  if (Array.isArray(data)) return data as AuthRow[];
  if (Array.isArray(data?.list)) return data.list as AuthRow[];
  if (Array.isArray(data?.records)) return data.records as AuthRow[];
  if (Array.isArray(res?.list)) return res.list as AuthRow[];
  return [];
}

function calculateRobotLimit(startText: string, endText: string) {
  if (!/^\d+$/.test(startText) || !/^\d+$/.test(endText)) {
    throw new Error('机器人 ID 范围必须是数字。');
  }
  if (startText.length !== endText.length) {
    throw new Error('起始和结束机器人 ID 位数必须一致。');
  }
  const start = Number(startText);
  const end = Number(endText);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
    throw new Error('机器人 ID 数字过大。');
  }
  if (end < start) {
    throw new Error('结束机器人 ID 不能小于起始机器人 ID。');
  }
  const limit = end - start + 1;
  if (limit > MAX_ROBOT_SCOPE) {
    throw new Error(`机器人 ID 范围过大，最多 ${MAX_ROBOT_SCOPE} 个。`);
  }
  return limit;
}

function compareText(left: unknown, right: unknown) {
  return String(left ?? '').localeCompare(String(right ?? ''), 'zh-CN');
}

function PrivateLicenseGenerator() {
  const [form] = Form.useForm();
  const [output, setOutput] = useState('');
  const [status, setStatus] = useState<{ type: 'info' | 'success' | 'error'; text: string }>({
    type: 'info',
    text: '等待输入。',
  });
  const [logs, setLogs] = useState<PrivateLicenseLogRow[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedVersion, setGeneratedVersion] = useState<1 | 2>(2);
  const licenseVersion = Form.useWatch('licenseVersion', form);
  const restrictRobot = Form.useWatch('restrictRobot', form);
  const robotStart = Form.useWatch('robotStart', form);
  const robotEnd = Form.useWatch('robotEnd', form);
  const restrictRobotEnabled = restrictRobot !== false;

  const scopeCount = useMemo(() => {
    if (!restrictRobotEnabled) return '不限制';
    try {
      return String(calculateRobotLimit(String(robotStart || '').trim(), String(robotEnd || '').trim()));
    } catch {
      return '-';
    }
  }, [restrictRobotEnabled, robotStart, robotEnd]);

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      const res = await api.adminPrivateLicenseLogs(10);
      setLogs(res?.items || []);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '加载授权生成记录失败');
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    void loadLogs();
  }, []);

  const generate = async () => {
    setGenerating(true);
    try {
      const values = await form.validateFields();
      const machine = String(values.machineCode || '').trim();
      if (!/^[0-9a-fA-F]{64}$/.test(machine)) {
        throw new Error('机器码格式不正确，应为 64 位十六进制字符串。');
      }
      const expireDate = values.expireDate as Dayjs | undefined;
      if (!expireDate) {
        throw new Error('请选择到期日期。');
      }

      const expireEpochMs = Date.parse(`${expireDate.format('YYYY-MM-DD')}T23:59:59Z`);
      if (!Number.isFinite(expireEpochMs)) {
        throw new Error('到期日期格式不正确。');
      }

      let scopeText = '不限制';
      let robotLimit: number | undefined;
      let start = '';
      let end = '';
      if (values.restrictRobot) {
        start = String(values.robotStart || '').trim();
        end = String(values.robotEnd || '').trim();
        robotLimit = calculateRobotLimit(start, end);
        scopeText = `${start}-${end}，数量 ${robotLimit}`;
      }

      const result = await api.adminPrivateLicenseGenerate({
        license_version: values.licenseVersion === 1 ? 1 : 2,
        machine_code: machine,
        remark: String(values.remark || '').trim(),
        expire_date: expireDate.format('YYYY-MM-DD'),
        expire_epoch_ms: expireEpochMs,
        restrict_robot: Boolean(values.restrictRobot),
        robot_start: start || undefined,
        robot_end: end || undefined,
        robot_limit: robotLimit,
      });
      const licenseText = String(result?.license_text || '');
      if (!licenseText) {
        throw new Error('服务端未返回 license 文本。');
      }
      setOutput(licenseText);
      const resultVersion = result?.license_version === 1 ? 1 : 2;
      setGeneratedVersion(resultVersion);
      setStatus({ type: 'success', text: `V${resultVersion} 生成成功。到期时间戳：${expireEpochMs}；机器人范围：${scopeText}。` });
      void loadLogs();
    } catch (e: any) {
      setOutput('');
      setStatus({
        type: 'error',
        text: e?.errorFields ? '请检查表单必填项。' : e?.response?.data?.detail || e?.message || String(e),
      });
    } finally {
      setGenerating(false);
    }
  };

  const copyText = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setStatus({ type: 'success', text: '已复制 license 文本。' });
    } catch {
      setStatus({ type: 'error', text: '复制失败，请手动复制输出内容。' });
    }
  };

  const downloadLicense = () => {
    if (!output) return;
    const blob = new Blob([output], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'license.lic';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus({ type: 'success', text: '已下载 license.lic。' });
  };

  const setExpireShortcut = (amount: number, unit: 'month' | 'year') => {
    form.setFieldsValue({ expireDate: dayjs().add(amount, unit) });
  };

  const setRobotScopeCount = (count: number) => {
    const startText = String(form.getFieldValue('robotStart') || '20260001').trim();
    if (!/^\d+$/.test(startText)) {
      setStatus({ type: 'error', text: '请先输入数字格式的起始机器人 ID。' });
      return;
    }
    const start = Number(startText);
    if (!Number.isSafeInteger(start)) {
      setStatus({ type: 'error', text: '起始机器人 ID 数字过大。' });
      return;
    }
    const endText = String(start + count - 1).padStart(startText.length, '0');
    form.setFieldsValue({
      restrictRobot: true,
      robotStart: startText,
      robotEnd: endText,
    });
  };

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Typography.Text type="secondary">
        默认生成 RSA 签名的 V2 授权；V1 仅用于尚未升级 lic2 的旧版服务。机器码从私有化服务启动日志里的 MACHINE_CODE 复制。
      </Typography.Text>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          licenseVersion: 2,
          expireDate: dayjs().add(1, 'year'),
          restrictRobot: true,
          robotStart: '20260001',
          robotEnd: '20260300',
        }}
      >
        <Form.Item name="licenseVersion" label="授权格式" rules={[{ required: true }]}>
          <Select
            style={{ width: 360 }}
            options={[
              { value: 2, label: 'V2 - RSA-SHA256 签名（推荐）' },
              { value: 1, label: 'V1 - AES 对称加密（旧版兼容）' },
            ]}
          />
        </Form.Item>
        <Form.Item name="machineCode" label="机器码 MACHINE_CODE" rules={[{ required: true, message: '请输入机器码' }]}>
          <Input placeholder="例如：565d240f5343e625ae579a4d45a770f1f02c6368b5ed4d06da4fbe6f47c28866" autoComplete="off" />
        </Form.Item>
        <Form.Item name="remark" label="备注" rules={[{ required: true, message: '请填写备注，注明客户及用途' }, { max: 255, message: '备注不能超过 255 个字符' }]}>
          <Input.TextArea rows={2} placeholder="例如：客户A，正式环境，用于生产部署" maxLength={255} showCount />
        </Form.Item>
        <Space size={16} align="start" wrap style={{ width: '100%' }}>
          <Form.Item label="到期日期" required>
            <Space.Compact>
              <Form.Item name="expireDate" noStyle rules={[{ required: true, message: '请选择到期日期' }]}>
                <DatePicker format="YYYY-MM-DD" style={{ width: 220 }} />
              </Form.Item>
              <Button htmlType="button" onClick={() => setExpireShortcut(1, 'month')}>一个月</Button>
              <Button htmlType="button" onClick={() => setExpireShortcut(1, 'year')}>一年</Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item name="restrictRobot" label="机器人 ID 范围" valuePropName="checked">
            <Checkbox>启用私有化号段限制</Checkbox>
          </Form.Item>
        </Space>
        <Space size={16} align="start" wrap>
          <Form.Item name="robotStart" label="起始机器人 ID">
            <Input disabled={!restrictRobotEnabled} style={{ width: 220 }} inputMode="numeric" autoComplete="off" />
          </Form.Item>
          <Form.Item name="robotEnd" label="结束机器人 ID">
            <Input disabled={!restrictRobotEnabled} style={{ width: 220 }} inputMode="numeric" autoComplete="off" />
          </Form.Item>
        </Space>
        <Form.Item label="快捷设置号段数量">
          <Space wrap>
            <Button htmlType="button" disabled={!restrictRobotEnabled} onClick={() => setRobotScopeCount(3)}>3 个</Button>
            <Button htmlType="button" disabled={!restrictRobotEnabled} onClick={() => setRobotScopeCount(300)}>300 个</Button>
            <Button htmlType="button" disabled={!restrictRobotEnabled} onClick={() => setRobotScopeCount(1000)}>1000 个</Button>
          </Space>
        </Form.Item>
        <Space wrap>
          <Button type="primary" loading={generating} onClick={() => void generate()}>
            生成 license
          </Button>
          <Button icon={<CopyOutlined />} disabled={!output} onClick={() => void copyText()}>
            复制文本
          </Button>
          <Button icon={<DownloadOutlined />} disabled={!output} onClick={downloadLicense}>
            下载 license.lic
          </Button>
        </Space>
      </Form>
      <Alert type={status.type} message={status.text} showIcon />
      <Input.TextArea
        value={output}
        readOnly
        rows={7}
        placeholder="生成后这里会显示 license.lic 文件内容"
        style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12 }}
      />
      <Table
        size="small"
        pagination={false}
        showHeader={false}
        rowKey="name"
        columns={[
          { dataIndex: 'name', width: 160 },
          { dataIndex: 'value' },
        ]}
        dataSource={[
          {
            name: '文件格式',
            value: (output ? generatedVersion : licenseVersion) === 1
              ? '{"v":1,"data":"..."}'
              : '{"v":2,"alg":"RS256","kid":"...","payload":"...","signature":"..."}',
          },
          {
            name: '算法',
            value: (output ? generatedVersion : licenseVersion) === 1
              ? 'AES/ECB/PKCS5Padding'
              : 'RSA-SHA256（RS256）',
          },
          { name: '号段数量', value: scopeCount },
          { name: '输出文件名', value: 'license.lic' },
        ]}
      />
      <Typography.Title level={5} style={{ margin: '8px 0 0' }}>最近10条生成记录</Typography.Title>
      <Table
        rowKey="id"
        size="small"
        loading={logsLoading}
        dataSource={logs}
        pagination={false}
        scroll={{ x: 1100 }}
        columns={[
          { title: '时间', dataIndex: 'created_at', width: 180, render: (v: string) => v || '-' },
          { title: '操作者', dataIndex: 'operator_phone', width: 140, render: (v: string) => v || '-' },
          { title: '格式', dataIndex: 'license_version', width: 90, render: (v: number) => <Tag color={v === 2 ? 'blue' : 'default'}>V{v || 1}</Tag> },
          {
            title: '机器码',
            dataIndex: 'machine_code',
            width: 260,
            render: (v: string) => <HoverPreviewText value={v || '-'} maxWidth={240} popupWidth={760} />,
          },
          { title: '到期日期', dataIndex: 'expire_date', width: 130, render: (v: string) => v || '-' },
          { title: '备注', dataIndex: 'remark', width: 240, render: (v: string) => <HoverPreviewText value={v || '-'} maxWidth={220} popupWidth={640} /> },
          {
            title: '机器人范围',
            width: 260,
            render: (_: any, row: PrivateLicenseLogRow) => (
              row.restrict_robot ? `${row.robot_start || '-'} - ${row.robot_end || '-'}（${row.robot_limit || '-'} 个）` : '不限制'
            ),
          },
        ]}
      />
    </Space>
  );
}

export function PrivateLicenseAuthorizationPage() {
  return (
    <Card title="私有化授权">
      <PrivateLicenseGenerator />
    </Card>
  );
}

export default function EnterpriseAuthorizationPage() {
  const [tags, setTags] = useState<{ id: number; name: string }[]>([]);
  const [tagFilter, setTagFilter] = useState('all');
  const [selectedCorps, setSelectedCorps] = useState<string[]>([]);
  const [manageTagsOpen, setManageTagsOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [tagNames, setTagNames] = useState<Record<number, string>>({});
  const [tagBusy, setTagBusy] = useState(false);
  const [assignment, setAssignment] = useState<{ corpIds: string[]; operation: 'add' | 'remove' | 'replace' } | null>(null);
  const [assignmentTags, setAssignmentTags] = useState<number[]>([]);
  const loadTags = async () => {
    try {
      const result = await api.enterpriseTags();
      setTags(result);
      setTagNames(Object.fromEntries(result.map((t) => [t.id, t.name])));
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '加载标签失败');
    }
  };
  const editTags = (row: AuthRow) => {
    setAssignment({ corpIds: [row.corpId], operation: 'replace' });
    setAssignmentTags((row.tags || []).map((t) => t.id));
  };
  const changeTag = async (action: () => Promise<any>, deletedId?: number) => {
    setTagBusy(true);
    try {
      await action();
      setNewTagName('');
      await loadTags();
      if (deletedId && tagFilter === String(deletedId)) {
        setTagFilter('all');
        await load({ tagFilter: 'all' });
      } else {
        await load();
      }
      message.success('标签已更新');
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '更新标签失败');
    } finally {
      setTagBusy(false);
    }
  };
  const [corpId, setCorpId] = useState('');
  const [corpName, setCorpName] = useState('');
  const [deploymentType, setDeploymentType] = useState<'all' | 'saas' | 'private'>('all');
  const [expireStatus, setExpireStatus] = useState<'all' | 'active' | 'expired'>('all');
  const [enabledStatus, setEnabledStatus] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<AuthRow[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<AuthRow | null>(null);
  const [form] = Form.useForm();
  const [auditRows, setAuditRows] = useState<EnterpriseAuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const load = async (filters?: Partial<{ tagFilter: string; deploymentType: 'all' | 'saas' | 'private'; expireStatus: 'all' | 'active' | 'expired'; enabledStatus: 'all' | 'enabled' | 'disabled' }>) => {
    const nextDeploymentType = filters?.deploymentType ?? deploymentType;
    const nextExpireStatus = filters?.expireStatus ?? expireStatus;
    const nextEnabledStatus = filters?.enabledStatus ?? enabledStatus;
    setLoading(true);
    try {
      const res = await api.adminWeworkAuthorizationList({
        corp_id: corpId.trim() || undefined,
        corp_name: corpName.trim() || undefined,
        deployment_type: nextDeploymentType,
        expire_status: nextExpireStatus,
        enabled_status: nextEnabledStatus,
        tag_filter: filters?.tagFilter ?? tagFilter,
      });
      setRows(pickRows(res));
      setSelectedCorps([]);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '加载企业授权列表失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const loadAuditLogs = async () => {
    setAuditLoading(true);
    try {
      const res = await api.adminAuditLogs({ module: 'enterprise_authorization', page: 1, page_size: 20 });
      setAuditRows(res?.items || []);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '加载企业授权操作记录失败');
      setAuditRows([]);
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    void load();
    void loadTags();
    void loadAuditLogs();
  }, []);

  const columns = useMemo(
    () => [
      { title: 'CorpId', dataIndex: 'corpId', width: 220, sorter: (a: AuthRow, b: AuthRow) => compareText(a.corpId, b.corpId), render: (v: string | undefined) => <HoverPreviewText value={v} maxWidth={200} popupWidth={760} /> },
      { title: '企业名称', dataIndex: 'corpName', width: 160, sorter: (a: AuthRow, b: AuthRow) => compareText(a.corpName, b.corpName), render: (v: string | undefined) => v || '-' },
      { title: '标签', width: 220, render: (_: unknown, row: AuthRow) => (
        <Space wrap size={4}>
          {(row.tags || []).map((t) => <Tag key={t.id}>{t.name}</Tag>)}
          {!row.tags?.length && <Typography.Text type="secondary">无标签</Typography.Text>}
          <Button type="link" size="small" onClick={() => editTags(row)}>编辑标签</Button>
        </Space>
      ) },
      {
        title: '部署类型',
        dataIndex: 'deploymentType',
        width: 110,
        sorter: (a: AuthRow, b: AuthRow) => compareText(a.deploymentType, b.deploymentType),
        render: (v: AuthRow['deploymentType']) => <Tag color={v === 'private' ? 'purple' : v === 'saas' ? 'blue' : 'default'}>{v === 'private' ? 'Private' : v === 'saas' ? 'SaaS' : '全部'}</Tag>,
      },
      {
        title: '状态',
        dataIndex: 'isEnabled',
        width: 100,
        sorter: (a: AuthRow, b: AuthRow) => Number(Boolean(a.isEnabled)) - Number(Boolean(b.isEnabled)),
        render: (v: boolean | undefined) => <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '停用'}</Tag>,
      },
      { title: '到期时间', dataIndex: 'expireTime', width: 180, sorter: (a: AuthRow, b: AuthRow) => compareText(a.expireTime, b.expireTime), render: (v: string | undefined) => v || '-' },
      { title: '创建时间', dataIndex: 'createdAt', width: 180, sorter: (a: AuthRow, b: AuthRow) => compareText(a.createdAt, b.createdAt), render: (v: string | undefined) => v || '-' },
      { title: '备注', dataIndex: 'remark', sorter: (a: AuthRow, b: AuthRow) => compareText(a.remark, b.remark), render: (v: string | undefined) => <HoverPreviewText value={v} maxWidth={260} popupWidth={760} /> },
      {
        title: '操作',
        width: 250,
        render: (_: any, row: AuthRow) => (
          <Space>
            <Button
              size="small"
              onClick={() => {
                setEditing(row);
                form.setFieldsValue({
                  corpId: row.corpId,
                  corpName: row.corpName || '',
                  agentId: row.agentId || '',
                  isEnabled: row.isEnabled !== false,
                  expireTime: row.expireTime ? dayjs(row.expireTime) : null,
                  remark: row.remark || '',
                  deploymentType: row.deploymentType || 'all',
                });
                setOpen(true);
              }}
            >
              编辑
            </Button>
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={() => {
                setEditing(null);
                form.resetFields();
                form.setFieldsValue({
                  corpId: row.corpId,
                  corpName: row.corpName || '',
                  agentId: row.agentId || '',
                  isEnabled: row.isEnabled !== false,
                  expireTime: row.expireTime ? dayjs(row.expireTime) : null,
                  remark: row.remark || '',
                  deploymentType: row.deploymentType || 'all',
                });
                setOpen(true);
              }}
            >
              复制
            </Button>
            <Popconfirm
              title={`确认删除企业授权 ${row.corpId}？`}
              okText="删除"
              cancelText="取消"
              onConfirm={async () => {
                try {
                  await api.adminWeworkAuthorizationDelete(row.corpId);
                  message.success('删除成功');
                  await load();
                  await loadAuditLogs();
                } catch (e: any) {
                  message.error(e?.response?.data?.detail || '删除失败');
                }
              }}
            >
              <Button size="small" danger>删除</Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    []
  );

  const auditColumns = useMemo(
    () => [
      { title: '时间', dataIndex: 'created_at', width: 180 },
      { title: '操作者', dataIndex: 'operator_phone', width: 140, render: (v: string) => v || '-' },
      { title: '操作', dataIndex: 'action_name', width: 140 },
      { title: 'CorpId', dataIndex: 'target_id', width: 220, render: (v: string) => <HoverPreviewText value={v || '-'} maxWidth={200} popupWidth={640} /> },
      { title: '企业名称', dataIndex: 'target_name', width: 180, render: (v: string) => v || '-' },
      {
        title: '结果',
        dataIndex: 'status',
        width: 100,
        render: (v: EnterpriseAuditRow['status']) => <Tag color={v === 'success' ? 'green' : v === 'failed' ? 'red' : v === 'unknown' ? 'orange' : 'blue'}>{v === 'success' ? '成功' : v === 'failed' ? '失败' : v === 'unknown' ? '待核对' : '处理中'}</Tag>,
      },
      {
        title: '详情',
        width: 90,
        render: (_: unknown, row: EnterpriseAuditRow) => (
          <Button
            size="small"
            onClick={() => Modal.info({
              title: `${row.action_name} - 审计详情`,
              width: 860,
              content: <pre style={{ margin: 0, maxHeight: '60vh', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify({ before: row.before, after: row.after, upstream_path: row.upstream_path, error_text: row.error_text }, null, 2)}</pre>,
            })}
          >
            查看
          </Button>
        ),
      },
    ],
    []
  );

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Card
      title="企业定制开通"
      extra={(
        <Space>
          <Button onClick={() => setManageTagsOpen(true)}>管理标签</Button>
          <Button
            icon={<PlusOutlined />}
            type="primary"
            onClick={() => {
              setEditing(null);
              form.resetFields();
              form.setFieldsValue({ isEnabled: true, deploymentType: 'all' });
              setOpen(true);
            }}
          >
            新增企业授权
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
        </Space>
      )}
    >
      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          style={{ width: 220 }}
          value={tagFilter}
          showSearch
          optionFilterProp="label"
          onChange={(value) => { setTagFilter(value); void load({ tagFilter: value }); }}
          options={[{ value: 'all', label: '全部企业' }, { value: 'untagged', label: '无标签企业' }, ...tags.map((t) => ({ value: String(t.id), label: t.name }))]}
        />
        <Select
          style={{ width: 130 }}
          value={deploymentType}
          onChange={(value) => {
            setDeploymentType(value);
            void load({ deploymentType: value });
          }}
          options={[{ value: 'all', label: '全部部署' }, { value: 'saas', label: 'SaaS' }, { value: 'private', label: 'Private' }]}
        />
        <Select
          style={{ width: 130 }}
          value={expireStatus}
          onChange={(value) => {
            setExpireStatus(value);
            void load({ expireStatus: value });
          }}
          options={[{ value: 'all', label: '全部期限' }, { value: 'active', label: '未过期' }, { value: 'expired', label: '已过期' }]}
        />
        <Select
          style={{ width: 130 }}
          value={enabledStatus}
          onChange={(value) => {
            setEnabledStatus(value);
            void load({ enabledStatus: value });
          }}
          options={[{ value: 'all', label: '全部状态' }, { value: 'enabled', label: '启用' }, { value: 'disabled', label: '未启用' }]}
        />
        <Input
          style={{ width: 260 }}
          value={corpId}
          onChange={(e) => setCorpId(e.target.value)}
          placeholder="按 corpId 查询"
          onPressEnter={() => void load()}
        />
        <Input
          style={{ width: 260 }}
          value={corpName}
          onChange={(e) => setCorpName(e.target.value)}
          placeholder="按 corpName 查询"
          onPressEnter={() => void load()}
        />
        <Button onClick={() => void load()}>查询</Button>
      </Space>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 10 }}>
        管理企业授权（新增/修改/删除），仅管理员可见。
      </Typography.Text>

      <Space wrap style={{ marginBottom: 12 }}>
        <Typography.Text>已选 {selectedCorps.length} 家企业</Typography.Text>
        <Button disabled={!selectedCorps.length} onClick={() => { setAssignment({ corpIds: selectedCorps, operation: 'add' }); setAssignmentTags([]); }}>批量添加标签</Button>
        <Button disabled={!selectedCorps.length} onClick={() => { setAssignment({ corpIds: selectedCorps, operation: 'remove' }); setAssignmentTags([]); }}>批量移除标签</Button>
      </Space>
      <Table
        rowKey={(r) => r.corpId}
        rowSelection={{ selectedRowKeys: selectedCorps, onChange: (keys) => { if (keys.length > 500) { message.warning('每次最多批量设置 500 家企业'); return; } setSelectedCorps(keys.map(String)); } }}
        dataSource={rows}
        loading={loading}
        columns={columns}
        pagination={{ defaultPageSize: 50, showSizeChanger: true, showTotal: (total) => `共 ${total} 家企业` }}
        scroll={{ x: 1500 }}
        locale={{ emptyText: '暂无企业授权' }}
      />

      <Modal title="管理企业标签" open={manageTagsOpen} onCancel={() => !tagBusy && setManageTagsOpen(false)} footer={null}>
        <Space style={{ marginBottom: 16 }}>
          <Input maxLength={80} value={newTagName} onChange={(e) => setNewTagName(e.target.value)} placeholder="例如：某某集团" disabled={tagBusy} />
          <Button type="primary" disabled={!newTagName.trim() || tagBusy} onClick={() => void changeTag(() => api.createEnterpriseTag(newTagName.trim()))}>新建标签</Button>
        </Space>
        <Typography.Paragraph type="secondary">删除标签只移除分类关系，不会删除企业或开通记录。</Typography.Paragraph>
        <Space direction="vertical" style={{ width: '100%' }}>
          {tags.map((tag) => <Space key={tag.id}>
            <Input maxLength={80} disabled={tagBusy} value={tagNames[tag.id] ?? tag.name} onChange={(e) => setTagNames((old) => ({ ...old, [tag.id]: e.target.value }))} />
            <Button disabled={tagBusy || !tagNames[tag.id]?.trim() || tagNames[tag.id].trim() === tag.name} onClick={() => void changeTag(() => api.renameEnterpriseTag(tag.id, tagNames[tag.id].trim()))}>重命名</Button>
            <Popconfirm title={`删除标签「${tag.name}」？`} onConfirm={() => changeTag(() => api.deleteEnterpriseTag(tag.id), tag.id)} disabled={tagBusy}>
              <Button danger disabled={tagBusy}>删除</Button>
            </Popconfirm>
          </Space>)}
          {!tags.length && <Typography.Text type="secondary">暂无标签，可先创建常用集团标签。</Typography.Text>}
        </Space>
      </Modal>
      <Modal title={assignment?.operation === 'replace' ? '编辑企业标签' : assignment?.operation === 'add' ? '批量添加标签' : '批量移除标签'}
        open={!!assignment} onCancel={() => !tagBusy && setAssignment(null)} confirmLoading={tagBusy}
        onOk={async () => {
          if (!assignment) return;
          if (assignment.operation !== 'replace' && !assignmentTags.length) { message.warning('请至少选择一个标签'); return; }
          setTagBusy(true);
          try {
            await api.applyEnterpriseTags(assignment.corpIds, assignmentTags, assignment.operation);
            setAssignment(null);
            await load();
            await loadAuditLogs();
            message.success('企业标签已更新');
          } catch (e: any) { message.error(e?.response?.data?.detail || '设置标签失败'); }
          finally { setTagBusy(false); }
        }}>
        <Typography.Paragraph>为 {assignment?.corpIds.length || 0} 家企业{assignment?.operation === 'remove' ? '移除' : '设置'}标签。</Typography.Paragraph>
        <Select mode="multiple" style={{ width: '100%' }} value={assignmentTags} onChange={setAssignmentTags} disabled={tagBusy} options={tags.map((t) => ({ value: t.id, label: t.name }))} placeholder="选择标签，可选择多个" optionFilterProp="label" />
        {assignment?.operation === 'replace' && <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>清空选择并保存后，该企业归入“无标签企业”。</Typography.Paragraph>}
      </Modal>

      <Modal
        title={editing ? '编辑企业授权' : '新增企业授权'}
        open={open}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        onOk={async () => {
          const values = await form.validateFields();
          setSaving(true);
          try {
            await api.adminWeworkAuthorizationSave({
              corpId: String(values.corpId || '').trim(),
              corpName: String(values.corpName || '').trim() || undefined,
              agentId: String(values.agentId || '').trim() || undefined,
              isEnabled: Boolean(values.isEnabled),
              expireTime: values.expireTime ? `${(values.expireTime as Dayjs).format('YYYY-MM-DD')}T23:59:59` : undefined,
              remark: String(values.remark || '').trim() || undefined,
              deploymentType: values.deploymentType || 'all',
            });
            message.success('保存成功');
            setOpen(false);
            await load();
            await loadAuditLogs();
          } catch (e: any) {
            message.error(e?.response?.data?.detail || '保存失败');
          } finally {
            setSaving(false);
          }
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="corpId" label="CorpId" rules={[{ required: true, message: '请输入 corpId' }]}>
            <Input disabled={Boolean(editing)} placeholder="ww1234567890abcdef" />
          </Form.Item>
          <Form.Item name="corpName" label="企业名称">
            <Input placeholder="测试企业A" />
          </Form.Item>
          <Form.Item name="agentId" label="AgentId">
            <Input placeholder="1000002" />
          </Form.Item>
          <Form.Item name="deploymentType" label="部署类型" initialValue="all">
            <Select options={[{ value: 'all', label: '全部' }, { value: 'saas', label: 'SaaS' }, { value: 'private', label: 'Private' }]} />
          </Form.Item>
          <Form.Item name="isEnabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            name="expireTime"
            label="到期时间"
            rules={[
              { required: true, message: '请选择到期日期' },
            ]}
          >
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" placeholder="请选择日期（默认到当天 23:59:59）" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} placeholder="首年授权" />
          </Form.Item>
        </Form>
        {open && editing ? <EnterpriseSharePanel key={editing.corpId} corpId={editing.corpId} onChanged={() => void loadAuditLogs()} /> : null}
      </Modal>
    </Card>
    <Card title="最近企业授权操作记录" extra={<Button icon={<ReloadOutlined />} onClick={() => void loadAuditLogs()} loading={auditLoading}>刷新</Button>}>
      <Table
        rowKey="id"
        loading={auditLoading}
        dataSource={auditRows}
        columns={auditColumns}
        pagination={false}
        scroll={{ x: 1050 }}
        locale={{ emptyText: '暂无操作记录（审计上线后开始记录）' }}
      />
    </Card>
    </Space>
  );
}
