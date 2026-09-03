import { useEffect, useMemo, useState } from 'react';
import { Alert, AutoComplete, Button, Card, Col, Descriptions, Input, InputNumber, Row, Space, Table, Tag, Typography, message } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { api } from '../api';
import HoverPreviewText from '../components/HoverPreviewText';

type ResultData = {
  input: Record<string, any>;
  resolved: Record<string, any>;
  sections: Record<string, any>;
  diagnostics: string[];
} | null;

const RECENT_TROUBLESHOOT_QUERIES_KEY = 'troubleshoot_recent_queries';
const MAX_RECENT_TROUBLESHOOT_QUERIES = 10;

type RecentTroubleshootQuery = { robot_id: string; message_id: string };

function readRecentQueries(): RecentTroubleshootQuery[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_TROUBLESHOOT_QUERIES_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    const normalized = value
      .filter((item): item is RecentTroubleshootQuery => Boolean(item && typeof item === 'object' && (item.robot_id || item.message_id)))
      .map((item) => ({ robot_id: String(item.robot_id || ''), message_id: String(item.message_id || '') }))
    const seen = new Set<string>();
    return normalized.filter((item) => {
      // A messageId identifies one troubleshooting query. Older versions could
      // leave both the pre-resolve and post-resolve records behind.
      const key = item.message_id ? `message:${item.message_id}` : `robot:${item.robot_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, MAX_RECENT_TROUBLESHOOT_QUERIES);
  } catch {
    return [];
  }
}

export default function TroubleshootPage() {
  const [recentQueries, setRecentQueries] = useState<RecentTroubleshootQuery[]>(() => readRecentQueries());
  const [robotId, setRobotId] = useState(() => readRecentQueries()[0]?.robot_id || '');
  const [messageId, setMessageId] = useState(() => readRecentQueries()[0]?.message_id || '');
  const [keyword, setKeyword] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResultData>(null);

  useEffect(() => {
    try {
      localStorage.setItem(RECENT_TROUBLESHOOT_QUERIES_KEY, JSON.stringify(recentQueries));
    } catch {
      // Ignore storage errors (private browsing, quota, etc.).
    }
  }, [recentQueries]);

  const rememberQuery = (nextRobotId: string, nextMessageId: string) => {
    const robot = nextRobotId.trim();
    const message = nextMessageId.trim();
    if (!robot && !message) return;
    setRecentQueries((items) => {
      const next = { robot_id: robot, message_id: message };
      const filtered = items.filter((item) => message
        ? item.message_id !== message
        : !(item.robot_id === robot && !item.message_id));
      return [next, ...filtered].slice(0, MAX_RECENT_TROUBLESHOOT_QUERIES);
    });
  };

  const recentRobotOptions = useMemo(
    () => Array.from(new Set(recentQueries.map((item) => item.robot_id).filter(Boolean)))
      .map((value) => ({ value, label: `最近使用：${value}` })),
    [recentQueries]
  );
  const recentMessageOptions = useMemo(
    () => Array.from(new Set(recentQueries.map((item) => item.message_id).filter(Boolean)))
      .map((value) => ({ value, label: `最近使用：${value}` })),
    [recentQueries]
  );

  const runSearch = async () => {
    const inputRobotId = robotId.trim();
    const inputMessageId = messageId.trim();
    rememberQuery(inputRobotId, inputMessageId);
    setLoading(true);
    try {
      const data = await api.troubleshootSearch({
        robot_id: inputRobotId,
        message_id: inputMessageId,
        keyword: keyword.trim(),
        start_time: startTime.trim(),
        end_time: endTime.trim(),
        limit
      });
      setResult(data);
      const resolvedRobotId = String(data?.resolved?.robot_id || inputRobotId).trim();
      if (resolvedRobotId !== inputRobotId) rememberQuery(resolvedRobotId, inputMessageId);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '查询失败');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const qaRows = useMemo(() => result?.sections?.['问答回调记录'] || [], [result]);
  const rawMessageRows = useMemo(() => result?.sections?.['raw_message_record 指令发送记录表'] || [], [result]);
  const rawConfirmRows = useMemo(() => result?.sections?.['raw_msg_confirm 指令客户端执行结果表'] || [], [result]);
  const connectRows = useMemo(() => result?.sections?.['robot_log 连接建立记录'] || [], [result]);
  const callbackRows = useMemo(() => result?.sections?.['回调配置'] || [], [result]);
  const onlineRows = useMemo(() => result?.sections?.['上线记录(最多20条)'] || [], [result]);
  const localLogRows = useMemo(() => result?.sections?.['本地消息处理记录'] || [], [result]);
  const robotStatus = result?.sections?.['机器人状态'] || {};

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card title="机器人排查">
        <Row gutter={12}>
          <Col span={8}>
            <AutoComplete
              value={robotId}
              onChange={setRobotId}
              options={recentRobotOptions}
              filterOption={(input, option) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())}
              style={{ width: '100%' }}
            >
              <Input placeholder="robot_id（可选）" />
            </AutoComplete>
          </Col>
          <Col span={8}>
            <AutoComplete
              value={messageId}
              onChange={setMessageId}
              options={recentMessageOptions}
              filterOption={(input, option) => String(option?.value || '').includes(input)}
              style={{ width: '100%' }}
            >
              <Input placeholder="message_id（可选）" />
            </AutoComplete>
          </Col>
          <Col span={8}>
            <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="关键词（可选）" />
          </Col>
        </Row>
        <Row gutter={12} style={{ marginTop: 12 }}>
          <Col span={8}>
            <Input value={startTime} onChange={(e) => setStartTime(e.target.value)} placeholder="开始时间（如 2026-03-01 00:00:00）" />
          </Col>
          <Col span={8}>
            <Input value={endTime} onChange={(e) => setEndTime(e.target.value)} placeholder="结束时间（如 2026-03-01 23:59:59）" />
          </Col>
          <Col span={4}>
            <InputNumber min={1} max={100} value={limit} onChange={(v) => setLimit(Number(v || 20))} style={{ width: '100%' }} />
          </Col>
          <Col span={4}>
            <Button type="primary" icon={<SearchOutlined />} loading={loading} onClick={runSearch} block>
              查询
            </Button>
          </Col>
        </Row>
      </Card>

      {result?.diagnostics?.length ? (
        <Card title="诊断提示">
          <Space direction="vertical" style={{ width: '100%' }}>
            {result.diagnostics.map((x, idx) => (
              <Alert key={`${x}-${idx}`} type="warning" showIcon message={x} />
            ))}
          </Space>
        </Card>
      ) : null}

      {result ? (
        <Card title="查询概览">
          <Descriptions column={2} size="small" bordered>
            <Descriptions.Item label="输入 robot_id">{result.input?.robot_id || '-'}</Descriptions.Item>
            <Descriptions.Item label="输入 message_id">{result.input?.message_id || '-'}</Descriptions.Item>
            <Descriptions.Item label="解析后 robot_id">{result.resolved?.robot_id || '-'}</Descriptions.Item>
            <Descriptions.Item label="由 message_id 反查">{result.resolved?.message_resolved_robot ? '是' : '否'}</Descriptions.Item>
          </Descriptions>
        </Card>
      ) : null}

      {result ? (
        <Card title="机器人状态">
          <Descriptions column={2} size="small" bordered>
            {Object.entries(robotStatus).map(([k, v]) => (
              <Descriptions.Item key={k} label={k}>
                {typeof v === 'boolean' ? <Tag color={v ? 'blue' : 'red'}>{v ? '是' : '否'}</Tag> : String(v ?? '-')}
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Card>
      ) : null}

      {result ? (
        <Card title={`回调配置 (${callbackRows.length})`}>
          <Table
            rowKey={(_, idx) => String(idx)}
            pagination={false}
            dataSource={callbackRows}
            columns={[
              { title: '回调类型', dataIndex: '回调类型' },
              { title: '回调地址', dataIndex: '回调地址', render: (v: string) => <HoverPreviewText value={v} maxWidth={560} popupWidth={760} /> },
              { title: '类型编号', dataIndex: '类型编号', width: 100 }
            ]}
          />
        </Card>
      ) : null}

      {result ? (
        <Card title={`robot_log 连接建立记录 (${connectRows.length})`}>
          <Table
            rowKey={(_, idx) => String(idx)}
            dataSource={connectRows}
            pagination={false}
            scroll={{ x: 1600 }}
            columns={[
              { title: '登录时间', dataIndex: '登录时间', width: 180 },
              { title: '登录IP', dataIndex: '登录IP', width: 140 },
              { title: 'App版本', dataIndex: 'App版本', width: 120 },
              { title: 'Android版本', dataIndex: 'Android版本', width: 120 },
              { title: '手机型号', dataIndex: '手机型号', width: 220, render: (v: string) => <HoverPreviewText value={v} maxWidth={200} /> },
              { title: 'WorkVersion', dataIndex: 'WorkVersion', width: 120 },
              { title: '设备Root', dataIndex: '设备Root', width: 90 },
              { title: 'Hook', dataIndex: 'Hook', width: 90 },
              { title: 'App名称', dataIndex: 'App名称', width: 140 },
              { title: 'Blue', dataIndex: 'Blue', width: 80 },
              { title: '原始日志', dataIndex: '原始日志', render: (v: string) => <HoverPreviewText value={v} maxWidth={520} popupWidth={820} /> }
            ]}
          />
        </Card>
      ) : null}

      {result ? (
        <Card title={`上线记录 (${onlineRows.length})`}>
          <Table
            rowKey={(_, idx) => String(idx)}
            pagination={false}
            dataSource={onlineRows}
            columns={[
              { title: '上线时间', dataIndex: '上线时间' },
              { title: '下线时间', dataIndex: '下线时间' },
              { title: '在线时长(分钟)', dataIndex: '在线时长(分钟)' },
              { title: '登录IP', dataIndex: '登录IP' }
            ]}
          />
        </Card>
      ) : null}

      {result ? (
        <Card title={`raw_message_record 指令发送记录表 (${rawMessageRows.length})`}>
          <Table
            rowKey={(_, idx) => String(idx)}
            dataSource={rawMessageRows}
            pagination={false}
            scroll={{ x: 1200 }}
            columns={[
              { title: '时间', dataIndex: '时间', width: 180 },
              { title: '消息ID', dataIndex: '消息ID', width: 220, render: (v: string) => <HoverPreviewText value={v} maxWidth={200} popupWidth={760} /> },
              { title: '接收对象', dataIndex: '接收对象', width: 220, render: (v: string) => <HoverPreviewText value={v} maxWidth={200} /> },
              { title: '发送内容', dataIndex: '发送内容', render: (v: string) => <HoverPreviewText value={v} maxWidth={520} popupWidth={780} /> },
              { title: '消息类型', dataIndex: '消息类型', width: 100 },
              { title: '状态', dataIndex: '状态', width: 100 }
            ]}
          />
        </Card>
      ) : null}

      {result ? (
        <Card title={`raw_msg_confirm 指令客户端执行结果表 (${rawConfirmRows.length})`}>
          <Table
            rowKey={(_, idx) => String(idx)}
            dataSource={rawConfirmRows}
            pagination={false}
            columns={[
              { title: '时间', dataIndex: '时间', width: 180 },
              { title: '消息ID', dataIndex: '消息ID', width: 220, render: (v: string) => <HoverPreviewText value={v} maxWidth={200} popupWidth={760} /> },
              { title: '执行结果', dataIndex: '执行结果', width: 100 },
              { title: '执行耗时(秒)', dataIndex: '执行耗时(秒)', width: 120 },
              { title: '失败原因', dataIndex: '失败原因', render: (v: string) => <HoverPreviewText value={v} maxWidth={520} /> }
            ]}
          />
        </Card>
      ) : null}

      {result ? (
        <Card title={`问答回调记录 (${qaRows.length})`}>
          <Table
            rowKey={(_, idx) => String(idx)}
            dataSource={qaRows}
            pagination={false}
            scroll={{ x: 1400 }}
            columns={[
              { title: '时间', dataIndex: '时间', width: 180 },
              { title: '提问者', dataIndex: '提问者', width: 120 },
              { title: '会话', dataIndex: '会话', width: 180, render: (v: string) => <HoverPreviewText value={v} maxWidth={160} /> },
              { title: '是否@', dataIndex: '是否@', width: 90, render: (v: any) => (v === true ? '是' : v === false ? '否' : '-') },
              { title: '问题', dataIndex: '问题', width: 300, render: (v: string) => <HoverPreviewText value={v} maxWidth={280} popupWidth={820} /> },
              { title: '原始问题', dataIndex: '原始问题', width: 300, render: (v: string) => <HoverPreviewText value={v} maxWidth={280} popupWidth={820} /> },
              { title: '回答', dataIndex: '回答', width: 300, render: (v: string) => <HoverPreviewText value={v} maxWidth={280} popupWidth={820} /> },
              { title: '消息ID', dataIndex: '消息ID', width: 220, render: (v: string) => <HoverPreviewText value={v} maxWidth={200} popupWidth={760} /> }
            ]}
          />
        </Card>
      ) : null}

      {result ? (
        <Card title={`本地消息处理记录 (${localLogRows.length})`}>
          <Table
            rowKey={(_, idx) => String(idx)}
            dataSource={localLogRows}
            pagination={false}
            columns={[
              { title: '时间', dataIndex: '时间', width: 180 },
              { title: '方向', dataIndex: '方向', width: 80 },
              { title: '场景', dataIndex: '场景', width: 80 },
              { title: '会话', dataIndex: '会话', width: 180, render: (v: string) => <HoverPreviewText value={v} maxWidth={160} /> },
              { title: '消息', dataIndex: '消息', render: (v: string) => <HoverPreviewText value={v} maxWidth={560} popupWidth={820} /> },
              { title: '状态', dataIndex: '状态', width: 100 }
            ]}
          />
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
            已去除 SQL 与敏感字段，仅保留排查必要信息。
          </Typography.Paragraph>
        </Card>
      ) : null}
    </Space>
  );
}
