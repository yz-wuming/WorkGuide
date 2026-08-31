import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function El({
  children,
  size = 16,
  ...p
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      {children}
    </svg>
  );
}

export const IconPlus = (p: IconProps) => (
  <El {...p}>
    <path d="M12 5v14M5 12h14" />
  </El>
);

export const IconSend = (p: IconProps) => (
  <El {...p}>
    <path d="M12 19V5" />
    <path d="M5 12l7-7 7 7" />
  </El>
);

export const IconStop = (p: IconProps) => (
  <El {...p}>
    <rect x="6" y="6" width="12" height="12" rx="1" />
  </El>
);

export const IconGear = (p: IconProps) => (
  <El {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </El>
);

export const IconChevronDown = (p: IconProps) => (
  <El {...p}>
    <path d="m6 9 6 6 6-6" />
  </El>
);

export const IconChevronRight = (p: IconProps) => (
  <El {...p}>
    <path d="m9 18 6-6-6-6" />
  </El>
);

export const IconClose = (p: IconProps) => (
  <El {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </El>
);

export const IconMoreHorizontal = (p: IconProps) => (
  <El {...p}>
    <circle cx="5" cy="12" r="1.4" fill="currentColor" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    <circle cx="19" cy="12" r="1.4" fill="currentColor" />
  </El>
);

export const IconPen = (p: IconProps) => (
  <El {...p}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </El>
);

export const IconTrash = (p: IconProps) => (
  <El {...p}>
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M10 11v6M14 11v6" />
  </El>
);

export const IconPaperclip = (p: IconProps) => (
  <El {...p}>
    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </El>
);

export const IconMenu = (p: IconProps) => (
  <El {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </El>
);

export const IconCheck = (p: IconProps) => (
  <El {...p}>
    <path d="M20 6 9 17l-5-5" />
  </El>
);

export const IconCopy = (p: IconProps) => (
  <El {...p}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </El>
);

export const IconRefresh = (p: IconProps) => (
  <El {...p}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </El>
);

export const IconChat = (p: IconProps) => (
  <El {...p}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </El>
);

export const IconSparkle = (p: IconProps) => (
  <El {...p}>
    <path d="M12 3l1.9 5.7a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3Z" />
  </El>
);

export const IconSliders = (p: IconProps) => (
  <El {...p}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h7M15 18h5" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="13" cy="18" r="2" />
  </El>
);

/* ---------------- 工具调用类型图标（Agent Timeline） ---------------- */

export const IconTerminal = (p: IconProps) => (
  <El {...p}>
    <path d="m4 17 6-6-6-6" />
    <path d="M12 19h8" />
  </El>
);

export const IconFileText = (p: IconProps) => (
  <El {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M8 13h8M8 17h5" />
  </El>
);

export const IconSearch = (p: IconProps) => (
  <El {...p}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </El>
);

export const IconGitBranch = (p: IconProps) => (
  <El {...p}>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="6" r="3" />
    <path d="M6 9v6M18 9a9 9 0 0 1-9 9" />
  </El>
);

export const IconPenTool = (p: IconProps) => (
  <El {...p}>
    <path d="M12 19l7-7 3 3-7 7-3-3z" />
    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
    <path d="M2 2l7.586 7.586" />
    <circle cx="11" cy="11" r="2" />
  </El>
);

export const IconGlobe = (p: IconProps) => (
  <El {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </El>
);

export const IconWrench = (p: IconProps) => (
  <El {...p}>
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </El>
);