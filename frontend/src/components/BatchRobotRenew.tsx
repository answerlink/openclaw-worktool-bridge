import { useEffect, useRef, useState } from 'react';
import { Button, Card, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import dayjs from 'dayjs';
import { api } from '../api';
import { batchRenewDate, parseRenewRobotIds, type RenewMonths } from '../batchRobotRenew';

type Status = 'waiting' | 'running' | 'success' | 'failed' | 'unknown' | 'skipped';
interface Row {
  robotId: string;
  name?: string;
  before?: string;
  after?: string;
  status: Status;
  detail?: string;
}
const labels: Record<Status, string> = {
  waiting: '等待处理', running: '处理中', success: '续期成功', failed: '查询失败', unknown: '需核实', skipped: '未执行'
};
const periods = [{ value: 1, label: '一个月' }, { value: 3, label: '一季度' }, { value: 12, label: '一年' }];

export default function BatchRobotRenew({ onComplete }: { onComplete: () => void }) {
  const [text, setText] = useState('');
  const [months, setMonths] = useState<RenewMonths>(12);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const active = useRef(false);
  const mounted = useRef(true);
  const stop = useRef(false);
  const ids = parseRenewRobotIds(text);

  useEffect(() => {
    mounted.current = true;
    const warn = (event: BeforeUnloadEvent) => {
      if (active.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => { mounted.current = false; stop.current = true; window.removeEventListener('beforeunload', warn); };
  }, []);

  const execute = async (targets: string[], duration: RenewMonths) => {
    if (active.current || !mounted.current) return;
    active.current = true;
    stop.current = false;
    setRunning(true);
    const results: Row[] = targets.map((robotId) => ({ robotId, status: 'waiting' }));
    const publish = () => { if (mounted.current) setRows(results.map((row) => ({ ...row }))); };
    const today = dayjs();
    publish();
    try {
      for (const row of results) {
        if (stop.current) { row.status = 'skipped'; continue; }
        row.status = 'running';
        publish();
        let submitted = false;
        try {
          const info = await api.adminRobotInfo(row.robotId);
          row.name = info.show_name || info.name || '-';
          row.before = info.auth_expir || '未设置';
          row.after = batchRenewDate(info.auth_expir, duration, today);
          if (stop.current) { row.status = 'skipped'; continue; }
          submitted = true;
          const res = await api.adminRobotRenew(row.robotId, row.after);
          if (res?.ok !== true) throw new Error('续期响应异常');
          row.status = 'success';
        } catch (e: any) {
          row.status = submitted ? 'unknown' : 'failed';
          const detail = e?.response?.data?.detail;
          row.detail = typeof detail === 'string' ? detail : e?.message || '请求失败';
          if (submitted) row.detail += '；请查询当前到期时间或操作记录确认结果后再续期';
        }
        publish();
      }
    } finally {
      publish();
      active.current = false;
      if (mounted.current) {
        setRunning(false);
        onComplete();
        const success = results.filter((row) => row.status === 'success').length;
        message.info(`批量处理结束：成功 ${success} / ${targets.length} 个`);
      }
    }
  };

  const confirm = () => {
    if (!ids.length) { message.warning('请输入机器人ID，每行一个'); return; }
    if (ids.some((id) => /\s/.test(id))) { message.warning('每行只填写一个机器人ID，不要带名称或其他内容'); return; }
    Modal.confirm({
      title: '确认批量续期',
      content: `将为 ${ids.length} 个机器人分别续期${periods.find((p) => p.value === months)?.label}。未到期的从当前到期日延长，已过期或未设置到期日的从今天起算。`,
      okText: '确认续期', cancelText: '取消',
      onOk: () => { void execute(ids, months); }
    });
  };

  const finished = rows.filter((row) => !['waiting', 'running'].includes(row.status)).length;
  return (
    <Card title="批量续期">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Text type="secondary">每行一个机器人ID，自动忽略空行和重复ID。未到期的从当前到期日延长，已过期或未设置到期日的从今天起算。</Typography.Text>
        <Input.TextArea aria-label="批量续期机器人ID" value={text} onChange={(e) => setText(e.target.value)} disabled={running} autoSize={{ minRows: 5, maxRows: 12 }} placeholder={'粘贴机器人ID，每行一个\nwt...\nwc...'} />
        <Space wrap>
          <Typography.Text>共 {ids.length} 个机器人</Typography.Text>
          <Typography.Text>续期时长</Typography.Text>
          <Select<RenewMonths> aria-label="续期时长" value={months} onChange={setMonths} disabled={running} options={periods} style={{ width: 140 }} />
          <Button type="primary" loading={running} disabled={!ids.length} onClick={confirm}>批量续期</Button>
          {running && <Button onClick={() => { stop.current = true; }}>停止后续处理</Button>}
        </Space>
        {rows.length > 0 && <>
          <Typography.Text>已处理 {finished} / {rows.length}，成功 {rows.filter((r) => r.status === 'success').length}，查询失败 {rows.filter((r) => r.status === 'failed').length}，需核实 {rows.filter((r) => r.status === 'unknown').length}</Typography.Text>
          <Table<Row> size="small" rowKey="robotId" dataSource={rows} scroll={{ x: 1000 }} pagination={{ pageSize: 10 }} columns={[
            { title: '机器人ID', dataIndex: 'robotId', width: 280 },
            { title: '名称', dataIndex: 'name', width: 140 },
            { title: '原到期时间', dataIndex: 'before', width: 180 },
            { title: '续期到', dataIndex: 'after', width: 120 },
            { title: '状态', dataIndex: 'status', width: 110, render: (status: Status) => <Tag color={status === 'success' ? 'success' : ['failed', 'unknown'].includes(status) ? 'error' : 'default'}>{labels[status]}</Tag> },
            { title: '说明', dataIndex: 'detail' }
          ]} />
        </>}
      </Space>
    </Card>
  );
}
