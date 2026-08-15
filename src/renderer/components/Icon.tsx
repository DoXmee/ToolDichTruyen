import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'alert'
  | 'book'
  | 'check'
  | 'chevron-left'
  | 'chevron-right'
  | 'copy'
  | 'download'
  | 'edit'
  | 'link'
  | 'pause'
  | 'play'
  | 'refresh'
  | 'save'
  | 'sparkles'
  | 'split'
  | 'stop'
  | 'wand';

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

const paths: Record<IconName, ReactNode> = {
  alert: <><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.7 2.2 18a2 2 0 0 0 1.8 3h16a2 2 0 0 0 1.8-3L13.7 3.7a2 2 0 0 0-3.4 0Z" /></>,
  book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /><path d="M8 7h8M8 11h6" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  'chevron-left': <path d="m15 18-6-6 6-6" />,
  'chevron-right': <path d="m9 18 6-6-6-6" />,
  copy: <><rect width="14" height="14" x="8" y="8" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1" /><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1" /></>,
  pause: <><rect width="4" height="16" x="6" y="4" rx="1" /><rect width="4" height="16" x="14" y="4" rx="1" /></>,
  play: <path d="m7 4 13 8-13 8Z" />,
  refresh: <><path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5" /><path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" /></>,
  save: <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" /><path d="M17 21v-8H7v8M7 3v5h8" /></>,
  sparkles: <><path d="m12 3-1.3 3.7L7 8l3.7 1.3L12 13l1.3-3.7L17 8l-3.7-1.3Z" /><path d="m19 14-.8 2.2L16 17l2.2.8L19 20l.8-2.2L22 17l-2.2-.8ZM5 3l.7 1.8L7.5 5.5l-1.8.7L5 8l-.7-1.8-1.8-.7 1.8-.7Z" /></>,
  split: <><path d="M4 4v6a2 2 0 0 0 2 2h12" /><path d="m14 8 4 4-4 4" /><path d="M4 20v-2a6 6 0 0 1 6-6" /></>,
  stop: <rect width="14" height="14" x="5" y="5" rx="2" />,
  wand: <><path d="m15 4 5 5L8 21l-5-5Z" /><path d="m6 4 .7 1.8L8.5 6.5l-1.8.7L6 9l-.7-1.8-1.8-.7 1.8-.7ZM19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7Z" /></>,
};

export function Icon({ name, size = 18, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
