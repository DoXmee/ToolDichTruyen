import { Icon } from './Icon';

export type PillTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

interface StatusPillProps {
  children: React.ReactNode;
  tone?: PillTone;
  pulse?: boolean;
}

export function StatusPill({ children, tone = 'neutral', pulse = false }: StatusPillProps) {
  return (
    <span className={`status-pill status-pill--${tone}`}>
      {tone === 'success' ? <Icon name="check" size={13} /> : <span className={`status-dot${pulse ? ' status-dot--pulse' : ''}`} />}
      {children}
    </span>
  );
}
