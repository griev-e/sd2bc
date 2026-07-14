"use client";

import {
  IconBed,
  IconCloud,
  IconFog,
  IconFork,
  IconFuel,
  IconPartlySunny,
  IconPin,
  IconRain,
  IconReceipt,
  IconSnow,
  IconStorm,
  IconSun,
  IconSunset,
  IconTicket,
  IconUmbrella,
  type IconProps,
} from "./Icons";
import type { ExpenseCategory, StopKind } from "@/lib/types";
import type { WeatherKind } from "@/lib/weather";

export function StopKindIcon({ kind, ...props }: { kind: StopKind } & IconProps) {
  switch (kind) {
    case "scenic":
      return <IconSunset {...props} />;
    case "food":
      return <IconFork {...props} />;
    case "fuel":
      return <IconFuel {...props} />;
    case "activity":
      return <IconTicket {...props} />;
    case "beach":
      return <IconUmbrella {...props} />;
    case "lodging":
      return <IconBed {...props} />;
    default:
      return <IconPin {...props} />;
  }
}

export function ExpenseCategoryIcon({
  category,
  ...props
}: { category: ExpenseCategory } & IconProps) {
  switch (category) {
    case "gas":
      return <IconFuel {...props} />;
    case "lodging":
      return <IconBed {...props} />;
    case "food":
      return <IconFork {...props} />;
    case "activities":
      return <IconTicket {...props} />;
    default:
      return <IconReceipt {...props} />;
  }
}

export function WeatherIcon({ kind, ...props }: { kind: WeatherKind } & IconProps) {
  switch (kind) {
    case "sun":
      return <IconSun {...props} />;
    case "partly":
      return <IconPartlySunny {...props} />;
    case "fog":
      return <IconFog {...props} />;
    case "drizzle":
    case "rain":
      return <IconRain {...props} />;
    case "snow":
      return <IconSnow {...props} />;
    case "storm":
      return <IconStorm {...props} />;
    default:
      return <IconCloud {...props} />;
  }
}
