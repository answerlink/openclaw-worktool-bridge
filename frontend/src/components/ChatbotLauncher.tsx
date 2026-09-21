import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { CloseOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import chatbotOpenIcon from '../assets/chatbot-open.png';

const CHATBOT_URL = 'https://question.ymdyes.cn/chat/share?shareId=x7elel4j6j7tu2xvfywc01dm';
const CHATBOT_POSITION_KEY = 'worktool_chatbot_position';

type Position = { x: number; y: number };

function readPosition(): Position {
  try {
    const value = JSON.parse(localStorage.getItem(CHATBOT_POSITION_KEY) || '{}');
    return { x: Number.isFinite(value?.x) ? value.x : 0, y: Number.isFinite(value?.y) ? value.y : 0 };
  } catch {
    return { x: 0, y: 0 };
  }
}

export default function ChatbotLauncher() {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position>(() => readPosition());
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const draggedRef = useRef(false);

  useEffect(() => {
    const openAssistant = () => setOpen(true);
    window.addEventListener('worktool-open-chatbot', openAssistant);
    return () => window.removeEventListener('worktool-open-chatbot', openAssistant);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(CHATBOT_POSITION_KEY, JSON.stringify(position)); } catch { /* ignore storage errors */ }
  }, [position]);

  const onDragStart = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    draggedRef.current = false;
    dragRef.current = { startX: event.clientX, startY: event.clientY, originX: position.x, originY: position.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onDragMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3) draggedRef.current = true;
    setPosition({ x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY });
  };

  const onDragEnd = () => { dragRef.current = null; };

  return (
    <div className="chatbot-shell" style={{ transform: `translate(${position.x}px, ${position.y}px)` }}>
      {open ? (
        <div className="chatbot-window" role="dialog" aria-label="在线助手">
          <div
            className="chatbot-drag-handle"
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
            title="拖动调整位置"
          >
            在线助手
          </div>
          <Button
            className="chatbot-close"
            type="primary"
            shape="circle"
            icon={<CloseOutlined />}
            aria-label="关闭在线助手"
            onClick={() => setOpen(false)}
          />
          <iframe
            src={CHATBOT_URL}
            title="在线助手"
            allow="*"
            referrerPolicy="no-referrer"
          />
        </div>
      ) : (
        <button
          className="chatbot-launcher"
          type="button"
          aria-label="打开在线助手"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          onClick={() => { if (!draggedRef.current) setOpen(true); }}
        >
          <img src={chatbotOpenIcon} alt="" width="40" height="40" draggable={false} />
        </button>
      )}
    </div>
  );
}
