import { useRef, useState } from 'react';
import { Button, Form, Image, Input, Modal, Radio, Space, Typography, message } from 'antd';
import { CameraOutlined, DeleteOutlined, UploadOutlined } from '@ant-design/icons';
import { api } from '../api';
import { getLastSelectedRobotId } from '../robotSelection';

async function prepareImage(file: Blob): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  if (file.size > 20 * 1024 * 1024) throw new Error('原始图片不能超过 20MB');
  const url = URL.createObjectURL(file);
  try {
    const img = new window.Image();
    img.src = url;
    await img.decode();
    const ratio = Math.min(1, 1920 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * ratio));
    canvas.height = Math.max(1, Math.round(img.height * ratio));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器无法处理截图');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', 0.85);
    if (data.length > 2796200) throw new Error('截图过大，请裁剪后重试');
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function FeedbackModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm();
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [noRobotPrompt, setNoRobotPrompt] = useState(false);
  const processingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const kind = Form.useWatch('kind', form);

  const addFiles = async (files: Blob[]) => {
    if (busy || processingRef.current) return;
    const available = 3 - images.length;
    if (files.length > available) message.info('最多添加 3 张截图');
    if (available <= 0) return;
    processingRef.current = true;
    setProcessing(true);
    try {
      const converted = await Promise.all(files.slice(0, available).map(prepareImage));
      setImages((previous) => [...previous, ...converted].slice(0, 3));
    } catch (error: any) {
      message.error(error?.message || '图片处理失败，请重新选择');
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  };

  const capture = async () => {
    setCapturing(true);
    try {
      const { default: html2canvas } = await import('html2canvas');
      // Let the modal and its mask disappear before rendering the viewport.
      await new Promise((resolve) => setTimeout(resolve, 350));
      const canvas = await html2canvas(document.body, {
        width: window.innerWidth, height: window.innerHeight,
        x: window.scrollX, y: window.scrollY,
        windowWidth: window.innerWidth, windowHeight: window.innerHeight,
        scale: Math.min(window.devicePixelRatio || 1, 2), useCORS: true, logging: false,
        ignoreElements: (element) => element.matches('.feedback-modal-root, .ant-message, .chatbot-shell'),
      });
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error('截图生成失败')), 'image/png'));
      await addFiles([blob]);
    } catch {
      message.error('页面截图失败，请使用系统截图后粘贴或上传');
    } finally {
      setCapturing(false);
    }
  };

  const submit = async (forceWithoutRobot = false) => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    const robotId = getLastSelectedRobotId() || '';
    if (!robotId.trim() && !forceWithoutRobot && document.querySelector('.chatbot-shell')) {
      setNoRobotPrompt(true);
      return;
    }
    setBusy(true);
    try {
      await api.submitFeedback({ ...values, contact: values.contact || '', page: window.location.pathname.slice(0, 300), robot_id: robotId, images });
      message.success('反馈已发送，感谢你的建议！');
      form.resetFields();
      setImages([]);
      onClose();
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      message.error(typeof detail === 'string' ? detail : '发送失败，请稍后重试；内容已保留');
    } finally {
      setBusy(false);
    }
  };

  const openAssistant = async () => {
    if (!document.querySelector('.chatbot-shell')) {
      setNoRobotPrompt(false);
      void submit(true);
      return;
    }
    const prompt = String(form.getFieldValue('description') || '').trim();
    setNoRobotPrompt(false);
    onClose();
    window.dispatchEvent(new CustomEvent('worktool-open-chatbot', {
      detail: { prompt },
    }));
    try {
      if (prompt) await navigator.clipboard.writeText(prompt);
      message.info(prompt ? '已打开在线助手，问题内容已复制，请粘贴后发送。' : '已打开在线助手，请直接描述你的问题。');
    } catch {
      message.info('已打开在线助手；请将问题复制到对话框发送。');
    }
  };

  const continueSubmit = () => {
    setNoRobotPrompt(false);
    window.setTimeout(() => void submit(true), 0);
  };

  return (
    <>
    <Modal rootClassName="feedback-modal-root" title="建议与反馈" open={open && !capturing} onCancel={onClose} onOk={() => void submit()}
      okText="提交反馈" cancelText="关闭" confirmLoading={busy} closable={!busy && !processing}
      maskClosable={!busy && !processing} keyboard={!busy && !processing}
      cancelButtonProps={{ disabled: busy || processing }} okButtonProps={{ disabled: processing }} width={600}>
      <div onPaste={(event) => {
        const files = Array.from(event.clipboardData.items).filter((item) => item.type.startsWith('image/'))
          .map((item) => item.getAsFile()).filter((file): file is File => file !== null);
        if (files.length) { event.preventDefault(); void addFiles(files); }
      }}>
        <Form form={form} layout="vertical" initialValues={{ kind: 'problem' }} disabled={busy}>
          <Form.Item name="kind" label="反馈类型">
            <Radio.Group optionType="button" buttonStyle="solid" options={[
              { label: '问题反馈', value: 'problem' }, { label: '功能建议', value: 'suggestion' },
            ]} />
          </Form.Item>
          <Form.Item name="description" label="内容描述" rules={[{ required: true, whitespace: true, message: '请填写反馈内容' }]}>
            <Input.TextArea rows={5} maxLength={1500} showCount placeholder={kind === 'suggestion' ? '你希望增加什么功能？它可以帮助你解决什么问题？' : '遇到了什么问题？请描述操作步骤、实际情况和预期结果。可直接粘贴截图。'} />
          </Form.Item>
          <Form.Item label="截图附件">
            <Space wrap>
              <Button icon={<CameraOutlined />} disabled={busy || images.length >= 3 || processing} onClick={() => void capture()}>截取当前页面</Button>
              <Button icon={<UploadOutlined />} loading={processing} disabled={busy || processing || images.length >= 3} onClick={() => inputRef.current?.click()}>上传图片</Button>
            </Space>
            <input ref={inputRef} type="file" accept="image/*" multiple hidden style={{ display: 'none' }} onChange={(event) => {
              void addFiles(Array.from(event.target.files || [])); event.target.value = '';
            }} />
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 8 }}>
              支持 Ctrl+V / ⌘V 粘贴，最多 3 张。截图可预览、删除；页面截图仅包含当前可见区域。
            </Typography.Paragraph>
            <Space wrap align="start">
              {images.map((src, index) => <div key={index}>
                <Image src={src} width={120} height={85} style={{ objectFit: 'contain' }} alt={`反馈截图 ${index + 1}`} />
                <Button type="text" size="small" icon={<DeleteOutlined />} disabled={busy || processing}
                  onClick={() => setImages((previous) => previous.filter((_, i) => i !== index))}>删除</Button>
              </div>)}
            </Space>
          </Form.Item>
          <Form.Item name="contact" label="联系方式（选填）"><Input maxLength={150} placeholder="方便我们联系你的微信、手机号或邮箱" /></Form.Item>
          <Typography.Text type="secondary">提交时会附带当前账号、选中的机器人 ID、页面路径及时间。</Typography.Text>
        </Form>
      </div>
    </Modal>
    <Modal
      title="建议先使用在线助手"
      open={noRobotPrompt}
      onCancel={() => setNoRobotPrompt(false)}
      footer={(
        <Space>
          <Button onClick={() => setNoRobotPrompt(false)}>返回修改</Button>
          <Button type="primary" onClick={openAssistant}>打开在线助手</Button>
          <Button onClick={continueSubmit}>仍然提交反馈</Button>
        </Space>
      )}
      width={520}
    >
      <Typography.Paragraph>
        当前没有选择机器人。建议先使用右下角的在线助手，通常可以更快解决问题；如果仍需反馈，也可以继续提交。
      </Typography.Paragraph>
      <Typography.Text type="secondary">打开助手时会尝试复制你的问题，粘贴后即可发送。已填写的反馈会保留。</Typography.Text>
    </Modal>
    </>
  );
}
