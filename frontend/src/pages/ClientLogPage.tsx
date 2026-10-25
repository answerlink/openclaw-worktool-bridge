import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, DatePicker, Radio, AutoComplete, Button, Card, Descriptions, Input, Space, Spin, Tooltip, Typography, message } from 'antd';
import { CopyOutlined, DownOutlined, SearchOutlined, UpOutlined, CloseOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import zhCN from 'antd/es/date-picker/locale/zh_CN';
import { api } from '../api';
import RobotStatusCard from '../components/RobotStatusCard';

const RECENT_MESSAGE_IDS_KEY = 'client_log_recent_message_ids';
const MAX_RECENT_MESSAGE_IDS = 10;
const TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';

type QueryResult = {
  status: 'success' | 'timeout' | 'failed';
  request_message_id?: string;
  start_time?: string;
  end_time?: string;
  message_id: string;
  robot_id: string;
  attempts: number;
  elapsed_seconds: number;
  data?: unknown;
};

function formatClientLog(data: unknown) {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const messageText = (data as Record<string, unknown>).message;
    if (typeof messageText === 'string') return messageText;
  }
  if (typeof data === 'string') return data;
  return JSON.stringify(data ?? {}, null, 2);
}

export default function ClientLogPage() {
  const [messageId, setMessageId] = useState(() => {
    try {
      const ids = JSON.parse(localStorage.getItem(RECENT_MESSAGE_IDS_KEY) || '[]');
      return Array.isArray(ids) && typeof ids[0] === 'string' ? ids[0] : '';
    } catch { return ''; }
  });
  const [recentMessageIds, setRecentMessageIds] = useState<string[]>(() => {
    try {
      const ids = JSON.parse(localStorage.getItem(RECENT_MESSAGE_IDS_KEY) || '[]');
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string').slice(0, MAX_RECENT_MESSAGE_IDS) : [];
    } catch { return []; }
  });
  const [mode, setMode] = useState<'message' | 'time'>('message');
  const [robotId, setRobotId] = useState('');
  const [startTime, setStartTime] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const endTime = startTime ? dayjs(startTime).add(durationMinutes, 'minute').format(TIME_FORMAT) : '';
  const [timeRequest, setTimeRequest] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [robotStatus, setRobotStatus] = useState<Record<string, unknown> | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');
  const queryVersion = useRef(0);
  const queryInFlight = useRef(false);

  useEffect(() => () => { queryVersion.current += 1; }, []);

  const loadRobotStatus = async (robotId: string, version: number) => {
    setStatusLoading(true);
    try {
      const status = await api.getClientLogRobotStatus(robotId);
      if (queryVersion.current === version) setRobotStatus(status);
    } catch (e: any) {
      if (queryVersion.current === version) {
        setStatusError(e?.response?.data?.detail || e?.message || '请稍后重新查询');
      }
    } finally {
      if (queryVersion.current === version) setStatusLoading(false);
    }
  };

  const [logText, setLogText] = useState('');
  const [logSearch, setLogSearch] = useState('');
  const [findOpen, setFindOpen] = useState(false);
  const [findIndex, setFindIndex] = useState(-1);
  const findInputRef = useRef<any>(null);
  const logTextAreaRef = useRef<any>(null);

  const matches = useMemo(() => {
    const needle = logSearch.trim().toLowerCase();
    if (!needle) return [] as number[];
    const haystack = logText.toLowerCase();
    const positions: number[] = [];
    let from = 0;
    while (from < haystack.length) {
      const index = haystack.indexOf(needle, from);
      if (index < 0) break;
      positions.push(index);
      from = index + Math.max(needle.length, 1);
    }
    return positions;
  }, [logSearch, logText]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && result) {
        event.preventDefault();
        setFindOpen(true);
        window.setTimeout(() => findInputRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [result]);

  useEffect(() => {
    setLogText(result ? formatClientLog(result.data) : '');
    setLogSearch('');
    setFindOpen(false);
    setFindIndex(-1);
  }, [result]);

  const selectMatch = (direction: 1 | -1) => {
    if (!matches.length) return;
    const next = findIndex < 0
      ? (direction > 0 ? 0 : matches.length - 1)
      : (findIndex + direction + matches.length) % matches.length;
    setFindIndex(next);
  };

  useEffect(() => {
    if (!findOpen || findIndex < 0 || !matches.length) return;
    const textarea = logTextAreaRef.current?.resizableTextArea?.textArea as HTMLTextAreaElement | undefined;
    if (!textarea) return;
    const start = matches[findIndex];
    const end = start + logSearch.trim().length;
    textarea.focus();
    textarea.setSelectionRange(start, end);
    const lineNumber = logText.slice(0, start).split('\n').length - 1;
    const lineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight) || 22;
    textarea.scrollTop = Math.max(0, lineNumber * lineHeight - textarea.clientHeight / 2);
  }, [findOpen, findIndex, matches, logSearch, logText]);

  const copyLog = async () => {
    try {
      await navigator.clipboard.writeText(logText);
      message.success('日志已复制');
    } catch {
      message.error('复制失败，请检查浏览器权限');
    }
  };

  useEffect(() => {
    try { localStorage.setItem(RECENT_MESSAGE_IDS_KEY, JSON.stringify(recentMessageIds)); } catch { /* ignore storage errors */ }
  }, [recentMessageIds]);

  const queryTime = async (resume = false) => {
    if (queryInFlight.current) return;
    if (!resume && (!robotId.trim() || !startTime || !endTime || startTime > endTime)) {
      message.warning('请填写机器人 ID 和有效的北京时间范围'); return;
    }
    queryInFlight.current = true;
    const version = ++queryVersion.current;
    setLoading(true); setResult(null); setRobotStatus(null); setStatusError('');
    if (!resume) setTimeRequest(null);
    let request = resume ? timeRequest : null;
    try {
      if (!request) request = await api.requestClientLogByTime(robotId.trim(), startTime, endTime);
      setTimeRequest(request);
      void loadRobotStatus(request.robot_id, version);
      for (let attempt = 1; attempt <= 12; attempt++) {
        await new Promise(resolve => window.setTimeout(resolve, 5000));
        if (queryVersion.current !== version) return;
        const data = await api.getClientLogTimeResult(request.robot_id, request.request_message_id);
        if (data.status !== 'pending' || attempt === 12) {
          setResult({ ...request, ...data, status: data.status === 'pending' ? 'timeout' : data.status, attempts: attempt, elapsed_seconds: attempt * 5 });
          break;
        }
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || '时间段日志查询失败');
    } finally { queryInFlight.current = false; setLoading(false); }
  };

  const query = async () => {
    if (mode === 'time') { await queryTime(); return; }
    if (queryInFlight.current) return;
    const value = messageId.trim();
    if (!value) {
      message.warning('请输入 messageId');
      return;
    }
    setRecentMessageIds((ids) => [value, ...ids.filter((id) => id !== value)].slice(0, MAX_RECENT_MESSAGE_IDS));
    queryInFlight.current = true;
    const version = ++queryVersion.current;
    setLoading(true);
    setResult(null);
    setRobotStatus(null);
    setStatusError('');
    setStatusLoading(false);
    try {
      let data = await api.requestClientLogSnippet(value);
      if (queryVersion.current === version && data?.robot_id) {
        void loadRobotStatus(String(data.robot_id), version);
      }
      if (data?.status === 'pending') {
        for (let attempt = 1; attempt <= 12; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 5000));
          data = await api.getClientLogSnippetDetail(value, String(data.robot_id || ''));
          if (data?.status === 'success') {
            data = { ...data, attempts: attempt, elapsed_seconds: attempt * 5 };
            break;
          }
          if (attempt === 12) {
            data = { ...data, status: 'timeout', attempts: attempt, elapsed_seconds: attempt * 5 };
          }
        }
      } else {
        data = { ...data, attempts: 0, elapsed_seconds: 0 };
      }
      setResult(data);
      if (data?.status === 'success') message.success('客户端日志获取成功');
      else message.warning('等待 60 秒仍未收到客户端日志');
    } catch (e: any) {
      message.error(e?.response?.data?.detail || e?.message || '客户端日志查询失败');
    } finally {
      queryInFlight.current = false;
      setLoading(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="客户端日志查询">
        <div style={{ marginBottom: 20 }}>
        <Radio.Group value={mode} disabled={loading} onChange={e => { setMode(e.target.value); setResult(null); setRobotStatus(null); }} >
          <Radio.Button value="message">按 messageId</Radio.Button><Radio.Button value="time">按时间段</Radio.Button>
        </Radio.Group>
        </div>
        {mode === 'time' ? <Space direction="vertical" size={16} style={{ width: '100%', maxWidth: 760 }}>
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <Typography.Text>机器人 ID</Typography.Text>
            <Input aria-label="机器人 ID" placeholder="请输入机器人 ID" value={robotId} disabled={loading} onChange={e => setRobotId(e.target.value)} />
          </Space>
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <Typography.Text>开始时间（北京时间）</Typography.Text>
            <DatePicker
              locale={zhCN}
              showTime={{ format: 'HH:mm:ss' }}
              format={TIME_FORMAT}
              placeholder="请选择开始日期和时间"
              disabled={loading}
              style={{ width: '100%' }}
              value={startTime ? dayjs(startTime) : null}
              onChange={value => setStartTime(value?.format(TIME_FORMAT) || '')}
            />
          </Space>
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <Typography.Text>查询时长</Typography.Text>
            <Radio.Group value={durationMinutes} disabled={loading} onChange={e => setDurationMinutes(e.target.value)}>
              <Radio.Button value={15}>15 分钟</Radio.Button>
              <Radio.Button value={30}>30 分钟</Radio.Button>
              <Radio.Button value={60}>1 小时（默认）</Radio.Button>
            </Radio.Group>
            <Typography.Text type="secondary">
              {endTime ? `结束时间：${endTime}（北京时间，包含结束秒）` : '选择开始时间后自动计算结束时间，无需手动填写。'}
            </Typography.Text>
          </Space>
          <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => void queryTime()}>查询</Button>
          {timeRequest ? <Alert type="info" message={`采集请求 ID：${timeRequest.request_message_id}`} description={<Button disabled={loading} onClick={() => void queryTime(true)}>继续查询此请求（不重复采集）</Button>} /> : null}
        </Space> : <Space.Compact style={{ width: '100%', maxWidth: 680 }}>
          <AutoComplete
            value={messageId}
            onChange={(value) => setMessageId(value)}
            onInputKeyDown={(event) => { if (event.key === 'Enter') void query(); }}
            placeholder="请输入指令 messageId"
            disabled={loading}
            options={recentMessageIds.map((id) => ({ value: id, label: `最近使用：${id}` }))}
            filterOption={(input, option) => String(option?.value || '').includes(input)}
            style={{ flex: 1 }}
          />
          <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={() => void query()}>
            查询
          </Button>
        </Space.Compact>}
        <Typography.Paragraph type="secondary" style={{ marginTop: 10, marginBottom: 0 }}>
          {mode === 'message' ? '系统根据 messageId 反查机器人，并等待客户端回传日志。' : '时间使用北京时间（UTC+8），包含结束秒；需要支持时间段采集的客户端。入队不代表采集完成。'} 每 5 秒查询一次，最多 12 次。
        </Typography.Paragraph>
      </Card>

      {statusLoading || robotStatus || statusError ? (
        <RobotStatusCard status={robotStatus} loading={statusLoading} error={statusError} />
      ) : null}

      {loading ? (
        <Card>
          <Space><Spin size="small" />正在请求客户端日志，最长等待 60 秒，请勿重复提交。</Space>
        </Card>
      ) : null}

      {result ? (
        <Card title="查询结果">
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="状态">
              {result.status === 'success' ? <Alert type="success" showIcon message="已收到客户端日志" /> : <Alert type={result.status === 'failed' ? 'error' : 'warning'} showIcon message={result.status === 'failed' ? '客户端采集失败，请查看返回详情' : '查询超时'} />}
            </Descriptions.Item>
            <Descriptions.Item label="机器人 ID">{result.robot_id}</Descriptions.Item>
            <Descriptions.Item label={result.request_message_id ? "采集请求 ID" : "Message ID"}>{result.request_message_id || result.message_id}</Descriptions.Item>
            {result.start_time ? <Descriptions.Item label="时间范围（北京时间，含结束秒）">{result.start_time} 至 {result.end_time}</Descriptions.Item> : null}
            <Descriptions.Item label="轮询次数">{result.attempts}</Descriptions.Item>
            <Descriptions.Item label="耗时（秒）">{result.elapsed_seconds}</Descriptions.Item>
          </Descriptions>
          {result.status === 'timeout' ? (
            <Alert
              style={{ marginTop: 12 }}
              type="warning"
              showIcon
              message="客户端未在 60 秒内回传日志"
              description="请确认机器人在线、客户端版本支持该功能，并检查查询条件。按时间段采集可点击“继续查询此请求”，无需重复发起。"
            />
          ) : null}
          <Typography.Title level={5} style={{ marginTop: 18, marginBottom: 10 }}>客户端日志</Typography.Title>
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Space>
                <Tooltip title="查找（Ctrl+F / ⌘F）"><Button icon={<SearchOutlined />} onClick={() => { setFindOpen(true); window.setTimeout(() => findInputRef.current?.focus(), 0); }} /></Tooltip>
                <Tooltip title="复制全文"><Button icon={<CopyOutlined />} onClick={() => void copyLog()} /></Tooltip>
                <Typography.Text type="secondary">临时编辑，不会保存</Typography.Text>
              </Space>
              {findOpen ? (
                <Space.Compact>
                  <Input
                    ref={findInputRef}
                    value={logSearch}
                    onChange={(event) => { setLogSearch(event.target.value); setFindIndex(-1); }}
                    onPressEnter={(event) => selectMatch(event.shiftKey ? -1 : 1)}
                    placeholder="查找"
                    style={{ width: 220 }}
                  />
                  <Button icon={<UpOutlined />} disabled={!matches.length} onClick={() => selectMatch(-1)} />
                  <Button icon={<DownOutlined />} disabled={!matches.length} onClick={() => selectMatch(1)} />
                  <Button icon={<CloseOutlined />} onClick={() => { setFindOpen(false); setLogSearch(''); }} />
                </Space.Compact>
              ) : null}
              {findOpen ? <Typography.Text type="secondary">{matches.length ? `${Math.max(findIndex + 1, 0)}/${matches.length}` : '无匹配'}</Typography.Text> : null}
            </Space>
            <Input.TextArea
              ref={logTextAreaRef}
              value={logText}
              onChange={(event) => setLogText(event.target.value)}
              autoSize={{ minRows: 16, maxRows: 32 }}
              spellCheck={false}
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', whiteSpace: 'pre', lineHeight: 1.5 }}
            />
          </Space>
        </Card>
      ) : null}
    </Space>
  );
}
