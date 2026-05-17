// 统一的线性图标。基于 24x24 viewBox，1.6 stroke，currentColor。
// 使用方式：<IconBack /> 或 <IconBack size={18} className="…" />

import type { SVGAttributes } from 'react';

type Props = SVGAttributes<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconBack = (p: Props) => (
  <Svg {...p}>
    <polyline points="15 18 9 12 15 6" />
  </Svg>
);

export const IconHeadphones = (p: Props) => (
  <Svg {...p}>
    <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
    <path d="M21 19a2 2 0 0 1-2 2h-1a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h3z" />
    <path d="M3 19a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3z" />
  </Svg>
);

export const IconRefresh = (p: Props) => (
  <Svg {...p}>
    <polyline points="21 4 21 9 16 9" />
    <polyline points="3 20 3 15 8 15" />
    <path d="M19 9A8 8 0 0 0 5 6.5L3 9" />
    <path d="M5 15a8 8 0 0 0 14 2.5L21 15" />
  </Svg>
);

// 钉/书签图标，作为"锚定到此段"按钮
export const IconPin = (p: Props) => (
  <Svg {...p}>
    <path d="M12 22s-7-7-7-13a7 7 0 0 1 14 0c0 6-7 13-7 13z" />
    <circle cx="12" cy="9" r="2.5" />
  </Svg>
);

export const IconClose = (p: Props) => (
  <Svg {...p}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </Svg>
);

export const IconPlus = (p: Props) => (
  <Svg {...p}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </Svg>
);

export const IconDoc = (p: Props) => (
  <Svg {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="9" y1="13" x2="15" y2="13" />
    <line x1="9" y1="17" x2="15" y2="17" />
  </Svg>
);

export const IconBook = (p: Props) => (
  <Svg {...p}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </Svg>
);

export const IconCheck = (p: Props) => (
  <Svg {...p}>
    <polyline points="20 6 9 17 4 12" />
  </Svg>
);

export const IconTrash = (p: Props) => (
  <Svg {...p}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
  </Svg>
);

export const IconPlay = (p: Props) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <polygon points="6 4 20 12 6 20 6 4" />
  </Svg>
);

export const IconPause = (p: Props) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </Svg>
);

export const IconSkipBack = (p: Props) => (
  <Svg {...p}>
    <path d="M11 17L6 12l5-5" />
    <path d="M18 17L13 12l5-5" />
  </Svg>
);

export const IconSkipForward = (p: Props) => (
  <Svg {...p}>
    <path d="M13 17l5-5-5-5" />
    <path d="M6 17l5-5-5-5" />
  </Svg>
);
