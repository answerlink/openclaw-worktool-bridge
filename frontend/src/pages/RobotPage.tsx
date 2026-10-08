import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDownOutlined, ArrowUpOutlined, DownloadOutlined, QuestionCircleOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Collapse, Form, Input, InputNumber, Modal, Popconfirm, Popover, Select, Space, Switch, Table, Tabs, Tag, Tour, Typography, Upload, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { Provider, Robot, Rule } from '../types';
import { getLastSelectedRobotId, setLastSelectedRobotId } from '../robotSelection';
import { createRobotCsvTemplate, parseRobotCsv, type RobotCsvRow } from '../robotCsvImport';

function splitLines(text: string): string[] {
  return String(text || '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
}

function helpLabel(title: string, content: ReactNode) {
  return (
    <Space size={6}>
      <span>{title}</span>
      <Popover content={content} trigger={['hover', 'click']} placement="right">
        <Button type="text" size="small" aria-label={`${title}说明`} icon={<QuestionCircleOutlined style={{ color: '#8c8c8c' }} />} />
      </Popover>
    </Space>
  );
}

function matchModeLabel(mode?: 'all' | 'exact' | 'regex') {
  if (mode === 'all') return '全部';
  if (mode === 'exact') return '完全相同';
  return '包含关键词';
}

function renderRuleMatcher(mode: 'all' | 'exact' | 'regex' | undefined, pattern?: string | null) {
  const m = mode || 'regex';
  if (m === 'all') return '全部';
  const text = (pattern || '').trim();
  const label = m === 'regex' && (text.startsWith('^') || text.endsWith('$')) ? '正则表达式' : matchModeLabel(m);
  return `${label}：${text || '-'}`;
}

const DEFAULT_GROUP_DECISION_PROMPT_TEMPLATE = `你是群聊回复门控器。请判断最后一条消息是否应由机器人在群聊公开回复。
规则：如果最后一条是在问机器人问题，或者是售前售后咨询/功能答疑/问题排查，则返回 YES；
如果更像成员间闲聊、互相对话、与机器人无关，则返回 NO。
只允许输出 YES 或 NO，不要输出其他任何文字。

群名：{group_name}
发送者：{sender_name}
最后一条消息：{last_message}
近期上下文：
{recent_context}
`;

export default function RobotPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Robot[]>([]);
  const [robotsLoaded, setRobotsLoaded] = useState(false);
  const [selectedRobotId, setSelectedRobotId] = useState<string | undefined>(() => getLastSelectedRobotId());
  const [providers, setProviders] = useState<Provider[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [configLoadError, setConfigLoadError] = useState('');
  const [customCallbackWarning, setCustomCallbackWarning] = useState(false);
  const [ruleScene, setRuleScene] = useState<'group' | 'private'>('group');

  const [robotOpen, setRobotOpen] = useState(false);
  const [editingRobotId, setEditingRobotId] = useState<string | null>(null);
  const [csvRows, setCsvRows] = useState<RobotCsvRow[]>([]);
  const [csvPreviewRows, setCsvPreviewRows] = useState<RobotCsvRow[]>([]);
  const [csvPreviewOpen, setCsvPreviewOpen] = useState(false);
  const [robotForm] = Form.useForm();

  const [ruleOpen, setRuleOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [ruleForm] = Form.useForm();
  const [ruleSwitchLoading, setRuleSwitchLoading] = useState<number[]>([]);
  const [replyChannelSaving, setReplyChannelSaving] = useState(false);
  const [groupReplyModeSaving, setGroupReplyModeSaving] = useState(false);
  const [providerRefreshing, setProviderRefreshing] = useState(false);
  const [showAddRobotTour, setShowAddRobotTour] = useState(false);
  const addRobotBtnRef = useRef<HTMLElement | null>(null);

  const selectRobot = (robotId?: string) => {
    setSelectedRobotId(robotId);
    setLastSelectedRobotId(robotId);
  };

  const loadRobots = async () => {
    const robots = await api.listRobots();
    setItems(robots);
    setRobotsLoaded(true);
  };

  const toggleReplyChannel = async (enabled: boolean) => {
    if (!selectedRobotId || replyChannelSaving) return;
    const robotId = selectedRobotId;
    const scene = ruleScene;
    const field = scene === 'group' ? 'group_chat_enabled' : 'private_chat_enabled';
    setReplyChannelSaving(true);
    try {
      await api.updateRobot(robotId, { [field]: enabled });
      setItems((current) => current.map((robot) => robot.robot_id === robotId ? { ...robot, [field]: enabled } : robot));
      message.success(`${scene === 'group' ? '群聊' : '私聊'}自动回复已${enabled ? '开启' : '暂停'}`);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '未能修改自动回复状态，请稍后重试');
    } finally {
      setReplyChannelSaving(false);
    }
  };

  const changeGroupReplyMode = async (mode: NonNullable<Robot['group_reply_mode']>) => {
    if (!selectedRobotId || groupReplyModeSaving) return;
    const robotId = selectedRobotId;
    setGroupReplyModeSaving(true);
    try {
      await api.updateRobot(robotId, { group_reply_mode: mode });
      setItems((current) => current.map((robot) => robot.robot_id === robotId
        ? { ...robot, group_reply_mode: mode, group_reply_only_when_mentioned: mode === 'mention_only' } : robot));
      message.success('群聊回复方式已保存');
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '未能保存群聊回复方式，请稍后重试');
    } finally {
      setGroupReplyModeSaving(false);
    }
  };

  const loadRulesAndProviders = async (robotId?: string) => {
    if (!robotId) {
      setRules([]);
      setProviders([]);
      setCustomCallbackWarning(false);
      return;
    }
    setConfigLoadError('');
    try {
      const [providerRes, callbackRes, settingsRes] = await Promise.all([
        api.listProviders(robotId),
        api.getRobotInfoCallbacks(robotId).catch(() => null),
        api.getWorktoolSettings().catch(() => null),
      ]);
      setProviders(providerRes);
      const callbackRows = Array.isArray(callbackRes?.data) ? callbackRes.data : [];
      const messageCallback = callbackRows.find((row: any) => Number(row?.type) === 11);
      const currentUrl = String(messageCallback?.callBackUrl || messageCallback?.callbackUrl || '').trim().replace(/\/+$/, '');
      const configuredTemplate = String(settingsRes?.callback_example_url || '').trim();
      const expectedUrl = configuredTemplate
        .replace(/\{robot_id\}/g, robotId)
        .replace(/\/+$/, '');
      setCustomCallbackWarning(!currentUrl || !expectedUrl || currentUrl !== expectedUrl);
      try {
        const ruleRes = await api.listRules(robotId);
        setRules(ruleRes);
      } catch (e: any) {
        setRules([]);
        setConfigLoadError(e?.response?.data?.detail || e?.message || '回复规则加载失败');
      }
    } catch (e: any) {
      setProviders([]);
      setRules([]);
      setConfigLoadError(e?.response?.data?.detail || e?.message || 'AI回复引擎加载失败');
    }
  };

  const refreshProviders = async () => {
    setProviderRefreshing(true);
    try {
      const providerRes = await api.listProviders(selectedRobotId);
      setProviders(providerRes);
      message.success('回复引擎列表已刷新');
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '刷新AI回复引擎失败');
    } finally {
      setProviderRefreshing(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      await loadRobots();
    };
    void init();
  }, []);

  useEffect(() => {
    if (!robotsLoaded) return;
    if (items.length === 0) {
      selectRobot(undefined);
      return;
    }
    const current = selectedRobotId;
    if (!current || !items.some((x) => x.robot_id === current)) {
      selectRobot(items[0].robot_id);
    }
  }, [robotsLoaded, items, selectedRobotId]);

  useEffect(() => {
    void loadRulesAndProviders(selectedRobotId);
  }, [selectedRobotId]);

  useEffect(() => {
    if (!robotsLoaded || items.length > 0) return;
    try {
      const tourKey = 'onboarding_add_robot_tour_v1';
      const shown = localStorage.getItem(tourKey) === '1';
      if (!shown) {
        setShowAddRobotTour(true);
        localStorage.setItem(tourKey, '1');
      }
    } catch {
      setShowAddRobotTour(true);
    }
  }, [robotsLoaded, items.length]);

  const robotOptions = useMemo(
    () => items.map((r) => ({ label: r.name ? `${r.name} (${r.robot_id})` : r.robot_id, value: r.robot_id })),
    [items]
  );

  const sceneRules = useMemo(
    () => [...rules].filter((r) => r.scene === ruleScene).sort((a, b) => a.priority - b.priority || a.id - b.id),
    [rules, ruleScene]
  );

  const onMoveRule = async (rule: Rule, direction: -1 | 1) => {
    if (!selectedRobotId) return;
    const list = [...sceneRules];
    const index = list.findIndex((r) => r.id === rule.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    try {
      await api.reorderRules(selectedRobotId, ruleScene, list.map((r) => r.id));
      message.success('规则排序已更新');
      await loadRulesAndProviders(selectedRobotId);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '规则排序失败');
    }
  };

  const onCreateRobot = () => {
    setEditingRobotId(null);
    setCsvRows([]);
    robotForm.resetFields();
    robotForm.setFieldsValue({
      name: '机器人',
      group_default_reply: '',
      private_default_reply: '',
      private_chat_enabled: true,
      group_chat_enabled: true,
      group_reply_only_when_mentioned: false,
      group_reply_mode: 'always',
      group_decision_provider_id: undefined,
      group_decision_prompt_template: DEFAULT_GROUP_DECISION_PROMPT_TEMPLATE,
      group_colleagues_text: ''
    });
    setRobotOpen(true);
  };

  const onEditRobot = async (robotId: string) => {
    try {
      const res = await api.getRobot(robotId);
      setEditingRobotId(robotId);
      setCsvRows([]);
      const groupReplyMode = res?.group_reply_mode || (res?.group_reply_only_when_mentioned ? 'mention_only' : 'always');
      robotForm.resetFields();
      robotForm.setFieldsValue({
        robot_id: robotId,
        name: res?.name || '',
        group_default_reply: res?.defaults?.group || '',
        private_default_reply: res?.defaults?.private || '',
        group_chat_enabled: res?.group_chat_enabled !== false,
        private_chat_enabled: res?.private_chat_enabled !== false,
        group_reply_only_when_mentioned: !!res?.group_reply_only_when_mentioned,
        group_reply_mode: groupReplyMode,
        group_decision_provider_id: res?.group_decision_provider_id ?? undefined,
        group_decision_prompt_template: String(res?.group_decision_prompt_template || '').trim() || DEFAULT_GROUP_DECISION_PROMPT_TEMPLATE,
        group_colleagues_text: Array.isArray(res?.group_colleagues) ? res.group_colleagues.join('\n') : ''
      });
      setRobotOpen(true);
    } catch (e: any) {
      Modal.error({
        title: '读取机器人失败',
        content: e?.response?.data?.detail || e?.message || '未知错误',
      });
    }
  };

  const onDeleteRobot = async (row: Robot) => {
    await api.deleteRobot(row.robot_id);
    message.success('机器人已从当前账号解绑，配置和标签已保留');
    await loadRobots();
    if (selectedRobotId === row.robot_id) {
      selectRobot(undefined);
      setRules([]);
    }
  };

  const submitRobot = async () => {
    await robotForm.validateFields();
    const values = { ...robotForm.getFieldsValue(true) };
    if (values.group_reply_mode === 'ai_decide' && !values.group_decision_provider_id) values.group_decision_provider_id = null;
    values.group_decision_prompt_template = String(values.group_decision_prompt_template || '').trim() || null;
    values.group_colleagues = splitLines(String(values.group_colleagues_text || ''));
    delete values.group_colleagues_text;
    try {
      if (editingRobotId) {
        delete values.private_chat_enabled;
        delete values.group_chat_enabled;
        delete values.group_reply_mode;
        delete values.group_reply_only_when_mentioned;
        await api.updateRobot(editingRobotId, values);
        await loadRobots();
        message.success('机器人更新成功');
      } else {
        values.name = (values.name || '').trim() || '机器人';
        const robotIds = String(values.robot_id || '')
          .split(/[,，\n]+/)
          .map((id) => id.trim())
          .filter(Boolean)
          .filter((id, index, all) => all.indexOf(id) === index);
        if (!robotIds.length) {
          throw new Error('请输入至少一个 Robot ID');
        }
        const entries = csvRows.length
          ? csvRows.map((row) => ({ robotId: row.robotId, name: row.name }))
          : robotIds.map((robotId) => ({ robotId, name: values.name }));
        const results: Array<{ robotId: string; response?: any; error?: string }> = [];
        for (const entry of entries) {
          try {
            const response = await api.createRobot({
              ...values,
              robot_id: entry.robotId,
              name: entry.name,
              update_name_if_exists: csvRows.length > 0,
            });
            results.push({ robotId: entry.robotId, response });
          } catch (error: any) {
            results.push({ robotId: entry.robotId, error: error?.response?.data?.detail || error?.message || '创建失败' });
          }
        }
        await loadRobots();
        const succeeded = results.filter((item) => !item.error);
        const failed = results.filter((item) => item.error);
        if (succeeded.length) selectRobot(succeeded[0].robotId);
        if (failed.length) {
          Modal.warning({
            title: `批量添加完成：成功 ${succeeded.length} 个，失败 ${failed.length} 个`,
            content: <Space direction="vertical" size={4}>{failed.map((item) => <Typography.Text key={item.robotId}><Typography.Text code>{item.robotId}</Typography.Text>：{item.error}</Typography.Text>)}</Space>,
          });
          if (!succeeded.length) return;
        } else if (succeeded.length > 1) {
          message.success(`已批量添加 ${succeeded.length} 个机器人`);
        } else {
          const res = succeeded[0]?.response;
          const baseText = res?.existed ? '机器人已存在，已添加到当前账号' : '机器人创建成功';
          message.success(baseText);
        }
      }
      setRobotOpen(false);
    } catch (e: any) {
      Modal.error({
        title: editingRobotId ? '更新失败' : '创建失败',
        content: e?.response?.data?.detail || e?.message || '未知错误',
      });
    }
  };

  const downloadRobotCsvTemplate = () => {
    const blob = new Blob([createRobotCsvTemplate()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '机器人批量导入模板.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const readRobotCsv = async (file: File) => {
    if (file.size > 1024 * 1024) {
      message.error('CSV 文件不能超过 1 MB');
      return false;
    }
    try {
      const rows = parseRobotCsv(await file.text());
      setCsvPreviewRows(rows);
      setCsvPreviewOpen(true);
    } catch (error: any) {
      message.error(error?.message || 'CSV 解析失败');
    }
    return false;
  };

  const onCreateRule = () => {
    if (!selectedRobotId) {
      message.warning('请先选择机器人');
      return;
    }
    setEditingRule(null);
    ruleForm.resetFields();
    ruleForm.setFieldsValue({
      robot_id: selectedRobotId,
      scene: ruleScene,
      pattern_match_type: 'all',
      content_match_type: 'all',
      enabled: true,
      priority: 100
    });
    setRuleOpen(true);
  };

  const onEditRule = (row: Rule) => {
    setEditingRule(row);
    ruleForm.resetFields();
    ruleForm.setFieldsValue({
      ...row,
      pattern_match_type: row.pattern_match_type || 'regex',
      content_match_type: row.content_match_type || 'regex',
      pattern: row.pattern || '',
      content_pattern: row.content_pattern || ''
    });
    setRuleOpen(true);
  };

  const submitRule = async () => {
    try {
      await ruleForm.validateFields();
      const values = { ...ruleForm.getFieldsValue(true) };
      values.pattern_match_type = values.pattern_match_type || 'regex';
      values.content_match_type = values.content_match_type || 'regex';
      values.pattern = (values.pattern || '').trim();
      values.content_pattern = (values.content_pattern || '').trim();
      if (values.pattern_match_type !== 'all' && !values.pattern) {
        message.warning(`请填写${ruleTargetName}，或选择${activeRuleScene === 'group' ? '所有群聊' : '所有联系人'}`);
        return;
      }
      if (values.content_match_type !== 'all' && !values.content_pattern) {
        message.warning('请填写要回复的消息内容，或选择所有消息');
        return;
      }
      if (editingRule) {
        await api.updateRule(editingRule.id, values);
        message.success('回复规则已保存');
      } else {
        await api.createRule(values);
        message.success('回复规则已添加');
      }
      setRuleOpen(false);
      await loadRulesAndProviders(selectedRobotId);
    } catch (e: any) {
      if (Array.isArray(e?.errorFields) && e.errorFields.length > 0) {
        const fieldOrder = ['pattern_match_type', 'pattern', 'content_match_type', 'content_pattern', 'provider_id', 'priority'];
        const firstField = fieldOrder.map((name) => e.errorFields.find((field: any) => field.name.includes(name))).find(Boolean) || e.errorFields[0];
        ruleForm.scrollToField(firstField.name, { focus: true });
        return;
      }
      const detail = e?.response?.data?.detail || '暂时无法保存，请稍后重试。你填写的内容仍保留在窗口中。';
      Modal.error({
        title: '回复规则未保存',
        content: detail,
      });
    }
  };

  const toggleRuleEnabled = async (row: Rule, enabled: boolean) => {
    setRuleSwitchLoading((prev) => [...prev, row.id]);
    try {
      await api.updateRule(row.id, { enabled });
      setRules((prev) => prev.map((r) => (r.id === row.id ? { ...r, enabled } : r)));
      message.success(`规则已${enabled ? '启用' : '停用'}`);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '更新规则状态失败');
    } finally {
      setRuleSwitchLoading((prev) => prev.filter((id) => id !== row.id));
    }
  };

  const onDeleteRule = async (row: Rule) => {
    try {
      await api.deleteRule(row.id);
      message.success('回复规则已删除');
      await loadRulesAndProviders(selectedRobotId);
    } catch (e: any) {
      Modal.error({ title: '回复规则未删除', content: e?.response?.data?.detail || '暂时无法删除，请稍后重试。规则仍保留在列表中。' });
    }
  };
  const activeRuleScene = editingRule?.scene || ruleScene;
  const ruleTargetName = activeRuleScene === 'group' ? '群名' : '联系人昵称或备注';
  const ruleTargetExample = activeRuleScene === 'group' ? '财务群' : '张三';
  const hasSelectedRobot = !!selectedRobotId && items.some((r) => r.robot_id === selectedRobotId);
  const selectedRobot = items.find((r) => r.robot_id === selectedRobotId);
  const channelEnabled = selectedRobot?.[ruleScene === 'group' ? 'group_chat_enabled' : 'private_chat_enabled'];
  const groupReplyMode = selectedRobot?.group_reply_mode || (selectedRobot?.group_reply_only_when_mentioned ? 'mention_only' : 'always');

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {configLoadError && <Alert type="error" showIcon message="回复配置加载失败" description={configLoadError}
        action={<Button onClick={() => loadRulesAndProviders(selectedRobotId)}>重新加载</Button>} />}
      <Card
        title={(
          <Space direction="vertical" size={0}>
            <span>机器人配置</span>
            <Typography.Text type="secondary">设置机器人在哪些情况下回复</Typography.Text>
          </Space>
        )}
        extra={<Button ref={addRobotBtnRef as any} type="primary" onClick={onCreateRobot}>添加机器人</Button>}
      >
        {robotsLoaded && items.length === 0 ? (
          <Alert type="info" showIcon message="先添加机器人" description="填写 WorkTool 的 Robot ID 后，即可设置回复方式和规则。" />
        ) : (
          <div className="robot-config-toolbar">
            <div className="robot-config-current">
              <Typography.Text type="secondary">当前机器人</Typography.Text>
              {items.length > 1 ? (
                <Select aria-label="当前机器人" value={selectedRobotId} onChange={selectRobot}
                  options={robotOptions} placeholder="选择机器人" showSearch optionFilterProp="label" />
              ) : <Typography.Text strong>{items.find((r) => r.robot_id === selectedRobotId)?.name || '机器人'}</Typography.Text>}
              {items.length === 1 && <Typography.Text type="secondary" className="robot-config-id">{selectedRobotId}</Typography.Text>}
            </div>
            <Space wrap>
              {!customCallbackWarning && <Button disabled={!hasSelectedRobot} onClick={() => selectedRobotId && void onEditRobot(selectedRobotId)}>回复设置</Button>}
              <Popconfirm title="确认解绑该机器人？"
                description="仅解除当前账号的绑定，机器人配置和标签库会保留。"
                okText="解绑" cancelText="取消" okButtonProps={{ danger: true }}
                onConfirm={() => {
                  const robot = items.find((r) => r.robot_id === selectedRobotId);
                  if (robot) void onDeleteRobot(robot);
                }}>
                <Button type="text" danger disabled={!hasSelectedRobot}>解绑</Button>
              </Popconfirm>
            </Space>
          </div>
        )}
      </Card>
      <Tour
        open={showAddRobotTour}
        onClose={() => setShowAddRobotTour(false)}
        steps={[
          {
            title: '先添加机器人',
            description: '你还没有机器人，请先点击这里添加。完成后再配置规则和AI回复引擎。',
            target: () => (addRobotBtnRef.current || document.body) as HTMLElement,
          }
        ]}
      />

      {customCallbackWarning ? <Alert type="info" showIcon message="回复由你接入的系统处理"
        description="平台回复设置和规则暂不使用。接入平台后，可在这里配置自动回复。"
        action={<Button onClick={() => navigate('/robot-info')}>查看消息接入</Button>} /> : <Card
        title="回复规则"
        extra={<Button type="primary" onClick={onCreateRule} disabled={!hasSelectedRobot}>新增规则</Button>}
      >
        <Tabs
          activeKey={ruleScene}
          onChange={(k) => setRuleScene(k as 'group' | 'private')}
          tabBarExtraContent={<Space wrap>
            <Typography.Text>{ruleScene === 'group' ? '群聊' : '私聊'}自动回复</Typography.Text>
            <Switch aria-label={`${ruleScene === 'group' ? '群聊' : '私聊'}自动回复`} checked={channelEnabled === true}
              loading={replyChannelSaving} disabled={!hasSelectedRobot || typeof channelEnabled !== 'boolean'}
              onChange={(enabled) => void toggleReplyChannel(enabled)} />
          </Space>}
          items={[
            { key: 'group', label: '群聊规则' },
            { key: 'private', label: '私聊规则' }
          ]}
        />
        {ruleScene === 'group' && hasSelectedRobot && <div style={{ marginBottom: 16 }}>
          <Space wrap>
            <Typography.Text id="group-reply-mode-label">群里什么时候回复？</Typography.Text>
            <Select aria-labelledby="group-reply-mode-label" value={groupReplyMode} loading={groupReplyModeSaving}
              disabled={groupReplyModeSaving} style={{ width: 260, maxWidth: '100%' }}
              onChange={(mode) => void changeGroupReplyMode(mode)} options={[
                { label: '符合回复规则就回复', value: 'always' },
                { label: '只有 @ 机器人时回复', value: 'mention_only' },
                { label: '让 AI 判断是否需要回复', value: 'ai_decide' }
              ]} />
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
            {groupReplyMode === 'ai_decide'
              ? '有人 @ 机器人时直接按规则回复；其他消息先由 AI 判断是否需要回复，减少打扰。默认使用平台判定引擎，可在回复设置中调整。'
              : groupReplyMode === 'mention_only'
                ? '只有收到 @ 机器人的消息，才会按下方规则处理。'
                : '收到的群聊消息会按下方规则处理。'}
          </Typography.Paragraph>
        </div>}
        {channelEnabled === false && <Alert type="info" showIcon message="已暂停，规则保留"
          description={`开启${ruleScene === 'group' ? '群聊' : '私聊'}自动回复后，将继续使用以下规则和未匹配规则时的回复设置。`}
          style={{ marginBottom: 16 }} />}
        <Table
          rowKey="id"
          dataSource={sceneRules}
          showHeader={sceneRules.length > 0}
          scroll={{ x: 1000 }}
          pagination={false}
          locale={{ emptyText: hasSelectedRobot ? '暂无回复规则，点击“新增规则”开始配置' : '添加机器人后即可配置回复规则' }}
          columns={[
            {
              title: '序号',
              width: 80,
              render: (_: unknown, __: Rule, index: number) => index + 1
            },
            {
              title: ruleScene === 'group' ? '适用群聊' : '适用联系人',
              render: (_, row: Rule) => row.pattern_match_type === 'all' ? (row.scene === 'group' ? '所有群聊' : '所有联系人') : renderRuleMatcher(row.pattern_match_type, row.pattern)
            },
            {
              title: '需要回复的消息',
              render: (_, row: Rule) => row.content_match_type === 'all' ? '所有消息' : renderRuleMatcher(row.content_match_type, row.content_pattern)
            },
            { title: '回复引擎', dataIndex: 'provider_name' },

            {
              title: '启用',
              width: 90,
              render: (_, row: Rule) => (
                <Switch
                  size="small"
                  checked={row.enabled}
                  loading={ruleSwitchLoading.includes(row.id)}
                  onChange={(checked) => void toggleRuleEnabled(row, checked)}
                />
              )
            },
            {
              title: '排序',
              width: 120,
              render: (_, row: Rule) => (
                <Space>
                  <Button size="small" aria-label="将规则上移" title="上移" disabled={sceneRules[0]?.id === row.id} icon={<ArrowUpOutlined />} onClick={() => onMoveRule(row, -1)} />
                  <Button size="small" aria-label="将规则下移" title="下移" disabled={sceneRules[sceneRules.length - 1]?.id === row.id} icon={<ArrowDownOutlined />} onClick={() => onMoveRule(row, 1)} />
                </Space>
              )
            },
            {
              title: '操作',
              render: (_, row: Rule) => (
                <Space>
                  <Button size="small" onClick={() => onEditRule(row)}>编辑</Button>
                  <Popconfirm
                    title="删除这条回复规则？"
                    description="删除后，这条规则将不再用于自动回复。其他规则不受影响。"
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => void onDeleteRule(row)}
                  >
                    <Button size="small" danger>删除</Button>
                  </Popconfirm>
                </Space>
              )
            }
          ]}
        />
      </Card>}

      <Modal
        title={editingRobotId ? '回复设置' : '添加机器人'}
        open={robotOpen}
        onCancel={() => setRobotOpen(false)}
        onOk={submitRobot}
        destroyOnClose
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
        okText={editingRobotId ? '保存回复设置' : '添加'}
        width={640}
      >
        <Form form={robotForm} layout="vertical">
          <Form.Item
            name="robot_id"
            hidden={!!editingRobotId}
            label={helpLabel(
              'Robot ID',
              <Space direction="vertical" size={4}>
                <div>复制 WorkTool 显示的 Robot ID，粘贴到这里。</div>
                <div>添加多台机器人时，每行填写一个编号，也可以用逗号分隔。</div>
                <div>已有表格？可以通过下方的「导入 CSV」批量添加。</div>
              </Space>
            )}
            rules={[{ required: true, message: '请输入 Robot ID' }]}
          >
            <Input.TextArea
              disabled={!!editingRobotId}
              autoSize={{ minRows: 1, maxRows: 5 }}
              placeholder={editingRobotId ? 'Robot ID' : '支持输入多个，使用换行或逗号分隔'}
              onChange={() => { if (csvRows.length) setCsvRows([]); }}
            />
          </Form.Item>
          {!editingRobotId ? (
            <Space wrap style={{ marginTop: -12, marginBottom: 16 }}>
              <Upload accept=".csv,text/csv" showUploadList={false} beforeUpload={(file) => readRobotCsv(file as File)}>
                <Button icon={<UploadOutlined />}>导入 CSV</Button>
              </Upload>
              <Button icon={<DownloadOutlined />} onClick={downloadRobotCsvTemplate}>下载模板</Button>
              {csvRows.length ? <Tag color="blue">已读取 {csvRows.length} 个机器人，名称将按 CSV 导入</Tag> : null}
            </Space>
          ) : null}
          {!editingRobotId && <Form.Item name="name" label="名称（选填）">
            <Input disabled={csvRows.length > 0} placeholder={csvRows.length ? '机器人名称将使用 CSV 中的内容' : '给机器人起一个方便辨认的名称'} />
          </Form.Item>}
          {!editingRobotId && <Typography.Paragraph type="secondary">添加后，在消息接入中选择由平台自动回复，或交给自己的系统处理。</Typography.Paragraph>}
          {editingRobotId && <>
            <Typography.Paragraph type="secondary">调整默认回复、同事名单等个性化设置。自动回复开关和群聊回复方式，可直接在回复规则旁调整。</Typography.Paragraph>
              <Form.Item name="name" label="机器人名称"><Input /></Form.Item>
              <Form.Item noStyle shouldUpdate={(prev, next) => prev.group_reply_mode !== next.group_reply_mode}>
                {({ getFieldValue }) => getFieldValue('group_reply_mode') === 'ai_decide' && <>
                  <Form.Item name="group_decision_provider_id" label="判定是否需要回复的 AI 引擎" extra="留空使用平台官方引擎。只用于判断是否回复，回复内容使用规则中选择的引擎。">
                    <Select options={providers.filter((p) => p.enabled && p.provider_type !== 'simulated').map((p) => ({ label: p.name, value: p.id }))} allowClear placeholder="使用平台官方引擎" showSearch optionFilterProp="label" />
                  </Form.Item>
                  <Form.Item name="group_decision_prompt_template" label="AI 判定提示词" extra="已有自定义提示词会保留。支持变量：{group_name}、{sender_name}、{last_message}、{recent_context}。">
                    <Input.TextArea rows={5} placeholder={DEFAULT_GROUP_DECISION_PROMPT_TEMPLATE} />
                  </Form.Item>
                  <Button size="small" style={{ marginBottom: 16 }} onClick={() => Modal.confirm({ title: '恢复默认判定提示词？', content: '当前提示词会被替换，保存回复设置后生效。', onOk: () => robotForm.setFieldsValue({ group_decision_prompt_template: DEFAULT_GROUP_DECISION_PROMPT_TEMPLATE }) })}>恢复默认提示词</Button>
                </>}
              </Form.Item>
              <Typography.Paragraph type="secondary">没有符合的回复规则时，可以发送以下固定内容；留空则不回复。</Typography.Paragraph>
              <Form.Item name="group_default_reply" label="群聊未匹配规则时的回复"><Input.TextArea rows={2} /></Form.Item>
              <Form.Item name="private_default_reply" label="私聊未匹配规则时的回复"><Input.TextArea rows={2} /></Form.Item>
              <Form.Item name="group_colleagues_text" label="不主动回复的同事" extra="每行一个昵称或备注名。同事没有 @ 机器人时不回复；@ 时仍按规则回复。"><Input.TextArea rows={3} placeholder={'例如：张三\n李四'} /></Form.Item>
          </>}
        </Form>
      </Modal>

      <Modal
        title="确认 CSV 导入内容"
        open={csvPreviewOpen}
        width={760}
        okText="使用此文件"
        cancelText="取消"
        okButtonProps={{ disabled: csvPreviewRows.some((row) => Boolean(row.error)) }}
        onCancel={() => setCsvPreviewOpen(false)}
        onOk={() => {
          const validRows = csvPreviewRows.filter((row) => !row.error);
          setCsvRows(validRows);
          robotForm.setFieldsValue({ robot_id: validRows.map((row) => row.robotId).join('\n') });
          setCsvPreviewOpen(false);
        }}
      >
        <Alert
          type={csvPreviewRows.some((row) => Boolean(row.error)) ? 'warning' : 'success'}
          showIcon
          message={csvPreviewRows.some((row) => Boolean(row.error)) ? '请修正 CSV 后重新选择文件' : `已识别 ${csvPreviewRows.length} 个机器人`}
          style={{ marginBottom: 12 }}
        />
        <Table
          rowKey={(row) => String(row.rowNumber)}
          size="small"
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          dataSource={csvPreviewRows}
          columns={[
            { title: '行号', dataIndex: 'rowNumber', width: 70 },
            { title: '机器人 ID', dataIndex: 'robotId', ellipsis: true },
            { title: '机器人名称', dataIndex: 'name', ellipsis: true },
            { title: '校验', dataIndex: 'error', width: 170, render: (value: string) => value ? <Tag color="red">{value}</Tag> : <Tag color="green">可导入</Tag> },
          ]}
        />
      </Modal>

      <Modal
        title={editingRule ? '编辑回复规则' : '新增回复规则'}
        okText={editingRule ? '保存修改' : '添加规则'}
        cancelText="取消"
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
        open={ruleOpen}
        onCancel={() => setRuleOpen(false)}
        onOk={submitRule}
        destroyOnClose
        width={680}
      >
        <Form form={ruleForm} layout="vertical">
          <Typography.Paragraph type="secondary">{items.find((r) => r.robot_id === (editingRule?.robot_id || selectedRobotId))?.name || selectedRobotId} · {(editingRule?.scene || ruleScene) === 'group' ? '群聊回复' : '私聊回复'}</Typography.Paragraph>
          <Form.Item name="robot_id" hidden><Input /></Form.Item>
          <Form.Item name="scene" hidden><Input /></Form.Item>
          <Typography.Paragraph>选好适用的群或联系人、需要回复的消息，再选择回复引擎。两项条件都符合时，这条规则才会使用。</Typography.Paragraph>
          <Form.Item name="pattern_match_type" label={helpLabel(
            activeRuleScene === 'group' ? '在哪些群里回复？' : '回复哪些人的私聊？',
            <Space direction="vertical" size={6}>
              <span>{activeRuleScene === 'group' ? '所有群聊：不限制群名。' : '所有联系人：不限制发消息的人。'}</span>
              <span>完全相同：填写「{ruleTargetExample}」，只有{ruleTargetName}一字不差时才使用。</span>
              <span>包含关键词：填写「{activeRuleScene === 'group' ? '财务' : '张'}」，{ruleTargetName}中包含这几个字即可。</span>
            </Space>
          )} rules={[{ required: true, message: '请选择这条规则的适用范围' }]}>
            <Select options={[
              { label: activeRuleScene === 'group' ? '所有群聊' : '所有联系人', value: 'all' },
              { label: `${ruleTargetName}完全相同`, value: 'exact' },
              { label: `${ruleTargetName}包含关键词`, value: 'regex' }
            ]} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.pattern_match_type !== next.pattern_match_type}>
            {({ getFieldValue }) => {
              const mode = getFieldValue('pattern_match_type');
              if (mode === 'all') return null;
              return <Form.Item name="pattern" label={mode === 'exact' ? `填写完整${ruleTargetName}` : `${ruleTargetName}中包含的关键词`}
                rules={[{ required: true, whitespace: true, message: mode === 'exact' ? `请填写完整${ruleTargetName}` : '请填写关键词' }]}
                extra={mode === 'exact' ? `例如填写「${ruleTargetExample}」，只对这个${activeRuleScene === 'group' ? '群' : '联系人'}使用。` : `例如填写「${activeRuleScene === 'group' ? '财务' : '张'}」，可用于${activeRuleScene === 'group' ? '「财务群」「上海财务部」' : '「张三」「小张」'}。`}>
                <Input placeholder={mode === 'exact' ? `例如：${ruleTargetExample}` : `例如：${activeRuleScene === 'group' ? '财务' : '张'}`} />
              </Form.Item>;
            }}
          </Form.Item>
          <Form.Item name="content_match_type" label={helpLabel('什么消息需要回复？',
            <Space direction="vertical" size={6}>
              <span>所有消息：不限制消息内容。</span>
              <span>完全相同：填写「报销流程」，只回复这四个字的消息。</span>
              <span>包含关键词：填写「报销」，「怎么报销」「报销流程」都会使用这条规则。</span>
            </Space>
          )} rules={[{ required: true, message: '请选择需要回复的消息' }]}>
            <Select options={[
              { label: '所有消息', value: 'all' },
              { label: '消息完全相同', value: 'exact' },
              { label: '消息包含关键词', value: 'regex' }
            ]} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.content_match_type !== next.content_match_type}>
            {({ getFieldValue }) => {
              const mode = getFieldValue('content_match_type');
              if (mode === 'all') return null;
              return <Form.Item name="content_pattern" label={mode === 'exact' ? '填写完整消息' : '消息中包含的关键词'}
                rules={[{ required: true, whitespace: true, message: mode === 'exact' ? '请填写完整消息' : '请填写消息关键词' }]}
                extra={mode === 'exact' ? '例如填写「报销流程」，「请问报销流程是什么」不会使用这条规则。' : '例如填写「报销」，「怎么报销」「报销流程」都可以使用这条规则。'}>
                <Input placeholder={mode === 'exact' ? '例如：报销流程' : '例如：报销'} />
              </Form.Item>;
            }}
          </Form.Item>
          <Form.Item name="provider_id" label="用哪个 AI 回复？"
            extra={<Space wrap><Typography.Text type="secondary">使用所选引擎生成回复。</Typography.Text><Button type="link" size="small" onClick={() => window.open('/providers', '_blank', 'noopener,noreferrer')}>管理回复引擎</Button><Button type="link" size="small" icon={<ReloadOutlined />} loading={providerRefreshing} onClick={() => void refreshProviders()}>刷新列表</Button></Space>}
            rules={[{ required: true, message: '请选择用于回复的 AI 引擎' }]}>
            <Select options={providers.filter((p) => p.enabled || p.id === editingRule?.provider_id).slice().sort((a, b) => Number(a.provider_type === 'simulated') - Number(b.provider_type === 'simulated')).map((p) => ({ label: p.provider_type === 'simulated' ? '模拟AI响应（仅临时测试）' : p.name || '未命名引擎', value: p.id }))} placeholder="选择回复引擎" notFoundContent="暂无可用引擎，请先到「管理回复引擎」中添加" />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.provider_id !== next.provider_id}>
            {({ getFieldValue }) => providers.some((p) => p.id === getFieldValue('provider_id') && p.provider_type === 'simulated') &&
              <Alert type="warning" showIcon message="仅用于临时测试流程" description="不会调用 AI，每次固定回复「收到，来自模拟AI响应」。正式使用前，请换成真实回复引擎。" style={{ marginBottom: 16 }} />}
          </Form.Item>
          <Collapse ghost items={[{ key: 'advanced-rule', label: '高级设置', forceRender: true, children: <>
            <Form.Item name="priority" label="优先级" extra="通常无需修改。同样具体的规则同时符合时，数字越小越优先。" rules={[{ required: true }]}><InputNumber min={1} max={9999} style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="enabled" valuePropName="checked" label="启用这条规则" extra="关闭后保留规则内容，暂时不用于自动回复。"><Switch /></Form.Item>
            <Typography.Paragraph type="secondary">正则表达式用法：在关键词中填写以 ^ 开头或 $ 结尾的表达式，例如 ^(财务|报销).*群$。已有表达式会保留。</Typography.Paragraph>
          </> }]} />
        </Form>
      </Modal>
    </Space>
  );
}
