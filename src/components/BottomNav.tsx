"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/map", label: "Map", icon: MapIcon },
  { href: "/days", label: "Days", icon: DaysIcon },
  { href: "/budget", label: "Budget", icon: BudgetIcon },
  { href: "/packing", label: "Packing", icon: PackIcon },
  { href: "/more", label: "More", icon: MoreIcon },
];

export default function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-[max(env(safe-area-inset-bottom),10px)] z-40 px-4">
      <div className="glass-strong pointer-events-auto mx-auto flex max-w-md items-stretch justify-around rounded-2xl p-1.5">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`pressable flex min-h-[50px] min-w-[56px] flex-1 flex-col items-center justify-center gap-0.5 rounded-xl transition-colors duration-200 ${
                active ? "bg-accent-soft" : ""
              }`}
            >
              <Icon active={active} />
              <span
                className={`text-[9.5px] font-semibold tracking-wide ${
                  active ? "text-accent" : "text-fg-faint"
                }`}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function stroke(active: boolean) {
  return {
    stroke: active ? "var(--accent)" : "var(--fg-faint)",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };
}

function MapIcon({ active }: { active: boolean }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24">
      <path {...stroke(active)} d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14" />
    </svg>
  );
}
function DaysIcon({ active }: { active: boolean }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24">
      <rect {...stroke(active)} x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path {...stroke(active)} d="M3.5 9.5h17M8 3v3.5M16 3v3.5" />
    </svg>
  );
}
function BudgetIcon({ active }: { active: boolean }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24">
      <path
        {...stroke(active)}
        d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-9Z"
      />
      <path {...stroke(active)} d="M15 12.5h5v3h-5a1.5 1.5 0 0 1 0-3Z" />
    </svg>
  );
}
function PackIcon({ active }: { active: boolean }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24">
      <rect {...stroke(active)} x="4.5" y="7" width="15" height="13" rx="3" />
      <path {...stroke(active)} d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7m-6.5 5 2 2 4-4" />
    </svg>
  );
}
function MoreIcon({ active }: { active: boolean }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24">
      <circle {...stroke(active)} cx="5.5" cy="12" r="1.4" />
      <circle {...stroke(active)} cx="12" cy="12" r="1.4" />
      <circle {...stroke(active)} cx="18.5" cy="12" r="1.4" />
    </svg>
  );
}
