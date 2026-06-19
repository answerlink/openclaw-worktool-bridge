import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Space, Table, Typography, message } from 'antd';
import { api } from '../api';
import HoverPreviewText from '../components/HoverPreviewText';

type MigrateAction = {
  key: string;
  label: string;
  description: string;
  run: (oldRobotId: string) => Promise<any>;
};

interface MigrateLogRow {
  id: number;
  operator_phone: string;
  action_name: string;
  old_robot_id: string;
  new_robot_id: string;
  created_at: string;
}

export default function RobotMigratePage() {
  const [form] = Form.useForm<{ oldRobotId: string }>();
  const [loadingKey, setLoadingKey] = useState<string>('');
  const [resultText, setResultText] = useState('');
  const [logs, setLogs] = useState<MigrateLogRow[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const actions = useMemo<MigrateAction[]>(
    () => [
      {
        key: 'wework-to-wechat',
        label: '企微换个微ID',
        description: '旧机器人ID（企微）迁移为个微ID',
        run: (oldRobotId: string) => api.adminRobotMigrateWeworkToWechat(oldRobotId)
      },
      {
        key: 'wechat-to-wework',
        label: '个微换企微ID',
        description: '旧机器人ID（个微）迁移为企微ID',
        run: (oldRobotId: string) => api.adminRobotMigrateWechatToWework(oldRobotId)
      },
      {
        key: 'wework-to-new-wework',
        label: '企微换新的企微ID',
        description: '旧机器人ID（企微）迁移为新的企微ID',
        run: (oldRobotId: string) => api.adminRobotMigrateWeworkToNewWework(oldRobotId)
      },
      {
        key: 'wechat-to-new-wechat',
        label: '个微换新的个微ID',
        description: '旧机器人ID（个微）迁移为新的个微ID',
        run: (oldRobotId: string) => api.adminRobotMigrateWechatToNewWechat(oldRobotId)
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
      message.error(e?.response?.data?.detail || '加载更换记录失败');
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    void loadLogs();
  }, []);

  const runAction = async (action: MigrateAction) => {
    const values = await form.validateFields();
    const oldRobotId = String(values.oldRobotId || '').trim();
    Modal.confirm({
      title: '确认执行机器人更换',
      content: `将对机器人 ${oldRobotId} 执行「${action.label}」，是否继续？`,
      okText: '确认执行',
      cancelText: '取消',
      onOk: async () => {
        try {
          setLoadingKey(action.key);
          const res = await action.run(oldRobotId);
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
      <Card title="机器人更换">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            message="该操作调用 WorkTool 管理员迁移接口，仅管理员可用。"
            description="本页面仅触发迁移，不会自动同步本系统内的旧 robot_id 引用。"
          />
          <Form form={form} layout="vertical">
            <Form.Item
              label="旧机器人ID（oldRobotId）"
              name="oldRobotId"
              rules={[{ required: true, message: '请输入旧机器人ID' }]}
            >
              <Input placeholder="例如：worktool1 或 wcxxxxxxxxxx" />
            </Form.Item>
          </Form>
          <Space wrap>
            {actions.map((action) => (
              <Button
                key={action.key}
                type="primary"
                onClick={() => void runAction(action)}
                loading={loadingKey === action.key}
              >
                {action.label}
              </Button>
            ))}
          </Space>
          <Typography.Text type="secondary">
            说明：四种操作分别对应 WorkTool 的四个迁移 API，入参均为 oldRobotId。
          </Typography.Text>
          {resultText ? (
            <Card size="small" title="返回结果">
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{resultText}</pre>
            </Card>
          ) : null}
        </Space>
      </Card>
      <Card title="最近10条更换记录">
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
            { title: '原机器人ID', dataIndex: 'old_robot_id', width: 220, render: (v: string) => <HoverPreviewText value={v || '-'} maxWidth={200} popupWidth={760} /> },
            { title: '新机器人ID', dataIndex: 'new_robot_id', width: 220, render: (v: string) => <HoverPreviewText value={v || '-'} maxWidth={200} popupWidth={760} /> },
          ]}
        />
      </Card>
    </Space>
  );
}
