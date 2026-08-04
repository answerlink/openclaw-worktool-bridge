import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, DatePicker, Form, Input, Modal, Space, Table, Typography, message } from 'antd';
import dayjs from 'dayjs';
import { api } from '../api';
import HoverPreviewText from '../components/HoverPreviewText';

type MigrateAction = {
  key: string;
  label: string;
  description: string;
  danger?: boolean;
  requiresExpireDate?: boolean;
  run: (robotId: string, expireDate?: string) => Promise<any>;
};

interface MigrateLogRow {
  id: number;
  operator_phone: string;
  action_name: string;
  old_robot_id: string;
  new_robot_id: string;
  request?: { expireDate?: string };
  created_at: string;
}

export default function RobotMigratePage() {
  const [form] = Form.useForm<{ robotId: string; expireDate?: dayjs.Dayjs }>();
  const [loadingKey, setLoadingKey] = useState<string>('');
  const [resultText, setResultText] = useState('');
  const [logs, setLogs] = useState<MigrateLogRow[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const actions = useMemo<MigrateAction[]>(
    () => [
      {
        key: 'renew',
        label: '续期',
        description: '将授权到期时间设为所选日期的 23:59:59',
        requiresExpireDate: true,
        run: (robotId, expireDate) => api.adminRobotRenew(robotId, expireDate || '')
      },
      {
        key: 'disable',
        label: '停用机器人',
        description: '将机器人设置为停用状态',
        danger: true,
        run: (robotId) => api.adminRobotDisable(robotId)
      },
      {
        key: 'wework-to-wechat',
        label: '企微换个微ID',
        description: '旧机器人ID（企微）迁移为个微ID',
        run: (robotId) => api.adminRobotMigrateWeworkToWechat(robotId)
      },
      {
        key: 'wechat-to-wework',
        label: '个微换企微ID',
        description: '旧机器人ID（个微）迁移为企微ID',
        run: (robotId) => api.adminRobotMigrateWechatToWework(robotId)
      },
      {
        key: 'wework-to-new-wework',
        label: '企微换新的企微ID',
        description: '旧机器人ID（企微）迁移为新的企微ID',
        run: (robotId) => api.adminRobotMigrateWeworkToNewWework(robotId)
      },
      {
        key: 'wechat-to-new-wechat',
        label: '个微换新的个微ID',
        description: '旧机器人ID（个微）迁移为新的个微ID',
        run: (robotId) => api.adminRobotMigrateWechatToNewWechat(robotId)
      }
    ],
    []
  );

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      const res = await api.adminRobotMigrateLogs(10);
      setLogs(res?.items || []);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '加载操作记录失败');
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    void loadLogs();
  }, []);

  const runAction = async (action: MigrateAction) => {
    const fields = action.requiresExpireDate ? ['robotId', 'expireDate'] : ['robotId'];
    const values = await form.validateFields(fields);
    const robotId = String(values.robotId || '').trim();
    const expireDate = values.expireDate?.format('YYYY-MM-DD');
    const detail = action.requiresExpireDate ? `，到期日设为 ${expireDate} 23:59:59` : '';
    Modal.confirm({
      title: action.danger ? '确认停用机器人' : '确认执行操作',
      content: `将对机器人 ${robotId} 执行「${action.label}」${detail}。${action.danger ? '停用后机器人将无法继续提供服务。' : ''}`,
      okText: '确认执行',
      okButtonProps: action.danger ? { danger: true } : undefined,
      cancelText: '取消',
      onOk: async () => {
        try {
          setLoadingKey(action.key);
          const res = await action.run(robotId, expireDate);
          setResultText(JSON.stringify(res, null, 2));
          message.success('操作成功');
          void loadLogs();
        } catch (e: any) {
          message.error(e?.response?.data?.detail || '操作失败');
        } finally {
          setLoadingKey('');
        }
      }
    });
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="机器人更换续期">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            message="仅管理员可用，续期和停用通过 console 后端调用 WorkTool 管理接口。"
            description="停用会立即影响机器人服务；迁移操作不会自动同步本系统内的旧 robot_id 引用。"
          />
          <Form form={form} layout="vertical" initialValues={{ expireDate: dayjs() }}>
            <Form.Item label="机器人ID" name="robotId" rules={[{ required: true, message: '请输入机器人ID' }]}>
              <Input placeholder="例如：wtaniwf61irnzx3mf6ra3hsgf5y8zkm4" />
            </Form.Item>
            <Form.Item label="续期到期日" name="expireDate" rules={[{ required: true, message: '请选择到期日' }]}>
              <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" allowClear={false} />
            </Form.Item>
          </Form>
          <Space wrap>
            {actions.map((action) => (
              <Button
                key={action.key}
                type={action.danger ? 'default' : 'primary'}
                danger={action.danger}
                onClick={() => void runAction(action)}
                loading={loadingKey === action.key}
              >
                {action.label}
              </Button>
            ))}
          </Space>
          <Typography.Text type="secondary">续期接口支持 YYYY-MM-DD 格式，到期时间由上游设置为当天 23:59:59。</Typography.Text>
          {resultText ? (
            <Card size="small" title="返回结果">
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{resultText}</pre>
            </Card>
          ) : null}
        </Space>
      </Card>
      <Card title="最近10条操作记录">
        <Table
          rowKey="id"
          size="small"
          loading={logsLoading}
          dataSource={logs}
          pagination={false}
          columns={[
            { title: '时间', dataIndex: 'created_at', width: 180, render: (v: string) => v || '-' },
            { title: '操作者', dataIndex: 'operator_phone', width: 140, render: (v: string) => v || '-' },
            { title: '操作', dataIndex: 'action_name', width: 160 },
            { title: '机器人ID', dataIndex: 'old_robot_id', width: 260, render: (v: string) => <HoverPreviewText value={v || '-'} maxWidth={220} popupWidth={760} /> },
            { title: '续期到', key: 'expireDate', width: 140, render: (_: unknown, row: MigrateLogRow) => row.request?.expireDate || '-' },
            { title: '新机器人ID', dataIndex: 'new_robot_id', width: 220, render: (v: string) => <HoverPreviewText value={v || '-'} maxWidth={190} popupWidth={760} /> }
          ]}
        />
      </Card>
    </Space>
  );
}
