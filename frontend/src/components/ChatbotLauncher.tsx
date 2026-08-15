import { useState } from 'react';
import { CloseOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import chatbotOpenIcon from '../assets/chatbot-open.png';

const CHATBOT_URL = 'https://question.ymdyes.cn/chat/share?shareId=x7elel4j6j7tu2xvfywc01dm';

export default function ChatbotLauncher() {
  const [open, setOpen] = useState(false);

  return (
    <div className="chatbot-shell">
      {open ? (
        <div className="chatbot-window" role="dialog" aria-label="在线助手">
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
          onClick={() => setOpen(true)}
        >
          <img src={chatbotOpenIcon} alt="" width="40" height="40" draggable={false} />
        </button>
      )}
    </div>
  );
}
