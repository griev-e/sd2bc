"use client";

/*
  Coastline icon system — one consistent 24px / 1.8px-stroke line set.
  No emojis anywhere in the product surface; icons inherit currentColor.
*/

export interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

export function IconPin({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M12 21s-7-5.1-7-11a7 7 0 0 1 14 0c0 5.9-7 11-7 11Z" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  );
}

export function IconSunset({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M4 17h16M7 21h10" />
      <path d="M7.5 13a4.5 4.5 0 1 1 9 0" />
      <path d="M12 4v3M4.5 8.5 6.3 10M19.5 8.5 17.7 10" />
    </svg>
  );
}

export function IconFork({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M7 3v7a2.5 2.5 0 0 0 5 0V3M9.5 3v18" />
      <path d="M17 3c-1.7 1.4-2.5 3.4-2.5 6v3h2.5m0-9v18" />
    </svg>
  );
}

export function IconFuel({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3.5 21h13" />
      <path d="M15 9h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0v-8l-2.5-2.5" />
      <path d="M7.5 7h5v4h-5z" />
    </svg>
  );
}

export function IconTicket({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1.5a2.5 2.5 0 0 0 0 5V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.5a2.5 2.5 0 0 0 0-5V8Z" />
      <path d="M13.5 6v2m0 3v2m0 3v2" strokeDasharray="0.1 3.2" />
    </svg>
  );
}

export function IconWave({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M3 16c2.5-3.5 4.5-3.5 7 0s4.5 3.5 7 0c1-1.4 2-2.1 3-2.1" />
      <path d="M3 9c2.5-3.5 4.5-3.5 7 0s4.5 3.5 7 0c1-1.4 2-2.1 3-2.1" opacity="0.45" />
    </svg>
  );
}

export function IconBed({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M3 18v-8m0 4h18v4m0-4v-2a3 3 0 0 0-3-3h-7v5" />
      <circle cx="7" cy="11" r="1.6" />
      <path d="M3 20v-2m18 2v-2" />
    </svg>
  );
}

export function IconMoon({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />
    </svg>
  );
}

export function IconWallet({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-9Z" />
      <path d="M15 12.5h5v3h-5a1.5 1.5 0 0 1 0-3Z" />
    </svg>
  );
}

export function IconReceipt({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M6 3h12v18l-2-1.4L14 21l-2-1.4L10 21l-2-1.4L6 21V3Z" />
      <path d="M9.5 8h5M9.5 12h5" />
    </svg>
  );
}

export function IconSparkle({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.5l-1.8-5.9L4.5 10.8 10.2 9 12 3.5Z" />
      <path d="M19 16.5l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" strokeWidth={1.4} />
    </svg>
  );
}

export function IconPlus({ size = 18, className, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconX({ size = 14, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M5 5l14 14M19 5 5 19" />
    </svg>
  );
}

export function IconGrip({ size = 16, className, strokeWidth = 1.6 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M5 8h14M5 12h14M5 16h14" />
    </svg>
  );
}

export function IconChevronRight({ size = 16, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

export function IconFrame({ size = 18, className, strokeWidth = 1.7 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M8 3H4.5A1.5 1.5 0 0 0 3 4.5V8m13-5h3.5A1.5 1.5 0 0 1 21 4.5V8m0 8v3.5a1.5 1.5 0 0 1-1.5 1.5H16m-8 0H4.5A1.5 1.5 0 0 1 3 19.5V16" />
    </svg>
  );
}

export function IconCheck({ size = 14, className, strokeWidth = 2.2 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="m4.5 12.5 5 5 10-11" />
    </svg>
  );
}

export function IconUmbrella({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9Z" />
      <path d="M12 12v6.5a2 2 0 0 0 4 0" />
      <path d="M12 3v2" />
    </svg>
  );
}

export function IconCamera({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.4-2.1A2 2 0 0 1 11 4h2a2 2 0 0 1 1.6.9L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9Z" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  );
}

export function IconSignout({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M14 4h-8a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8M10 12h10m0 0-3.5-3.5M20 12l-3.5 3.5" />
    </svg>
  );
}
