"use client";

import {
  IconBed,
  IconFork,
  IconFuel,
  IconPin,
  IconReceipt,
  IconSunset,
  IconTicket,
  IconUmbrella,
  type IconProps,
} from "./Icons";
import type { ExpenseCategory, StopKind } from "@/lib/types";

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
