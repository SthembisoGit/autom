export type NoticeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

type NoticeBannerProps = {
  message: string;
  title?: string;
  tone?: NoticeTone;
};

export function NoticeBanner({ message, title, tone = 'neutral' }: NoticeBannerProps) {
  const role = tone === 'danger' ? 'alert' : 'status';

  return (
    <div className={`notice notice-${tone}`} role={role}>
      {title ? <p className="notice-title">{title}</p> : null}
      <p className="notice-message">{message}</p>
    </div>
  );
}
