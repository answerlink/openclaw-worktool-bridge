import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Image, Input, Modal, Popover, Row, Select, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import { QuestionCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import EventCallbackPanel from '../components/EventCallbackPanel';
import { api } from '../api';
import { useNavigate } from 'react-router-dom';
import type { Robot } from '../types';
import { mergeOnlineStatusCallbacks, callbackAddressLabel, getCallbackReplacements, isPlatformCallback, isWecomWebhook, resolvePlatformCallback } from '../robotCallbackConfig';
import type { CallbackDisplayItem, ConfigMode } from '../robotCallbackConfig';
import { getLastSelectedRobotId, setLastSelectedRobotId } from '../robotSelection';

interface CallbackItem {
  type: number;
  typeName: string;
  callBackUrl: string;
  enabled?: boolean;
}

type CallbackTabKey = 'message' | 'command' | 'group_qr' | 'online_status' | 'event';

const tabToType: Record<CallbackTabKey, number | null> = {
  message: 11,
  command: 1,
  group_qr: 0,
  event: 7,
  online_status: 5
};

const groupQrCallbackExample = `{
  "messageId": "1942501372444566650",
  "type": 207,
  "qrCode": "https://c.weixin.com/g/rlaIbU-GvukjXx",
  "groupName": "华东客户服务交流群"
}`;

function fmtTime(ms?: number) {
  if (!ms) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

function fmtDateTimeText(val?: string) {
  if (!val) return '';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return val;
  return d.toLocaleString();
}

function parseLooseDateTime(val?: string) {
  if (!val) return 0;
  const d1 = new Date(val);
  if (!Number.isNaN(d1.getTime())) return d1.getTime();
  const d2 = new Date(val.replace(' ', 'T'));
  if (!Number.isNaN(d2.getTime())) return d2.getTime();
  return 0;
}

function isNotExpired(val?: string) {
  if (!val) return false
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() > Date.now();
}

function isSameDay(ts: number, nowTs: number) {
  const d1 = new Date(ts);
  const d2 = new Date(nowTs);
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

export default function RobotInfoPage() {
  const navigate = useNavigate();
  const [robots, setRobots] = useState<Robot[]>([]);
  const [robotsLoaded, setRobotsLoaded] = useState(false);
  const [selectedRobotId, setSelectedRobotId] = useState<string | undefined>(() => getLastSelectedRobotId());
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [callbacks, setCallbacks] = useState<CallbackItem[]>([]);
  const [online, setOnline] = useState<boolean | null>(null);
  const [onlineInfos, setOnlineInfos] = useState<any[]>([]);
  const [versionLatest, setVersionLatest] = useState<any>(null);

  const [modeOverride, setModeOverride] = useState<ConfigMode | null>(null);
  const [platformUrl, setPlatformUrl] = useState('');
  const [notificationInput, setNotificationInput] = useState('');
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  const [tabKey, setTabKey] = useState<CallbackTabKey>('message');
  const [callbackInput, setCallbackInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [platformBinding, setPlatformBinding] = useState(false);
  const [deletingType, setDeletingType] = useState<number | null>(null);

  const robotOptions = useMemo(
    () => robots.map((r) => ({ label: r.name ? `${r.name} (${r.robot_id})` : r.robot_id, value: r.robot_id })),
    [robots]
  );

  const callbackMap = useMemo(() => {
    const m = new Map<number, string>();
    callbacks.forEach((x) => m.set(x.type, x.callBackUrl));
    return m;
  }, [callbacks]);

  const callbackDisplayRows = useMemo(() => mergeOnlineStatusCallbacks(callbacks), [callbacks]);

  const syncInputByTab = (nextTabKey: CallbackTabKey) => {
    if (nextTabKey === 'online_status') {
      setCallbackInput(callbackMap.get(5) || callbackMap.get(6) || '');
      return;
    }
    const tp = tabToType[nextTabKey];
    setCallbackInput(tp === null ? '' : callbackMap.get(tp) || '');
  };

  const selectRobot = (robotId?: string) => {
    setModeOverride(null);
    setTabKey('message');
    setSelectedRobotId(robotId);
    setLastSelectedRobotId(robotId);
  };

  const loadBaseRobots = async () => {
    const items = await api.listRobots();
    setRobots(items);
    setRobotsLoaded(true);
  };

  const loadInfo = async (robotId?: string) => {
    if (!robotId) return;
    setLoading(true);
    try {
      const [detailRes, callbackRes, onlineRes, onlineInfosRes, versionRes, settings] = await Promise.all([
        api.getRobotInfoDetail(robotId),
        api.getRobotInfoCallbacks(robotId),
        api.getRobotInfoOnline(robotId),
        api.getRobotInfoOnlineInfos(robotId),
        api.getRobotInfoVersion(robotId),
        api.getWorktoolSettings()
      ]);
      setPlatformUrl(resolvePlatformCallback(String(settings?.callback_example_url || ''), window.location.origin, robotId));
      const detailData = detailRes?.data || null;
      const callbackData = callbackRes?.data || [];
      const onlineInfosData = [...(onlineInfosRes?.data || [])]
        .sort((a: any, b: any) => parseLooseDateTime(b?.onlineTime) - parseLooseDateTime(a?.onlineTime))
        .slice(0, 20);
      setDetail(detailData);
      setCallbacks(callbackData);
      setOnline(onlineRes?.data === true);
      setOnlineInfos(onlineInfosData);
      const latestVersion = versionRes?.data?.latest || null;
      setVersionLatest(latestVersion && typeof latestVersion === "object" ? latestVersion : null);
      const m = new Map<number, string>();
      callbackData.forEach((x: CallbackItem) => m.set(x.type, x.callBackUrl));
      setNotificationInput(m.get(5) || m.get(6) || '');
      if (tabKey === 'online_status') {
        setCallbackInput(m.get(5) || m.get(6) || '');
      } else {
        const tp = tabToType[tabKey];
        setCallbackInput(tp === null ? '' : m.get(tp) || '');
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '拉取机器人信息失败');
      setDetail(null);
      setCallbacks([]);
      setOnline(null);
      setOnlineInfos([]);
      setVersionLatest(null);
      setCallbackInput('');
      setNotificationInput('');
      setPlatformUrl('');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBaseRobots();
  }, []);

  useEffect(() => {
    if (!robotsLoaded) return;
    if (robots.length === 0) {
      selectRobot(undefined);
      return;
    }
    const current = selectedRobotId;
    const exists = current && robots.some((x: Robot) => x.robot_id === current);
    if (!exists) {
      selectRobot(robots[0].robot_id);
    }
  }, [robotsLoaded, robots, selectedRobotId]);

  useEffect(() => {
    void loadInfo(selectedRobotId);
  }, [selectedRobotId]);

  const onlineText = online === true ? '在线' : '不在线';
  const onlineTagColor = online === true ? 'blue' : 'red';
  const rawFirstLogin = String(detail?.firstLogin || '').trim();
  const rawAuthExpire = String(detail?.authExpir || detail?.authExpire || '').trim();
  const isRobotTypeInvalid = detail?.robotType === 4;
  const isNotActivated = !rawFirstLogin;
  const isValid = !isRobotTypeInvalid && !isNotActivated && isNotExpired(rawAuthExpire);
  const hasValidityInfo = Boolean(rawFirstLogin || rawAuthExpire || detail?.signatureTime || isRobotTypeInvalid);
  const validText = !hasValidityInfo ? '未知' : isRobotTypeInvalid ? '无效' : (isNotActivated ? '未激活' : (isValid ? '有效' : '无效'));
  const validTagColor = !hasValidityInfo ? 'default' : isValid ? 'blue' : (isNotActivated ? 'default' : 'red');
  const firstLoginText = fmtDateTimeText(detail?.firstLogin) || fmtTime(detail?.signatureTime) || '-';
  const authExpirText = fmtDateTimeText(detail?.authExpir || detail?.authExpire) || '-';
  const latestOnlineInfo = [...onlineInfos].sort(
    (a, b) => parseLooseDateTime(b?.onlineTime) - parseLooseDateTime(a?.onlineTime)
  )[0];
  const lastLoginIp = latestOnlineInfo?.ip || detail?.ip || detail?.lastLoginIp || '-';
  const versionSuffix = versionLatest
    ? ` (${versionLatest?.appName || '-'}: ${versionLatest?.appVersion || '-'} APP版本: ${versionLatest?.workVersion || '-'})`
    : '';
  const loginFlapStats = useMemo(() => {
    const now = Date.now();
    const dayStartCount = onlineInfos.filter((row: any) => isSameDay(parseLooseDateTime(row?.onlineTime), now)).length;
    const recent24hCount = onlineInfos.filter((row: any) => {
      const t = parseLooseDateTime(row?.onlineTime);
      return t > 0 && now - t <= 24 * 60 * 60 * 1000;
    }).length;
    const shouldWarn = dayStartCount > 10 || recent24hCount > 10;
    return { dayStartCount, recent24hCount, shouldWarn };
  }, [onlineInfos]);

  const ensureCallbackInput = () => {
    if (!selectedRobotId) {
      message.warning('请先选择机器人');
      return false;
    }
    if (!callbackInput.trim()) {
      message.warning('请输入回调地址');
      return false;
    }
    return true;
  };

  const onTestCallback = async () => {
    if (!ensureCallbackInput()) return;
    setTesting(true);
    try {
      if (tabKey === 'message') {
        await api.testRobotMessageCallback(selectedRobotId as string, callbackInput.trim());
        message.success('测试通过：目标地址已返回 HTTP 200');
      } else {
        const result = await api.testRobotCallback2xx(callbackInput.trim());
        message.success(result.request_sent ? '测试通过：已发送空请求并收到 HTTP 200' : '地址格式校验通过，未发送请求');
      }
    } catch (e: any) {
      Modal.error({
        title: '测试失败',
        content: e?.response?.data?.detail || e?.message || '未知错误',
      });
    } finally {
      setTesting(false);
    }
  };

  const confirmCallbackOverwrite = async (robotId: string, url: string, types: number[], targetPlatformUrl = platformUrl) => {
    // Re-read saved settings so changes made elsewhere are also protected.
    const latest = await api.getRobotInfoCallbacks(robotId);
    const replacements = getCallbackReplacements(latest?.data || [], types, url);
    if (replacements.length === 0) return true;
    return new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: '确认覆盖已有配置？',
        width: 640,
        content: (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Typography.Text>以下配置已有地址。继续保存后，这些事件将发送到新地址，原地址将被替换。</Typography.Text>
            {replacements.map((item) => (
              <div key={item.type} style={{ width: '100%' }}>
                <Typography.Text strong>{item.typeName}</Typography.Text>
                <div style={{ wordBreak: 'break-all' }}>原设置：{callbackAddressLabel(item.type, item.callBackUrl, platformUrl)}</div>
                <div style={{ wordBreak: 'break-all' }}>新设置：{callbackAddressLabel(item.type, url, targetPlatformUrl)}</div>
              </div>
            ))}
            <Typography.Text type="secondary">只修改以上配置，其他回调保持原样。取消后不会保存任何修改。</Typography.Text>
          </Space>
        ),
        okText: '确认覆盖',
        okButtonProps: { danger: true },
        cancelText: '取消，保留原配置',
        autoFocusButton: 'cancel',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  };

  const doSaveCallback = async (url: string) => {
    const robotId = selectedRobotId as string;
    if (tabKey === 'message') {
      await api.bindRobotMessageCallback(robotId, url);
      return;
    }
    if (tabKey === 'online_status') {
      await api.bindRobotCallbackType(robotId, url, 5);
      await api.bindRobotCallbackType(robotId, url, 6);
      return;
    }
    const callbackType = tabToType[tabKey];
    if (callbackType === null) {
      throw new Error('不支持的回调类型');
    }
    await api.bindRobotCallbackType(robotId, url, callbackType);
  };

  const onSaveCallback = async () => {
    if (!ensureCallbackInput()) return;
    const url = callbackInput.trim();
    setSaving(true);
    try {
      const types = tabKey === 'online_status' ? [5, 6] : [tabToType[tabKey] as number];
      if (!await confirmCallbackOverwrite(selectedRobotId as string, url, types)) return;
      await doSaveCallback(url);
      message.success('绑定成功，机器人将按该地址推送回调。');
      await loadInfo(selectedRobotId);
    } catch (e: any) {
      Modal.error({
        title: '绑定失败',
        content: e?.response?.data?.detail || e?.message || '未知错误',
      });
    } finally {
      setSaving(false);
    }
  };

  const onBindPlatformCallback = async () => {
    if (!selectedRobotId) {
      message.warning('请先选择机器人');
      return;
    }
    setPlatformBinding(true);
    try {
      const settings = await api.getWorktoolSettings();
      const template = String(settings?.callback_example_url || '').trim();
      const resolved = resolvePlatformCallback(template, window.location.origin, selectedRobotId);
      if (!resolved || !/^https?:\/\//.test(resolved)) {
        throw new Error('未拿到有效的平台回调地址');
      }
      if (!await confirmCallbackOverwrite(selectedRobotId, resolved, [11], resolved)) return;
      setCallbackInput(resolved);
      await api.bindRobotMessageCallback(selectedRobotId, resolved);
      message.success('已接入平台，收到的消息将交给本平台处理。');
      await loadInfo(selectedRobotId);
    } catch (e: any) {
      Modal.error({
        title: '自动设置失败',
        content: e?.response?.data?.detail || e?.message || '未知错误',
      });
    } finally {
      setPlatformBinding(false);
    }
  };

  const platformBound = isPlatformCallback(callbackMap.get(11) || '', platformUrl);
  const platformConnected = platformBound && detail?.openCallback === 1;
  const configMode = modeOverride || (callbackMap.get(11) && !platformBound ? 'custom' : 'beginner');
  const busy = loading || saving || platformBinding || notificationSaving || deletingType !== null;
  const notificationConfigured = isWecomWebhook(callbackMap.get(5) || '') && isWecomWebhook(callbackMap.get(6) || '');
  const customNotifications = [5, 6].some((type) => Boolean(callbackMap.get(type)) && !isWecomWebhook(callbackMap.get(type) || ''));
  const splitNotifications = Boolean(callbackMap.get(5) || callbackMap.get(6))
    && callbackMap.get(5) !== callbackMap.get(6);

  const onSaveNotification = async () => {
    if (!selectedRobotId) {
      message.warning('请先选择机器人');
      return;
    }
    if (!isWecomWebhook(notificationInput)) {
      message.warning('请粘贴企业微信「消息推送」中复制的完整 Webhook 地址，需包含 key。');
      return;
    }
    setNotificationSaving(true);
    try {
      const url = notificationInput.trim();
      if (!await confirmCallbackOverwrite(selectedRobotId, url, [5, 6])) return;
      await api.bindRobotCallbackType(selectedRobotId, url, 5);
      await api.bindRobotCallbackType(selectedRobotId, url, 6);
      message.success('已保存上线和掉线通知，设备状态变化时将通知到企微群。');
      await loadInfo(selectedRobotId);
    } catch (e: any) {
      Modal.error({ title: '通知设置未完成', content: e?.response?.data?.detail || e?.message || '请重试保存，以确保上线和掉线通知都已配置。' });
      await loadInfo(selectedRobotId);
    } finally {
      setNotificationSaving(false);
    }
  };

  const callbackDoc = (() => {
    if (tabKey === 'message') {
      return { label: '消息回调说明', url: 'https://worktool.apifox.cn/doc-861677' };
    }
    if (tabKey === 'command') {
      return { label: '指令回调说明', url: 'https://worktool.apifox.cn/api-44952776' };
    }
    if (tabKey === 'group_qr') {
      return { label: '群二维码回调说明', url: '' };
    }
    return { label: '上下线回调说明', url: '' };
  })();

  const onOpenCallbackDoc = () => {
    if (tabKey === 'group_qr') {
      Modal.info({
        title: '群二维码回调说明',
        width: 720,
        content: (
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Typography.Text>创建群和修改群配置指令执行时会触发回调，二维码始终为最新二维码，有效期为 7 天。</Typography.Text>
            <Typography.Text>也可在 App 的“设置 - 高级设置”中打开“获取群二维码”。</Typography.Text>
            <Typography.Text>平台会向回调地址发送 POST 请求，Content-Type 为 application/json。</Typography.Text>
            <pre style={{ margin: 0, padding: 12, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#f5f5f5', borderRadius: 6 }}>
              {groupQrCallbackExample}
            </pre>
          </Space>
        ),
      });
      return;
    }
    if (tabKey === 'online_status') {
      setGuideOpen(true);
      return;
    }
    window.open(callbackDoc.url, '_blank', 'noopener,noreferrer');
  };

  const onDeleteCallback = (row: CallbackDisplayItem) => {
    if (!selectedRobotId) {
      message.warning('请先选择机器人');
      return;
    }
    Modal.confirm({
      title: '确认删除回调',
      content: `将删除【${row.typeName}】配置，是否继续？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setDeletingType(row.type);
        try {
          const results = await Promise.allSettled(row.callbackTypes.map((type) => api.deleteRobotCallbackByType(selectedRobotId, type)));
          const failure = results.find((result) => result.status === 'rejected');
          if (failure?.status === 'rejected') throw failure.reason;
          message.success('删除成功');
        } catch (e: any) {
          Modal.error({
            title: '删除失败',
            content: e?.response?.data?.detail || e?.message || '未知错误',
          });
        } finally {
          await loadInfo(selectedRobotId);
          setDeletingType(null);
        }
      },
    });
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title="机器人基本信息"
        loading={loading}
        extra={(
          <Select
            style={{ width: 340, maxWidth: '100%' }}
            disabled={busy}
            value={selectedRobotId}
            onChange={selectRobot}
            options={robotOptions}
            placeholder="更换机器人"
            showSearch
            optionFilterProp="label"
          />
        )}
      >
        <table className="robot-info-matrix">
          <tbody>
            <tr>
              <th>机器人编号</th>
              <td>{detail?.robotId || '-'}</td>
              <th>是否在线</th>
              <td><Tag color={onlineTagColor}>{onlineText}</Tag></td>
              <th>ip</th>
              <td>{lastLoginIp}</td>
            </tr>
            <tr>
              <th>是否有效</th>
              <td><Tag color={validTagColor}>{validText}</Tag></td>
              <th>识别账号昵称</th>
              <td>{detail?.name || '-'}</td>
              <th>企业</th>
              <td>{detail?.corporation || '-'}</td>
            </tr>
            <tr>
              <th>启用时间</th>
              <td>{firstLoginText}</td>
              <th>到期时间</th>
              <td>{authExpirText}</td>
              <th>消息接收</th>
              <td>
                {detail?.openCallback === 1 ? <Tag color="blue">开启</Tag> : <Tag>关闭</Tag>}
              </td>
            </tr>
          </tbody>
        </table>
      </Card>

      <Card className="robot-callback-config" title="机器人使用设置" extra={<Button type="text" icon={<ReloadOutlined />} disabled={busy || !selectedRobotId} onClick={() => loadInfo(selectedRobotId)}>刷新状态</Button>}>
        <div className="callback-mode-options" role="group" aria-label="配置模式">
          {([
            ['beginner', '小白模式', '无需开发，直接使用本平台接收消息和自动回复。'],
            ['custom', '自定义模式', '对接自己的系统，手动配置各类回调接口。']
          ] as const).map(([mode, title, description]) => (
            <button key={mode} type="button" className={`callback-mode-option ${configMode === mode ? 'is-selected' : ''}`}
              aria-pressed={configMode === mode} disabled={busy} onClick={() => setModeOverride(mode)}>
              <span className="callback-mode-name">{title}</span>
              <span>{description}</span>
            </button>
          ))}
        </div>
        {configMode === 'beginner' ? (
          <Space direction="vertical" size={24} style={{ width: '100%' }}>
            <section className="callback-beginner-section">
              <Typography.Title level={5}>1. 接收消息与自动回复 <Tag color={platformConnected ? 'green' : 'default'}>{platformConnected ? '已接入平台' : '待接入'}</Tag></Typography.Title>
              <Typography.Paragraph type="secondary">让本平台接收 WorkTool 机器人的消息，按你设置的回复规则处理。点击一次即可完成接入，无需填写接口地址。</Typography.Paragraph>
              {!platformConnected && callbackMap.get(11) && <Alert style={{ marginBottom: 12 }} type="warning" showIcon message="当前消息已接入其他系统" description="接入平台会替换现有消息地址，操作前会请你确认。切换模式不会修改任何配置。" />}
              <Space wrap>
                <Button type="primary" disabled={busy || !selectedRobotId || platformConnected} loading={platformBinding} onClick={onBindPlatformCallback}>{platformConnected ? '已接入平台' : '一键接入平台'}</Button>
                {platformConnected && <Button onClick={() => navigate('/robots')}>设置回复规则</Button>}
              </Space>
              <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>接入后，还需要在「机器人配置」中开启需要的私聊 / 群聊回复，并配置回复规则。</Typography.Paragraph>
            </section>
            <section className="callback-beginner-section">
              <Typography.Title level={5}>2. 上下线群通知 <Tag>可选</Tag>{notificationConfigured && !splitNotifications && <Tag color="green">已配置</Tag>}</Typography.Title>
              <Typography.Paragraph type="secondary">想及时知道安卓设备上的 WorkTool 机器人何时上线或掉线？在企业微信内部群添加一个「消息推送机器人」，把它的 Webhook 地址粘贴到这里，就能在群里收到通知。</Typography.Paragraph>
              <div className="callback-guide-summary">
                <Typography.Text strong>在哪里找到 Webhook 地址？</Typography.Text>
                <p>企业微信客户端 → 内部群 → 右上角「更多（···）」→「消息推送」→「添加」→ 复制 Webhook 地址</p>
                <Button onClick={() => setGuideOpen(true)}>查看图文操作指引</Button>
              </div>
              {(splitNotifications || customNotifications) && <Alert style={{ marginTop: 12 }} type="warning" showIcon message={customNotifications ? '当前上下线事件已接入自定义接口' : '现有上线和掉线通知未使用同一个地址'} description="保存后，两类通知将使用下方填写的地址。你也可以到自定义模式分别查看现有配置。" />}
              <label className="callback-field-label" htmlFor="notification-webhook">消息推送机器人的 Webhook 地址</label>
              <Input id="notification-webhook" value={notificationInput} onChange={(e) => setNotificationInput(e.target.value)} disabled={busy}
                placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…" />
              <div className="callback-action-row"><Button type="primary" loading={notificationSaving} disabled={busy || !selectedRobotId} onClick={onSaveNotification}>保存群通知</Button><Typography.Text type="secondary">不需要通知？这一步可以跳过。</Typography.Text></div>
            </section>
          </Space>
        ) : <>
          <Alert type="info" showIcon style={{ marginBottom: 12 }} message="将机器人事件发送到你自己的系统" description="仅配置你需要的接口。保存消息回调会改变消息接收方，切换模式不会自动修改已保存的配置。" />
        <Tabs
          activeKey={tabKey}
          onChange={(k) => {
            if (busy) return;
            const key = k as CallbackTabKey;
            setTabKey(key);
            syncInputByTab(key);
          }}
          items={[
            { key: 'message', label: '消息回调' },
            { key: 'command', label: '指令执行结果回调' },
            { key: 'group_qr', label: '群二维码回调' },
            { key: 'event', label: '事件回调' },
            { key: 'online_status', label: '上下线通知' }
          ]}
        />
        {tabKey === 'event' ? <EventCallbackPanel key={selectedRobotId + JSON.stringify(callbacks.filter((row) => row.type === 7))} robotId={selectedRobotId}
          messageUrl={callbackMap.get(11) || ''} disabled={busy} onBusyChange={setSaving}
          onSaved={() => loadInfo(selectedRobotId)} /> : tabKey === 'message' && isPlatformCallback(callbackInput, platformUrl) ? (
          <Alert type="success" showIcon message="由本平台接收消息"
            description="消息已接入本平台。如果需要对接自己的系统，可以填写自定义地址，保存前会确认是否替换现有配置。"
            action={<Button disabled={busy} onClick={() => setCallbackInput('')}>填写自定义地址</Button>} />
        ) : <>
        <div className="callback-form-row">
          <label htmlFor="custom-callback-url">
            <Space size={6}>
              <span><span className="required">*</span> 回调地址</span>
              <Popover content="填写你自己的接收服务地址。不需要开发对接时，可选择小白模式。" trigger="hover" placement="right">
                <QuestionCircleOutlined style={{ color: '#8c8c8c' }} />
              </Popover>
            </Space>
          </label>
          <Input
            id="custom-callback-url"
            disabled={busy}
            value={callbackInput}
            onChange={(e) => setCallbackInput(e.target.value)}
            placeholder="请输入回调地址"
          />
        </div>
        <div className="callback-action-row">
          <Button type="primary" loading={saving} disabled={busy || !selectedRobotId} onClick={onSaveCallback}>保存设置</Button>
          <Button type="link" loading={testing} disabled={busy || !selectedRobotId} onClick={onTestCallback}>测试回调地址</Button>
          <Button type="link" onClick={onOpenCallbackDoc}>
            {callbackDoc.label}
          </Button>
        </div>
        </>}
        </>}
      </Card>
      <Modal title="在企业微信中开启上下线群通知" open={guideOpen} onCancel={() => setGuideOpen(false)} footer={<Button type="primary" onClick={() => setGuideOpen(false)}>知道了，去填写地址</Button>} width={760} styles={{ body: { maxHeight: '65vh', overflowY: 'auto' } }}>
        <Typography.Paragraph>需要准备一个企业微信内部群，通知会发送到你选择的这个群里。</Typography.Paragraph>
        <ol className="callback-guide-steps">
          <li><Typography.Text strong>打开内部群，点击右上角「更多（···）」，找到「消息推送」。</Typography.Text><Image width={240} src="/images/callback-guide/group-menu.png" alt="内部群的聊天信息中，消息推送入口位置" /></li>
          <li><Typography.Text strong>点击「添加」，新建一个消息推送机器人。</Typography.Text><p>名称可以填「WorkTool 上下线通知」，方便在群里辨认。</p><Image width={240} src="/images/callback-guide/add-push.png" alt="消息推送页面底部的添加按钮" /></li>
          <li><Typography.Text strong>复制「Webhook 地址」，完成企微里的保存。</Typography.Text><Image width={240} src="/images/callback-guide/copy-webhook.png" alt="自定义消息推送配置中的 Webhook 地址和复制按钮" /></li>
          <li><Typography.Text strong>回到这里粘贴地址，点击「保存群通知」。</Typography.Text><p>WorkTool 机器人上线或掉线时，就会向该群发送通知。</p></li>
        </ol>
      </Modal>

      <Row gutter={[16, 16]}>
        {configMode === 'custom' && <Col xs={24} lg={12}>
          <Card
            title="机器人回调配置信息"
            loading={loading}
            extra={<Typography.Link onClick={() => loadInfo(selectedRobotId)}><ReloadOutlined /> 刷新</Typography.Link>}
          >
            <Table<CallbackDisplayItem>
              rowKey={(r) => `${r.type}-${r.callBackUrl}`}
              dataSource={callbackDisplayRows}
              pagination={false}
              tableLayout="fixed"
              columns={[
                {
                  title: '回调类型',
                  dataIndex: 'typeName',
                  width: 160,
                  render: (v: string, row: CallbackDisplayItem) => <Space direction="vertical" size={4}>
                    <span>{row.type === 7 ? '事件回调' : v}</span>
                    {row.type === 7 && <Tag color={row.enabled === false ? 'default' : 'green'}>{row.enabled === false ? '已关闭' : '已开启'}</Tag>}
                  </Space>
                },
                {
                  title: '接收方 / 地址',
                  dataIndex: 'callBackUrl',
                  render: (v: string, row: CallbackDisplayItem) => <span style={{ wordBreak: 'break-all' }}>{callbackAddressLabel(row.type, v, platformUrl)}</span>
                },
                {
                  title: '操作',
                  width: 100,
                  align: 'center',
                  render: (_: any, row: CallbackDisplayItem) => (
                    row.type === 7 ? <Button size="small" disabled={busy} onClick={() => {
                      setTabKey('event');
                    }}>设置</Button> : <Button
                      danger
                      size="small"
                      loading={deletingType === row.type}
                      disabled={busy}
                      onClick={() => onDeleteCallback(row)}
                    >
                      删除
                    </Button>
                  )
                }
              ]}
              locale={{ emptyText: '暂无回调配置' }}
            />
          </Card>
        </Col>}
        <Col xs={24} lg={configMode === 'custom' ? 12 : 24}>
          <Card title={`机器人登录日志${versionSuffix}`}>
            {loginFlapStats.shouldWarn ? (
              <Alert
                style={{ marginBottom: 12 }}
                type="warning"
                showIcon
                message={`登录上下线波动偏高：24小时 ${loginFlapStats.recent24hCount} 次，今日 ${loginFlapStats.dayStartCount} 次`}
                description="检测到登录日志频繁波动，可能是客户端设备网络状况不佳，建议优先检查设备网络稳定性。"
              />
            ) : null}
            <Table
              rowKey={(r: any, idx) => `${r.robotId || 'r'}-${r.onlineTime || ''}-${idx}`}
              dataSource={onlineInfos}
              pagination={false}
              columns={[
                { title: '登录ip', dataIndex: 'ip' },
                { title: '上线时间', dataIndex: 'onlineTime' },
                {
                  title: '下线时间',
                  render: (_: any, row: any) => row.offline || row.offlineTime || '-'
                },
                { title: '在线总时长(分钟)', dataIndex: 'onlineTimes' }
              ]}
              locale={{ emptyText: '暂无数据' }}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
