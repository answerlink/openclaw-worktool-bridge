import { useEffect, useState } from 'react';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { Button, Card, Form, Input, Modal, Popconfirm, Popover, Select, Space, Switch, Table, Typography, message } from 'antd';
import { api } from '../api';
import HoverPreviewText from '../components/HoverPreviewText';
import type { Provider } from '../types';

const OPENAI_BASE_OPTIONS = [
  { label: 'OpenAI 官方', value: 'https://api.openai.com/v1/chat/completions' },
  { label: '硅基流动', value: 'https://api.siliconflow.cn/v1/chat/completions' },
  { label: '火山引擎', value: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions' },
  { label: '自定义（OpenAI兼容接口）', value: '__custom__' }
];
const OPENCLAW_WEBHOOK_HINT = 'http://{你的外网ip:18799}/wechat/webhook?robotId={你的机器人id}';
const DEFAULT_PROVIDER_SYSTEM_PROMPT_TEMPLATE = `你是[{robot_name}]
{colleague_line}
{current_asker}
`;

function normalizeOpenaiBaseUrl(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return s;
  if (/\/v1\/?$/i.test(s)) {
    return s.replace(/\/?$/, '/chat/completions');
  }
  return s;
}

export default function AIHubPage() {
  const [items, setItems] = useState<Provider[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [providerType, setProviderType] = useState<'openai' | 'openclaw' | 'worktool_callback'>('openai');
  const [useCustomOpenaiUrl, setUseCustomOpenaiUrl] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testDebugOpen, setTestDebugOpen] = useState(false);
  const [testDebugTitle, setTestDebugTitle] = useState('模型测试诊断');
  const [testDebugData, setTestDebugData] = useState<any>(null);
  const [form] = Form.useForm();

  const normalizeProviderPayload = (rawValues: any, isEditing: boolean) => {
    const values = { ...rawValues };
    if (values.provider_type === 'openai') {
      if (values.base_url_preset && values.base_url_preset !== '__custom__') {
        values.base_url = values.base_url_preset;
      } else {
        values.base_url = normalizeOpenaiBaseUrl(values.base_url_openai);
      }
    } else {
      values.base_url = values.base_url_openclaw;
    }
    delete values.base_url_preset;
    delete values.base_url_openai;
    delete values.base_url_openclaw;
    delete values.include_asker_info;
    values.auth_scheme = values.provider_type === 'openclaw' ? 'x-openclaw-token' : 'bearer';
    values.asker_info_mode = values.asker_info_mode || 'off';
    if (!values.api_token) {
      values.api_token = '';
    }
    if (isEditing && !values.api_token) {
      delete values.api_token;
    }
    return values;
  };

  const load = async () => {
    try {
      const ps = await api.listProviders();
      setItems(ps);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '加载AI回复引擎失败');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const submit = async () => {
    try {
      setSaving(true);
      const rawValues = await form.validateFields();
      const values = normalizeProviderPayload(rawValues, Boolean(editing));
      if (editing) {
        await api.updateProvider(editing.id, values);
        message.success('AI回复引擎更新成功');
      } else {
        await api.createProvider(values);
        message.success('AI回复引擎创建成功');
      }
      setOpen(false);
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const onTestProvider = async () => {
    try {
      const rawValues = await form.validateFields();
      const values = normalizeProviderPayload(rawValues, Boolean(editing));
      if (editing) {
        values.provider_id = editing.id;
      }
      setTesting(true);
      const res = await api.providerTest(values);
      const sec = Number(res?.elapsed_seconds || 0);
      message.success(`测试成功，响应耗时 ${sec.toFixed(1)}s`);
    } catch (e: any) {
      const status = e?.response?.status;
      const detail = e?.response?.data?.detail;
      const msg = (typeof detail === 'string' ? detail : detail?.message) || e?.message || '测试失败';
      message.error(msg);
      if (detail?.debug) {
        setTestDebugTitle(`测试失败（HTTP ${status || '-'}）`);
        setTestDebugData(detail.debug);
        setTestDebugOpen(true);
      }
    } finally {
      setTesting(false);
    }
  };

  const onDeleteProvider = async (row: Provider) => {
    try {
      await api.deleteProvider(row.id);
      message.success('AI回复引擎已删除');
      await load();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || '删除失败');
    }
  };

  const baseUrlHelp = (
    <Space direction="vertical" size={4}>
      <div>这是啥：AI 服务接口地址。</div>
      <div>为什么填：系统要通过它把用户问题发给模型。</div>
      <div>怎么填：优先使用下拉默认地址，只有自建服务才手动填写。</div>
      <div>示例：一般不用改，默认即可</div>
    </Space>
  );

  const tokenHelp = (
    <Space direction="vertical" size={4}>
      <div>这是啥：你的模型访问凭证。</div>
      <div>为什么填：部分平台需要，部分平台可留空。</div>
      <div>怎么填：去对应模型平台复制后粘贴；不需要可留空。</div>
      <div>示例：仅你自己的模型密钥，不会明文展示。</div>
    </Space>
  );

  const modelHelp = (
    <Space direction="vertical" size={4}>
      <div>这是啥：模型标识，部分平台也叫 model_id。</div>
      <div>为什么填：同一个平台有多个模型，不填可能调用到错误模型。</div>
      <div>怎么填：到模型平台控制台/API文档中查“模型名称”或“model_id”。</div>
      <div>示例：doubao-seed-2.0-lite、gpt-4o-mini、Qwen/Qwen3-8B</div>
    </Space>
  );

  const systemPromptHelp = (
    <Space direction="vertical" size={4}>
      <div>这是啥：该引擎统一生效的系统提示词模板。</div>
      <div>为什么填：同一企业下多个机器人可共享一致回复风格。</div>
      <div>怎么填：保留花括号变量，系统会在运行时自动替换。</div>
      <div>示例：你是企业微信机器人[{`{robot_name}`}]，请先给结论再给步骤。</div>
    </Space>
  );

  return (
    <Card
      title={(
        <Space direction="vertical" size={0}>
          <span>AI回复引擎</span>
          <Typography.Text type="secondary">管理机器人回复时调用的模型服务</Typography.Text>
        </Space>
      )}
      extra={<Button type="primary" onClick={() => {
        setEditing(null);
        form.resetFields();
        setProviderType('openai');
        setUseCustomOpenaiUrl(false);
        form.setFieldsValue({
          enabled: true,
          asker_info_mode: 'off',
          system_prompt_template: DEFAULT_PROVIDER_SYSTEM_PROMPT_TEMPLATE,
          provider_type: 'openai',
          base_url_preset: OPENAI_BASE_OPTIONS[0].value,
          base_url_openai: OPENAI_BASE_OPTIONS[0].value,
          base_url_openclaw: ''
        });
        setOpen(true);
      }}>新增 AI回复引擎</Button>}
    >
      <Table
        rowKey="id"
        dataSource={items}
        columns={[
          {
            title: '序号',
            width: 80,
            render: (_: unknown, __: Provider, index: number) => index + 1
          },
          { title: '名称', dataIndex: 'name' },
          { title: '类型', dataIndex: 'provider_type', width: 110 },
          { title: 'Base URL', dataIndex: 'base_url', render: (v: string) => <HoverPreviewText value={v} maxWidth={360} popupWidth={760} /> },
          {
            title: '使用机器人',
            width: 120,
            render: (_: unknown, row: Provider) => {
              if (row.is_system) return <Typography.Text type="secondary">-</Typography.Text>;
              const ids = Array.isArray(row.used_robot_ids) ? row.used_robot_ids : [];
              const count = Number(row.used_robot_count || ids.length || 0);
              if (!count) return <Typography.Text type="secondary">0个</Typography.Text>;
              return (
                <Popover
                  trigger="hover"
                  placement="top"
                  content={(
                    <Space direction="vertical" size={2}>
                      {ids.map((id) => (
                        <Typography.Text key={id} code>{id}</Typography.Text>
                      ))}
                    </Space>
                  )}
                >
                  <Typography.Text>{count}个</Typography.Text>
                </Popover>
              );
            }
          },
          { title: 'Token', dataIndex: 'api_token_masked' },
          {
            title: '状态',
            dataIndex: 'enabled',
            render: (v, row: Provider) => (row.is_system ? '系统默认' : v ? '启用' : '停用')
          },
          {
            title: '操作',
            render: (_, row: Provider) => (
              <Space>
                {row.can_manage === false ? (
                  <Typography.Text type="secondary">无法修改</Typography.Text>
                ) : (
                  <>
                    <Button size="small" onClick={() => {
                      setEditing(row);
                      const nextType = row.provider_type || 'openai';
                      setProviderType(nextType);
                      const preset = OPENAI_BASE_OPTIONS.find((x) => x.value === row.base_url);
                      const custom = nextType === 'openai' && !preset;
                      setUseCustomOpenaiUrl(custom);
                      form.setFieldsValue({
                        name: row.name,
                        base_url_openai: row.base_url,
                        base_url_openclaw: row.base_url,
                        base_url_preset: preset ? preset.value : '__custom__',
                        model: row.model,
                        provider_type: nextType,
                        extra_json: row.extra_json || '',
                        system_prompt_template: String((row as any)?.system_prompt_template || '').trim() || DEFAULT_PROVIDER_SYSTEM_PROMPT_TEMPLATE,
                        asker_info_mode: row.asker_info_mode || 'off',
                        enabled: row.enabled
                      });
                      setOpen(true);
                    }}>编辑</Button>
                    <Popconfirm
                      title="确认删除该AI回复引擎？"
                      description={`名称：${row.name || '-'}`}
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => void onDeleteProvider(row)}
                    >
                      <Button size="small" danger>删除</Button>
                    </Popconfirm>
                  </>
                )}
              </Space>
            )
          }
        ]}
      />

      <Modal
        title={editing ? '编辑 AI回复引擎' : '新增 AI回复引擎'}
        open={open}
        onCancel={() => setOpen(false)}
        footer={[
          <Button
            key="test"
            onClick={() => void onTestProvider()}
            loading={testing}
            style={{ background: '#fff1f0', borderColor: '#ffccc7', color: '#cf1322' }}
          >
            测试接口
          </Button>,
          <Button key="cancel" onClick={() => setOpen(false)}>
            取消
          </Button>,
          <Button key="ok" type="primary" loading={saving} onClick={() => void submit()}>
            确定
          </Button>
        ]}
        destroyOnClose
        width={680}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="provider_type" label="引擎类型" rules={[{ required: true }]}>
            <Select
              onChange={(v: 'openai' | 'openclaw' | 'worktool_callback') => {
                setProviderType(v);
                if (v === 'openai') {
                  const current = form.getFieldValue('base_url_openai') || '';
                  const preset = OPENAI_BASE_OPTIONS.find((x) => x.value === current);
                  if (preset) {
                    setUseCustomOpenaiUrl(false);
                    form.setFieldsValue({ base_url_preset: preset.value });
                  } else if (current) {
                    setUseCustomOpenaiUrl(true);
                    form.setFieldsValue({ base_url_preset: '__custom__' });
                  } else {
                    setUseCustomOpenaiUrl(false);
                    form.setFieldsValue({ base_url_preset: OPENAI_BASE_OPTIONS[0].value, base_url_openai: OPENAI_BASE_OPTIONS[0].value });
                  }
                }
              }}
              options={[
                { label: 'openai(大模型)', value: 'openai' },
                { label: 'openclaw(小龙虾)', value: 'openclaw' },
                { label: 'WorkTool 消息回调格式', value: 'worktool_callback' }
              ]}
            />
          </Form.Item>
          {providerType === 'openai' ? (
            <>
              <Form.Item
                name="base_url_preset"
                label={(
                  <Space size={6}>
                    <span>Base URL</span>
                    <Popover content={baseUrlHelp} trigger="hover" placement="right">
                      <QuestionCircleOutlined style={{ color: '#8c8c8c' }} />
                    </Popover>
                  </Space>
                )}
                rules={[{ required: true }]}
              >
                <Select
                  options={OPENAI_BASE_OPTIONS}
                  onChange={(v: string) => {
                    if (v === '__custom__') {
                      setUseCustomOpenaiUrl(true);
                      if (!form.getFieldValue('base_url_openai')) {
                        form.setFieldsValue({ base_url_openai: 'https://' });
                      }
                      return;
                    }
                    setUseCustomOpenaiUrl(false);
                    form.setFieldsValue({ base_url_openai: v });
                  }}
                />
              </Form.Item>
              {useCustomOpenaiUrl ? (
                <Form.Item
                  name="base_url_openai"
                  label={(
                    <Space size={6}>
                      <span>手动 Base URL</span>
                      <Popover content={baseUrlHelp} trigger="hover" placement="right">
                        <QuestionCircleOutlined style={{ color: '#8c8c8c' }} />
                      </Popover>
                    </Space>
                  )}
                  rules={[{ required: true }]}
                >
                  <Input
                    placeholder="https://your-endpoint/v1/chat/completions"
                    onBlur={(e) => {
                      const normalized = normalizeOpenaiBaseUrl(e.target.value);
                      if (normalized !== e.target.value) {
                        form.setFieldsValue({ base_url_openai: normalized });
                      }
                    }}
                  />
                </Form.Item>
              ) : null}
            </>
          ) : (
            <>
              <Form.Item
                name="base_url_openclaw"
                label={(
                  <Space size={6}>
                    <span>Base URL</span>
                    <Popover content={baseUrlHelp} trigger="hover" placement="right">
                      <QuestionCircleOutlined style={{ color: '#8c8c8c' }} />
                    </Popover>
                  </Space>
                )}
                rules={[{ required: true }]}
              >
                <Input placeholder={OPENCLAW_WEBHOOK_HINT} />
              </Form.Item>
              {providerType === 'openclaw' ? <Typography.Text type="secondary" style={{ display: 'block', marginTop: -8, marginBottom: 8 }}>
                容器化部署小龙虾（官方一键脚本，含 WorkTool 插件）：
                {' '}
                <a href="https://github.com/answerlink/openclaw-worktool" target="_blank" rel="noopener noreferrer">
                  github.com/answerlink/openclaw-worktool
                </a>
              </Typography.Text> : <Typography.Text type="secondary" style={{ display: 'block', marginTop: -8, marginBottom: 8 }}>
                Console 会先完成消息记录、规则匹配和群聊判定，再将 WorkTool 原始回调 JSON 原样 POST 到此地址。
              </Typography.Text>}
            </>
          )}
          <Form.Item
            name="api_token"
            label={(
              <Space size={6}>
                <span>API Token</span>
                <Popover content={tokenHelp} trigger="hover" placement="right">
                  <QuestionCircleOutlined style={{ color: '#8c8c8c' }} />
                </Popover>
              </Space>
            )}
          >
            <Input.Password placeholder={editing ? '留空表示不变更（也可不填）' : '可选，不需要可留空'} />
          </Form.Item>
          {providerType === 'openai' ? (
            <>
              <Form.Item
                name="model"
                label={(
                  <Space size={6}>
                    <span>Model</span>
                    <Popover content={modelHelp} trigger="hover" placement="right">
                      <QuestionCircleOutlined style={{ color: '#8c8c8c' }} />
                    </Popover>
                  </Space>
                )}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="extra_json"
                label="扩展 JSON"
                tooltip='可选，例如 {"request_headers":{"x-openclaw-agent-id":"xxx"},"push_secret":"xxx"}'
              >
                <Input.TextArea rows={5} />
              </Form.Item>
              <Form.Item
                name="asker_info_mode"
                label="提问人信息注入模式"
                tooltip="默认关闭；覆盖模式会注入 system_prompt，额外字段模式只发送 variables.prompt_inject。"
                initialValue="off"
              >
                <Select
                  options={[
                    { label: '关闭（默认）', value: 'off' },
                    { label: '覆盖 system_prompt', value: 'system_prompt' },
                    { label: '额外字段 variables.prompt_inject', value: 'variables' },
                  ]}
                />
              </Form.Item>
              <Typography.Text type="secondary" style={{ display: 'block', marginTop: -8, marginBottom: 8 }}>
                选择“额外字段”时，只会发送 <code>variables.prompt_inject</code>，不会由 console 覆盖 system_prompt。请在第三方流程中把该值拼接到 system_prompt。
                {' '}示例：<code>{`{"variables":{"prompt_inject":"..."}}`}</code>
              </Typography.Text>
              <Form.Item
                name="system_prompt_template"
                label={(
                  <Space size={6}>
                    <span>系统提示词模板</span>
                    <Popover content={systemPromptHelp} trigger="hover" placement="right">
                      <QuestionCircleOutlined style={{ color: '#8c8c8c' }} />
                    </Popover>
                  </Space>
                )}
              >
                <Input.TextArea rows={9} placeholder={DEFAULT_PROVIDER_SYSTEM_PROMPT_TEMPLATE} />
              </Form.Item>
              <Space style={{ marginTop: -8, marginBottom: 12 }}>
                <Button
                  size="small"
                  onClick={() => form.setFieldsValue({ system_prompt_template: DEFAULT_PROVIDER_SYSTEM_PROMPT_TEMPLATE })}
                >
                  一键重置成默认值
                </Button>
                <Typography.Text type="secondary">
                  支持变量：{'{robot_name}'} {'{current_asker}'} {'{colleague_line}'} {'{colleague_list}'} {'{scene}'} {'{sender_name}'} {'{group_name}'} {'{last_message}'} {'{recent_context}'}
                </Typography.Text>
              </Space>
            </>
          ) : null}
          <Form.Item name="enabled" valuePropName="checked" label="启用">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={testDebugTitle}
        open={testDebugOpen}
        onCancel={() => setTestDebugOpen(false)}
        width={860}
        footer={[
          <Button
            key="copy-curl"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(String(testDebugData?.curl || ''));
                message.success('cURL 已复制');
              } catch {
                message.error('复制失败');
              }
            }}
            disabled={!testDebugData?.curl}
          >
            复制 cURL
          </Button>,
          <Button
            key="copy-json"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(JSON.stringify(testDebugData || {}, null, 2));
                message.success('诊断JSON 已复制');
              } catch {
                message.error('复制失败');
              }
            }}
            disabled={!testDebugData}
          >
            复制诊断JSON
          </Button>,
          <Button key="close" type="primary" onClick={() => setTestDebugOpen(false)}>
            关闭
          </Button>
        ]}
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Typography.Text strong>请求 URL</Typography.Text>
          <Input.TextArea readOnly rows={2} value={String(testDebugData?.request?.url || '')} />
          <Typography.Text strong>请求 Header</Typography.Text>
          <Input.TextArea readOnly rows={6} value={JSON.stringify(testDebugData?.request?.headers || {}, null, 2)} />
          <Typography.Text strong>请求 Body(JSON)</Typography.Text>
          <Input.TextArea readOnly rows={10} value={JSON.stringify(testDebugData?.request?.request_body || {}, null, 2)} />
          <Typography.Text strong>cURL</Typography.Text>
          <Input.TextArea readOnly rows={7} value={String(testDebugData?.curl || '')} />
          <Typography.Text strong>响应体</Typography.Text>
          <Input.TextArea readOnly rows={8} value={typeof testDebugData?.response_body === 'string' ? testDebugData.response_body : JSON.stringify(testDebugData?.response_body || {}, null, 2)} />
        </Space>
      </Modal>
    </Card>
  );
}
