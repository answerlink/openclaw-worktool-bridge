import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AutoComplete, Button, Card, Descriptions, Input, Space, Spin, Tooltip, Typography, message } from 'antd';
import { CopyOutlined, DownOutlined, SearchOutlined, UpOutlined, CloseOutlined } from '@ant-design/icons';
import { api } from '../api';

const RECENT_MESSAGE_IDS_KEY = 'client_log_recent_message_ids';
const MAX_RECENT_MESSAGE_IDS = 10;

type QueryResult = {
  status: 'success' | 'timeout';
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
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
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

  const query = async () => {
    const value = messageId.trim();
    if (!value) {
      message.warning('请输入 messageId');
      return;
    }
    setRecentMessageIds((ids) => [value, ...ids.filter((id) => id !== value)].slice(0, MAX_RECENT_MESSAGE_IDS));
    setLoading(true);
    setResult(null);
    try {
      let data = await api.requestClientLogSnippet(value);
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
      setLoading(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="客户端日志查询">
        <Space.Compact style={{ width: '100%', maxWidth: 680 }}>
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
        </Space.Compact>
        <Typography.Paragraph type="secondary" style={{ marginTop: 10, marginBottom: 0 }}>
          系统会根据 messageId 从 WorkTool 指令记录中反查机器人，并等待客户端回传日志，最长等待 60 秒。
        </Typography.Paragraph>
      </Card>

      {loading ? (
        <Card>
          <Space><Spin size="small" />正在请求客户端日志，最长等待 60 秒，请勿重复提交。</Space>
        </Card>
      ) : null}

      {result ? (
        <Card title="查询结果">
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="状态">
              {result.status === 'success' ? <Alert type="success" showIcon message="已收到客户端日志" /> : <Alert type="warning" showIcon message="查询超时" />}
            </Descriptions.Item>
            <Descriptions.Item label="机器人 ID">{result.robot_id}</Descriptions.Item>
            <Descriptions.Item label="Message ID">{result.message_id}</Descriptions.Item>
            <Descriptions.Item label="轮询次数">{result.attempts}</Descriptions.Item>
            <Descriptions.Item label="耗时（秒）">{result.elapsed_seconds}</Descriptions.Item>
          </Descriptions>
          {result.status === 'timeout' ? (
            <Alert
              style={{ marginTop: 12 }}
              type="warning"
              showIcon
              message="客户端未在 60 秒内回传日志"
              description="请确认机器人在线、客户端版本支持该功能，并检查 messageId 是否对应正确的指令。"
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
