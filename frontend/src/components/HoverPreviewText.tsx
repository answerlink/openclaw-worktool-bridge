import { Popover } from 'antd';

type HoverPreviewTextProps = {
  value?: unknown;
  placeholder?: string;
  maxWidth?: number;
  popupWidth?: number;
};

export default function HoverPreviewText({
  value,
  placeholder = '-',
  maxWidth = 260,
  popupWidth = 680,
}: HoverPreviewTextProps) {
  const text = String(value ?? '').trim();
  if (!text) return <>{placeholder}</>;

  return (
    <Popover
      trigger="hover"
      mouseEnterDelay={0.15}
      mouseLeaveDelay={0.3}
      overlayClassName="wt-hover-preview-popover"
      content={
        <div className="wt-hover-preview-content" style={{ maxWidth: popupWidth }}>
          {text}
        </div>
      }
    >
      <span className="wt-hover-preview-trigger" style={{ maxWidth }}>
        {text}
      </span>
    </Popover>
  );
}

