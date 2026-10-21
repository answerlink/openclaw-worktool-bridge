import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Input, InputNumber, Select, Space, Typography, message } from 'antd';
import { api } from '../api';

export default function BatchRobotCreate({ onComplete }: { onComplete: (ids: string[]) => void }) {
  const [robotType, setRobotType] = useState<0 | 1>(0);
  const [count, setCount] = useState<number | null>(1);
  const [running, setRunning] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const active = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const warn = (event: BeforeUnloadEvent) => {
      if (active.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => { mounted.current = false; window.removeEventListener('beforeunload', warn); };
  }, []);
  const output = ids.map((id, index) => `机器人id${index + 1}：${id}`).join('\n');
  const generate = async () => {
    if (active.current) return;
    if (!count || !Number.isInteger(count) || count < 1 || count > 100) {
      message.warning('请输入 1–100 之间的整数');
      return;
    }
    active.current = true;
    setRunning(true);
    setIds([]);
    setError('');
    setWarning('');
    const created: string[] = [];
    try {
      for (let index = 0; index < count && mounted.current; index++) {
        const res = await api.adminRobotCreate(robotType);
        if (res?.ok !== true || typeof res.robot_id !== 'string' || !res.robot_id) throw new Error('创建响应异常');
        created.push(res.robot_id);
        if (mounted.current) {
          setIds([...created]);
          if (res.warning) setWarning(res.warning);
        }
      }
      if (mounted.current) message.success(`已生成 ${created.length} 个机器人`);
    } catch (e: any) {
      if (mounted.current) {
        const detail = e?.response?.data?.detail;
        setError(`第 ${created.length + 1} 个机器人未取得确认结果，已停止后续生成。${typeof detail === 'string' ? detail : e?.message || '请求失败'}。请先查询操作记录确认结果，已返回的ID保留在下方。`);
      }
    } finally {
      active.current = false;
      if (mounted.current) {
        setRunning(false);
        onComplete(created);
      }
    }
  };
  return (
    <Card title="新增机器人">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space wrap>
          <Typography.Text>机器人类型</Typography.Text>
          <Select<0 | 1> aria-label="机器人类型" value={robotType} onChange={setRobotType} disabled={running} style={{ width: 180 }} options={[{ value: 0, label: '企微（企业微信）' }, { value: 1, label: '个微（个人微信）' }]} />
          <Typography.Text>生成数量</Typography.Text>
          <InputNumber aria-label="生成数量" min={1} max={100} precision={0} value={count} onChange={setCount} disabled={running} />
          <Button type="primary" loading={running} onClick={() => void generate()}>生成机器人ID</Button>
        </Space>
        <Typography.Text type="secondary">企微 ID 为 wt + 30 位随机字符，个微 ID 为 wc + 30 位随机字符。每次可生成 1–100 个，创建后可继续续期。</Typography.Text>
        {running && <Typography.Text>已生成 {ids.length} / {count} 个</Typography.Text>}
        {error && <Alert type="error" showIcon message={error} />}
        {warning && <Alert type="warning" showIcon message={warning} />}
        {ids.length > 0 && <>
          <Typography.Text copyable={{ text: output }}>复制全部机器人ID（共 {ids.length} 个）</Typography.Text>
          <Input.TextArea aria-label="生成结果" readOnly value={output} autoSize={{ minRows: 3, maxRows: 15 }} />
        </>}
      </Space>
    </Card>
  );
}
