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

/* ---- weather ---- */
export function IconSun({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
    </svg>
  );
}
export function IconPartlySunny({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M8.5 5.5V3.8M3.8 8.5H5.5M4.9 4.9l1.2 1.2M13.4 5.7a4 4 0 0 0-8 .5 4 4 0 0 0 .6 1.9" />
      <path d="M7.5 19.5h9.3a3.2 3.2 0 0 0 .6-6.4 5 5 0 0 0-9.7-1.2 3.6 3.6 0 0 0-.2 7.6Z" />
    </svg>
  );
}
export function IconCloud({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M6.5 18.5h10.3a3.7 3.7 0 0 0 .7-7.3 5.5 5.5 0 0 0-10.7-1.3 4.1 4.1 0 0 0-.3 8.6Z" />
    </svg>
  );
}
export function IconFog({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M6.5 13h10.3a3.7 3.7 0 0 0 .7-7.3A5.5 5.5 0 0 0 7.3 6.5" />
      <path d="M4 16.5h13M7 19.5h10" />
    </svg>
  );
}
export function IconRain({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M6.5 14.5h10.3a3.7 3.7 0 0 0 .7-7.3 5.5 5.5 0 0 0-10.7-1.3 4.1 4.1 0 0 0-.3 8.6Z" />
      <path d="M8.5 17.5 7.5 20M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5" />
    </svg>
  );
}
export function IconSnow({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M6.5 14.5h10.3a3.7 3.7 0 0 0 .7-7.3 5.5 5.5 0 0 0-10.7-1.3 4.1 4.1 0 0 0-.3 8.6Z" />
      <path d="M8 18.2v.01M12 19.8v.01M16 18.2v.01" strokeWidth="2.4" />
    </svg>
  );
}
export function IconStorm({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M6.5 13.5h10.3a3.7 3.7 0 0 0 .7-7.3 5.5 5.5 0 0 0-10.7-1.3 4.1 4.1 0 0 0-.3 8.6Z" />
      <path d="m12.5 13-2 4h3l-2 4" />
    </svg>
  );
}

/* ---- games & map ---- */
export function IconCrown({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="m4 8.5 3.8 3 4.2-5.5 4.2 5.5 3.8-3-1.4 9H5.4L4 8.5Z" />
    </svg>
  );
}
export function IconLayers({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="m12 3.5 8.5 4.6L12 12.7 3.5 8.1 12 3.5Z" />
      <path d="m4.6 12.2 7.4 4 7.4-4M4.6 16.2l7.4 4 7.4-4" />
    </svg>
  );
}
export function IconTimer({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <circle cx="12" cy="13.5" r="7" />
      <path d="M12 10v3.8l2.5 1.5M10 3h4" />
    </svg>
  );
}

export function IconTrash({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M4.5 6.5h15M9.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.5m-8 0 .8 12A2 2 0 0 0 9.3 20.5h5.4a2 2 0 0 0 2-1.9l.8-12.1M10 10.5v6m4-6v6" />
    </svg>
  );
}

export function IconChevronDown({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="m6 9.5 6 6 6-6" />
    </svg>
  );
}

export function IconLink({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <path d="M9.5 14.5 14.5 9.5M8.5 11 6.8 12.7a3.3 3.3 0 0 0 4.7 4.7l1.7-1.7M15.5 13l1.7-1.7a3.3 3.3 0 0 0-4.7-4.7L10.8 8.3" />
    </svg>
  );
}

export function IconSearch({ size = 18, className, strokeWidth = 1.8 }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={strokeWidth}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m15.8 15.8 4.2 4.2" />
    </svg>
  );
}
