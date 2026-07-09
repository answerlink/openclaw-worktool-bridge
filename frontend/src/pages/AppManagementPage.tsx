import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Upload, message } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { api } from '../api';
import HoverPreviewText from '../components/HoverPreviewText';

interface AppOptionItem {
  app_name: string;
  version_count: number;
  latest_create_time: string;
}

interface AppUpdateRow {
  id: number;
  app_name: string;
  title: string;
  update_log: string;
  remark: string;
  version_name: string;
  version_code: number;
  min_version_code: number;
  download_url: string;
  create_time: string;
  size: string;
  enable: boolean;
}

interface AppUpdateFormValues {
  app_name: string;
  title: string;
  update_log: string;
  remark?: string;
  version_name: string;
  version_code: number;
  min_version_code: number;
  download_url: string;
  size: string;
  enable: boolean;
}

function versionCodeFromName(versionName?: string) {
  const parts = String(versionName || '').match(/\d+/g)?.map((x) => Number(x)) || [];
  if (parts.length >= 4) {
    return parts[0] * 10000 + parts[1] * 1000 + parts[2] * 10 + parts[3];
  }
  if (parts.length) {
    return Number(parts.join(''));
  }
  return undefined;
}

function guessDownloadUrl(latest: AppUpdateRow | null, nextVersion: string) {
  const raw = String(latest?.download_url || '');
  const oldVersion = String(latest?.version_name || '');
  if (!raw || !oldVersion || !nextVersion || !raw.includes(oldVersion)) {
    return '';
  }
  return raw.split(oldVersion).join(nextVersion);
}

export default function AppManagementPage() {
  const [form] = Form.useForm<AppUpdateFormValues>();
  const [apps, setApps] = useState<AppOptionItem[]>([]);
  const [selectedApp, setSelectedApp] = useState('');
  const [rows, setRows] = useState<AppUpdateRow[]>([]);
  const [latest, setLatest] = useState<AppUpdateRow | null>(null);
  const [appsLoading, setAppsLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [enablingId, setEnablingId] = useState<number | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  const appOptions = useMemo(
    () => apps.map((x) => ({ label: `${x.app_name} (${x.version_count})`, value: x.app_name })),
    [apps]
  );

  const applyTemplate = (appName: string, latestRow: AppUpdateRow | null) => {
    form.setFieldsValue({
      app_name: appName,
      title: latestRow?.version_name ? `v${latestRow.version_name}更新啦~` : '',
      update_log: latestRow?.update_log || '1.兼容性升级；\\n2.修复近期反馈bug',
      remark: latestRow?.remark || '',
      version_name: '',
      version_code: undefined as any,
      min_version_code: latestRow?.min_version_code,
      download_url: '',
      size: latestRow?.size || '',
      enable: Boolean(latestRow?.enable),
    });
    setFileList([]);
  };

  const loadApps = async () => {
    setAppsLoading(true);
    try {
      const res = await api.adminAppUpdateApps();
      const nextApps = res?.items || [];
      setApps(nextApps);
      if (!selectedApp && nextApps.length) {
        setSelectedApp(nextApps[0].app_name);
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || '加载 app 列表失败');
      setApps([]);
    } finally {
      setAppsLoading(false);
    }
  };

  const loadVersions = async (appName: string) => {
    if (!appName) {
      setRows([]);
      setLatest(null);
      return;
    }
    setListLoading(true);
    try {
      const res = await api.adminAppUpdates(appName);
      const nextRows = res?.items || [];
      const latestRow = res?.latest || null;
      setRows(nextRows);
      setLatest(latestRow);
      applyTemplate(appName, latestRow);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || '加载版本列表失败');
      setRows([]);
      setLatest(null);
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    void loadApps();
  }, []);

  useEffect(() => {
    if (selectedApp) {
      void loadVersions(selectedApp);
    }
  }, [selectedApp]);

  const uploadApk = async () => {
    const values = await form.validateFields(['app_name', 'version_name']);
    const file = fileList[0]?.originFileObj as File | undefined;
    if (!file) {
      message.warning('请先选择 APK 文件');
      return;
    }
    setUploading(true);
    try {
      const res = await api.adminAppUpdateUpload({
        app_name: values.app_name,
        version_name: values.version_name,
        file,
      });
      form.setFieldsValue({ download_url: res?.download_url || '' });
      message.success('上传成功，已回填下载地址');
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const submitCreate = async () => {
    const values = await form.validateFields();
    Modal.confirm({
      title: '确认新增 App 版本',
      content: `将为 ${values.app_name} 新增版本 ${values.version_name}，是否继续？`,
      okText: '确认新增',
      cancelText: '取消',
      onOk: async () => {
        setSaving(true);
        try {
          await api.adminAppUpdateCreate({
            app_name: values.app_name,
            title: values.title,
            update_log: values.update_log,
            remark: values.remark,
            version_name: values.version_name,
            version_code: Number(values.version_code),
            min_version_code: Number(values.min_version_code),
            download_url: values.download_url,
            size: values.size,
            enable: Boolean(values.enable),
          });
          message.success('新增成功');
          await loadVersions(values.app_name);
        } catch (e: any) {
          message.error(e?.response?.data?.detail || e?.message || '新增失败');
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const enableVersion = (row: AppUpdateRow) => {
    if (row.enable) return;
    Modal.confirm({
      title: '确认启用该版本',
      content: `将启用 ${row.app_name} ${row.version_name}，同 app_name 下其他已启用版本会自动取消启用。`,
      okText: '确认启用',
      cancelText: '取消',
      onOk: async () => {
        setEnablingId(row.id);
        try {
          await api.adminAppUpdateEnable(row.id);
          message.success('已启用');
          await loadVersions(row.app_name);
        } catch (e: any) {
          message.error(e?.response?.data?.detail || e?.message || '启用失败');
        } finally {
          setEnablingId(null);
        }
      },
    });
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title="App管理"
        extra={<Button onClick={() => void loadApps()} loading={appsLoading}>刷新 App</Button>}
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            style={{ width: 280 }}
            placeholder="选择 app_name"
            options={appOptions}
            value={selectedApp || undefined}
            loading={appsLoading}
            onChange={(v) => setSelectedApp(v)}
          />
          <Button onClick={() => void loadVersions(selectedApp)} disabled={!selectedApp} loading={listLoading}>
            刷新版本
          </Button>
        </Space>
        <Table
          rowKey="id"
          size="small"
          loading={listLoading}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 1500 }}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 80 },
            { title: '创建时间', dataIndex: 'create_time', width: 170 },
            { title: 'app_name', dataIndex: 'app_name', width: 140 },
            { title: '版本名', dataIndex: 'version_name', width: 120 },
            { title: 'version_code', dataIndex: 'version_code', width: 130 },
            { title: 'min_version_code', dataIndex: 'min_version_code', width: 150 },
            { title: '标题', dataIndex: 'title', width: 180, render: (v: string) => <HoverPreviewText value={v || '-'} maxWidth={160} popupWidth={520} /> },
            { title: '更新日志', dataIndex: 'update_log', width: 220, render: (v: string) => <HoverPreviewText value={v || '-'} maxWidth={200} popupWidth={640} /> },
            { title: '下载地址', dataIndex: 'download_url', width: 260, render: (v: string) => <HoverPreviewText value={v || '-'} maxWidth={240} popupWidth={760} /> },
            { title: '大小', dataIndex: 'size', width: 90, render: (v: string) => v || '-' },
            { title: '启用', dataIndex: 'enable', width: 80, render: (v: boolean) => (v ? '是' : '否') },
            {
              title: '操作',
              key: 'actions',
              fixed: 'right',
              width: 120,
              render: (_: unknown, row: AppUpdateRow) => (
                <Button
                  size="small"
                  type={row.enable ? 'default' : 'primary'}
                  disabled={row.enable}
                  loading={enablingId === row.id}
                  onClick={() => enableVersion(row)}
                >
                  {row.enable ? '已启用' : '设为启用'}
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Card title="新增 App 版本">
        <Form
          form={form}
          layout="vertical"
          onValuesChange={(changed) => {
            if (Object.prototype.hasOwnProperty.call(changed, 'version_name')) {
              const versionName = String(changed.version_name || '').trim();
              const next: Partial<AppUpdateFormValues> = {
                title: versionName ? `v${versionName}更新啦~` : '',
              };
              const versionCode = versionCodeFromName(versionName);
              if (versionCode) {
                next.version_code = versionCode;
              }
              const guessedUrl = guessDownloadUrl(latest, versionName);
              if (guessedUrl) {
                next.download_url = guessedUrl;
              }
              form.setFieldsValue(next);
            }
          }}
        >
          <Space size={16} align="start" wrap style={{ width: '100%' }}>
            <Form.Item name="app_name" label="app_name" rules={[{ required: true, message: '请选择 app_name' }]}>
              <Select style={{ width: 260 }} options={appOptions} onChange={(v) => setSelectedApp(v)} />
            </Form.Item>
            <Form.Item
              name="version_name"
              label="版本号"
              rules={[
                { required: true, message: '请输入版本号' },
                { pattern: /^\d+(?:\.\d+){1,5}$/, message: '版本号格式不合法' },
              ]}
            >
              <Input style={{ width: 180 }} placeholder="例如：3.8.1.6" />
            </Form.Item>
            <Form.Item name="version_code" label="version_code" rules={[{ required: true, message: '请填写 version_code' }]}>
              <InputNumber style={{ width: 160 }} min={1} precision={0} />
            </Form.Item>
            <Form.Item name="min_version_code" label="min_version_code" rules={[{ required: true, message: '请填写 min_version_code' }]}>
              <InputNumber style={{ width: 180 }} min={1} precision={0} />
            </Form.Item>
            <Form.Item name="size" label="size">
              <Input style={{ width: 120 }} placeholder="例如：17M" />
            </Form.Item>
            <Form.Item name="enable" label="enable" valuePropName="checked">
              <Switch checkedChildren="启用" unCheckedChildren="禁用" />
            </Form.Item>
          </Space>

          <Form.Item name="title" label="title" rules={[{ required: true, message: '请填写标题' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="update_log" label="update_log" rules={[{ required: true, message: '请填写更新日志' }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="remark" label="remark">
            <Input />
          </Form.Item>
          <Form.Item name="download_url" label="download_url" rules={[{ required: true, message: '请填写或上传 APK 得到下载地址' }]}>
            <Input />
          </Form.Item>

          <Space wrap style={{ marginBottom: 16 }}>
            <Upload
              accept=".apk"
              maxCount={1}
              fileList={fileList}
              beforeUpload={(file) => {
                setFileList([file]);
                return false;
              }}
              onRemove={() => {
                setFileList([]);
              }}
            >
              <Button icon={<UploadOutlined />}>选择 APK</Button>
            </Upload>
            <Button onClick={() => void uploadApk()} loading={uploading} disabled={!fileList.length}>
              上传并回填 URL
            </Button>
            <Button type="primary" onClick={() => void submitCreate()} loading={saving}>
              新增版本
            </Button>
          </Space>
        </Form>
      </Card>
    </Space>
  );
}
