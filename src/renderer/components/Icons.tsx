import type { ReactNode } from 'react'

interface Props {
  size?: number
}

const base = (size: number, children: ReactNode): ReactNode => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

export const IconDashboard = ({ size = 18 }: Props): ReactNode =>
  base(size, <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>)

export const IconVideo = ({ size = 18 }: Props): ReactNode =>
  base(size, <><rect x="2.5" y="5" width="14" height="14" rx="2.5" /><path d="M16.5 10.5 21.5 7.5v9l-5-3z" /></>)

export const IconStream = ({ size = 18 }: Props): ReactNode =>
  base(size, <><circle cx="12" cy="12" r="2.5" /><path d="M6.5 6.5a8 8 0 0 0 0 11M17.5 17.5a8 8 0 0 0 0-11" /><path d="M3.5 3.5a12.5 12.5 0 0 0 0 17M20.5 20.5a12.5 12.5 0 0 0 0-17" /></>)

export const IconTimer = ({ size = 18 }: Props): ReactNode =>
  base(size, <><circle cx="12" cy="13.5" r="7.5" /><path d="M12 9.5v4l2.5 1.5M9.5 2.5h5" /></>)

export const IconLog = ({ size = 18 }: Props): ReactNode =>
  base(size, <><path d="M4 5h16M4 12h16M4 19h10" /></>)

export const IconSettings = ({ size = 18 }: Props): ReactNode =>
  base(size, <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 15a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10.3 4.4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7 2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.3.9z" /></>)

export const IconPlus = ({ size = 16 }: Props): ReactNode =>
  base(size, <path d="M12 5v14M5 12h14" />)

export const IconCheck = ({ size = 13 }: Props): ReactNode =>
  base(size, <path d="m4.5 12.5 5 5 10-11" />)

export const IconFolder = ({ size = 16 }: Props): ReactNode =>
  base(size, <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5z" />)

export const IconPremiere = ({ size = 20 }: Props): ReactNode => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <rect x="1" y="1" width="22" height="22" rx="5" fill="#2A0634" />
    <text
      x="12"
      y="16.6"
      textAnchor="middle"
      fontFamily="Arial, Helvetica, sans-serif"
      fontSize="11.5"
      fontWeight="700"
      fill="#9999FF"
    >
      Pr
    </text>
  </svg>
)

export const IconCalendar = ({ size = 15 }: Props): ReactNode =>
  base(size, <><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 10h18M8 3v4M16 3v4" /></>)

export const IconTrash = ({ size = 16 }: Props): ReactNode =>
  base(size, <><path d="M4 7h16M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" /><path d="M6.5 7l.8 11.1A1.5 1.5 0 0 0 8.8 19.5h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7" /><path d="M10.5 11v5M13.5 11v5" /></>)

export const IconSearch = ({ size = 14 }: Props): ReactNode =>
  base(size, <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>)

export const IconRefresh = ({ size = 15 }: Props): ReactNode =>
  base(size, <><path d="M20 11a8 8 0 0 0-13.7-5.4L3 9" /><path d="M4 13a8 8 0 0 0 13.7 5.4L21 15" /><path d="M3 4v5h5M21 20v-5h-5" /></>)

export const IconTools = ({ size = 18 }: Props): ReactNode =>
  base(size, <path d="M14.5 5.5a4 4 0 0 0 5.2 5.2l-8.6 8.6a2.4 2.4 0 0 1-3.4-3.4z M17.5 3.2 20.8 6.5" />)

export const IconMic = ({ size = 16 }: Props): ReactNode =>
  base(size, <><rect x="9" y="3" width="6" height="10" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" /></>)

export const IconExternal = ({ size = 15 }: Props): ReactNode =>
  base(size, <><path d="M14 4h6v6" /><path d="M20 4 11.5 12.5" /><path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7.5A1.5 1.5 0 0 1 5 6h4.5" /></>)

export const IconPlay = ({ size = 20 }: Props): ReactNode =>
  base(size, <path d="M7 4.5v15l13-7.5z" />)

export const IconStop = ({ size = 20 }: Props): ReactNode =>
  base(size, <rect x="6" y="6" width="12" height="12" rx="2" />)

export const IconImage = ({ size = 16 }: Props): ReactNode =>
  base(size, <><rect x="3" y="4.5" width="18" height="15" rx="2" /><circle cx="8.5" cy="10" r="1.6" /><path d="m4 17 5-4.5 4.5 4 3-2.5 4 3.5" /></>)

export const IconCamera = ({ size = 16 }: Props): ReactNode =>
  base(size, <><path d="M3 8.5a2 2 0 0 1 2-2h2l1.5-2.2h7L17 6.5h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><circle cx="12" cy="12.5" r="3.6" /></>)

export const IconCopy = ({ size = 14 }: Props): ReactNode =>
  base(size, <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" /></>)

export const IconMinimize = ({ size = 11 }: Props): ReactNode => (
  <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
    <path d="M1 6h10" stroke="currentColor" strokeWidth="1.2" />
  </svg>
)

export const IconMaximize = ({ size = 11 }: Props): ReactNode => (
  <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
    <rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.2" />
  </svg>
)

export const IconClose = ({ size = 11 }: Props): ReactNode => (
  <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
    <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" strokeWidth="1.2" />
  </svg>
)

export const IconEye = ({ size = 14 }: Props): ReactNode =>
  base(size, <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>)

export const IconCursor = ({ size = 18 }: Props): ReactNode =>
  base(size, <path d="M5 3.5 18.5 10l-6 1.8-2.6 6.2z" />)

export const IconText = ({ size = 18 }: Props): ReactNode =>
  base(size, <path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6" />)

export const IconRect = ({ size = 18 }: Props): ReactNode =>
  base(size, <rect x="4" y="6" width="16" height="12" rx="1.5" />)

export const IconEllipse = ({ size = 18 }: Props): ReactNode =>
  base(size, <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />)

export const IconPen = ({ size = 18 }: Props): ReactNode =>
  base(size, <><path d="m12 3 6.5 9-3 7.5h-7l-3-7.5z" /><circle cx="12" cy="12" r="1.6" /><path d="M12 3v7.4" /></>)

export const IconLasso = ({ size = 18 }: Props): ReactNode =>
  base(size, <><ellipse cx="12.5" cy="9.5" rx="8" ry="5.5" strokeDasharray="2.6 2.4" /><path d="M7 14c-1.5 1.2-1.8 3.4-.2 4.4 1.3.8 2.6-.3 2.3-1.7" /></>)

export const IconBrush = ({ size = 18 }: Props): ReactNode =>
  base(size, <><path d="M19.5 4.5 11 13" /><path d="M10.5 12.5c-2.2-.4-4 1.2-4 3.4 0 1.5-.8 2.6-2 3.1 3.6 1 7.8-.4 7.6-4.3z" /></>)

export const IconScissors = ({ size = 18 }: Props): ReactNode =>
  base(size, <><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="6.5" cy="17.5" r="2.5" /><path d="M8.6 8 20 18M8.6 16 20 6" /></>)

export const IconSparkle = ({ size = 18 }: Props): ReactNode =>
  base(size, <><path d="M12 3.5 13.8 9.2 19.5 11l-5.7 1.8L12 18.5l-1.8-5.7L4.5 11l5.7-1.8z" /><path d="M18.5 3.5v3M17 5h3" /></>)

export const IconLock = ({ size = 13 }: Props): ReactNode =>
  base(size, <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>)

export const IconWand = ({ size = 16 }: Props): ReactNode =>
  base(size, <><path d="m4 20 11-11M14 4v3M19.5 9.5h-3M17.8 5.7l-2 2M18 13.5v2M10 4.5H8" /></>)

const CLAUDE_RAYS = [10, 8.2, 9.4, 7.6, 9.8, 8.4, 9.2, 7.8, 10, 8, 9.5, 7.7]

export const IconClaude = ({ size = 16 }: Props): ReactNode => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <g stroke="var(--claude)" strokeLinecap="round">
      {CLAUDE_RAYS.map((len, i) => {
        const a = (i / CLAUDE_RAYS.length) * Math.PI * 2 + 0.2
        return (
          <line
            key={i}
            x1={12 + Math.cos(a) * 1.4}
            y1={12 + Math.sin(a) * 1.4}
            x2={12 + Math.cos(a) * len}
            y2={12 + Math.sin(a) * len}
            strokeWidth={i % 2 ? 1.9 : 2.3}
          />
        )
      })}
    </g>
  </svg>
)

export const IconChevron = ({ size = 12 }: Props): ReactNode =>
  base(size, <path d="m6 9 6 6 6-6" />)
