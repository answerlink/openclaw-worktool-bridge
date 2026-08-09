import { useEffect, useMemo, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { Alert, Button, Card, Checkbox, DatePicker, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import { CopyOutlined, DownloadOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '../api';
import HoverPreviewText from '../components/HoverPreviewText';

interface AuthRow {
  corpId: string;
  corpName?: string;
  agentId?: string;
  isEnabled?: boolean;
  expireTime?: string;
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
  remark: string;
  expire_date: string;
  expire_epoch_ms: number;
  restrict_robot: boolean;
  robot_start: string;
  robot_end: string;
  robot_limit?: number | null;
  created_at: string;
}

const LICENSE_SECRET_KEY = '2024053003504202';
const MAX_ROBOT_SCOPE = 100000;
const SBOX = [
  99, 124, 119, 123, 242, 107, 111, 197, 48, 1, 103, 43, 254, 215, 171, 118,
  202, 130, 201, 125, 250, 89, 71, 240, 173, 212, 162, 175, 156, 164, 114, 192,
  183, 253, 147, 38, 54, 63, 247, 204, 52, 165, 229, 241, 113, 216, 49, 21,
  4, 199, 35, 195, 24, 150, 5, 154, 7, 18, 128, 226, 235, 39, 178, 117,
  9, 131, 44, 26, 27, 110, 90, 160, 82, 59, 214, 179, 41, 227, 47, 132,
  83, 209, 0, 237, 32, 252, 177, 91, 106, 203, 190, 57, 74, 76, 88, 207,
  208, 239, 170, 251, 67, 77, 51, 133, 69, 249, 2, 127, 80, 60, 159, 168,
  81, 163, 64, 143, 146, 157, 56, 245, 188, 182, 218, 33, 16, 255, 243, 210,
  205, 12, 19, 236, 95, 151, 68, 23, 196, 167, 126, 61, 100, 93, 25, 115,
  96, 129, 79, 220, 34, 42, 144, 136, 70, 238, 184, 20, 222, 94, 11, 219,
  224, 50, 58, 10, 73, 6, 36, 92, 194, 211, 172, 98, 145, 149, 228, 121,
  231, 200, 55, 109, 141, 213, 78, 169, 108, 86, 244, 234, 101, 122, 174, 8,
  186, 120, 37, 46, 28, 166, 180, 198, 232, 221, 116, 31, 75, 189, 139, 138,
  112, 62, 181, 102, 72, 3, 246, 14, 97, 53, 87, 185, 134, 193, 29, 158,
  225, 248, 152, 17, 105, 217, 142, 148, 155, 30, 135, 233, 206, 85, 40, 223,
  140, 161, 137, 13, 191, 230, 66, 104, 65, 153, 45, 15, 176, 84, 187, 22,
];
const RCON = [0, 1, 2, 4, 8, 16, 32, 64, 128, 27, 54];

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

function utf8Bytes(str: string) {
  return Array.from(new TextEncoder().encode(str));
}

function base64FromBytes(bytes: number[]) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunk));
  }
  return btoa(binary);
}

function expandKey(key: number[]) {
  const w = key.slice();
  for (let i = 16; i < 176; i += 4) {
    const temp = w.slice(i - 4, i);
    if (i % 16 === 0) {
      temp.push(temp.shift() as number);
      for (let j = 0; j < 4; j += 1) temp[j] = SBOX[temp[j]];
      temp[0] ^= RCON[i / 16];
    }
    for (let j = 0; j < 4; j += 1) {
      w[i + j] = w[i - 16 + j] ^ temp[j];
    }
  }
  return w;
}

function addRoundKey(state: number[], expandedKey: number[], offset: number) {
  for (let i = 0; i < 16; i += 1) {
    state[i] ^= expandedKey[offset + i];
  }
}

function subBytes(state: number[]) {
  for (let i = 0; i < 16; i += 1) {
    state[i] = SBOX[state[i]];
  }
}

function shiftRows(s: number[]) {
  const t = s.slice();
  s[1] = t[5]; s[5] = t[9]; s[9] = t[13]; s[13] = t[1];
  s[2] = t[10]; s[6] = t[14]; s[10] = t[2]; s[14] = t[6];
  s[3] = t[15]; s[7] = t[3]; s[11] = t[7]; s[15] = t[11];
}

function mul2(x: number) {
  return ((x << 1) ^ ((x & 128) ? 27 : 0)) & 255;
}

function mixColumns(s: number[]) {
  for (let c = 0; c < 4; c += 1) {
    const i = c * 4;
    const a0 = s[i];
    const a1 = s[i + 1];
    const a2 = s[i + 2];
    const a3 = s[i + 3];
    s[i] = mul2(a0) ^ (mul2(a1) ^ a1) ^ a2 ^ a3;
    s[i + 1] = a0 ^ mul2(a1) ^ (mul2(a2) ^ a2) ^ a3;
    s[i + 2] = a0 ^ a1 ^ mul2(a2) ^ (mul2(a3) ^ a3);
    s[i + 3] = (mul2(a0) ^ a0) ^ a1 ^ a2 ^ mul2(a3);
  }
}

function encryptBlock(input: number[], expandedKey: number[]) {
  const state = input.slice();
  addRoundKey(state, expandedKey, 0);
  for (let round = 1; round <= 9; round += 1) {
    subBytes(state);
    shiftRows(state);
    mixColumns(state);
    addRoundKey(state, expandedKey, round * 16);
  }
  subBytes(state);
  shiftRows(state);
  addRoundKey(state, expandedKey, 160);
  return state;
}

function aesEcbPkcs7Base64(plainText: string, keyText: string) {
  const key = utf8Bytes(keyText);
  if (key.length !== 16) {
    throw new Error('AES 密钥必须是 16 字节。');
  }
  const expandedKey = expandKey(key);
  const bytes = utf8Bytes(plainText);
  const pad = 16 - (bytes.length % 16 || 16);
  const actualPad = pad === 0 ? 16 : pad;
  for (let i = 0; i < actualPad; i += 1) bytes.push(actualPad);

  const encrypted: number[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    encrypted.push(...encryptBlock(bytes.slice(offset, offset + 16), expandedKey));
  }
  return base64FromBytes(encrypted);
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

      let payload = `${machine}|${expireEpochMs}|worktool-official`;
      let scopeText = '不限制';
      let robotLimit: number | undefined;
      let start = '';
      let end = '';
      if (values.restrictRobot) {
        start = String(values.robotStart || '').trim();
        end = String(values.robotEnd || '').trim();
        robotLimit = calculateRobotLimit(start, end);
        payload += `|${start}|${end}|${robotLimit}`;
        scopeText = `${start}-${end}，数量 ${robotLimit}`;
      }

      const licenseText = JSON.stringify({ v: 1, data: aesEcbPkcs7Base64(payload, LICENSE_SECRET_KEY) });
      setOutput(licenseText);
      setStatus({ type: 'success', text: `生成成功。到期时间戳：${expireEpochMs}；机器人范围：${scopeText}。` });
      try {
        await api.adminPrivateLicenseLogCreate({
          machine_code: machine,
          remark: String(values.remark || '').trim(),
          expire_date: expireDate.format('YYYY-MM-DD'),
          expire_epoch_ms: expireEpochMs,
          restrict_robot: Boolean(values.restrictRobot),
          robot_start: start || undefined,
          robot_end: end || undefined,
          robot_limit: robotLimit,
        });
        void loadLogs();
      } catch (logError: any) {
        message.warning(logError?.response?.data?.detail || 'license 已生成，但记录生成日志失败');
      }
    } catch (e: any) {
      setOutput('');
      setStatus({ type: 'error', text: e?.errorFields ? '请检查表单必填项。' : e?.message || String(e) });
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
        生成内容兼容服务端新版 license.lic 校验。机器码从私有化服务启动日志里的 MACHINE_CODE 复制。
      </Typography.Text>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          expireDate: dayjs().add(1, 'year'),
          restrictRobot: true,
          robotStart: '20260001',
          robotEnd: '20260300',
        }}
      >
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
          <Button type="primary" onClick={() => void generate()}>
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
          { name: '签名格式', value: '{"v":1,"data":"..."}' },
          { name: '加密算法', value: 'AES/ECB/PKCS5Padding' },
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

  const load = async (filters?: Partial<{ deploymentType: 'all' | 'saas' | 'private'; expireStatus: 'all' | 'active' | 'expired'; enabledStatus: 'all' | 'enabled' | 'disabled' }>) => {
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
      });
      setRows(pickRows(res));
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
    void loadAuditLogs();
  }, []);

  const columns = useMemo(
    () => [
      { title: 'CorpId', dataIndex: 'corpId', width: 220, render: (v: string | undefined) => <HoverPreviewText value={v} maxWidth={200} popupWidth={760} /> },
      { title: '企业名称', dataIndex: 'corpName', width: 160, render: (v: string | undefined) => v || '-' },
      { title: 'AgentId', dataIndex: 'agentId', width: 120, render: (v: string | undefined) => v || '-' },
      {
        title: '部署类型',
        dataIndex: 'deploymentType',
        width: 110,
        render: (v: AuthRow['deploymentType']) => <Tag color={v === 'private' ? 'purple' : v === 'saas' ? 'blue' : 'default'}>{v === 'private' ? 'Private' : v === 'saas' ? 'SaaS' : '全部'}</Tag>,
      },
      {
        title: '状态',
        dataIndex: 'isEnabled',
        width: 100,
        render: (v: boolean | undefined) => <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '停用'}</Tag>,
      },
      { title: '到期时间', dataIndex: 'expireTime', width: 180, render: (v: string | undefined) => v || '-' },
      { title: '备注', dataIndex: 'remark', render: (v: string | undefined) => <HoverPreviewText value={v} maxWidth={260} popupWidth={760} /> },
      {
        title: '操作',
        width: 180,
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

      <Table
        rowKey={(r) => r.corpId}
        dataSource={rows}
        loading={loading}
        columns={columns}
        pagination={false}
        scroll={{ x: 1100 }}
        locale={{ emptyText: '暂无企业授权' }}
      />

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
