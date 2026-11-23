import type { ComponentType, ReactElement } from "react";
import type { PersonalAppId } from "@/lib/personal/personalApps";

/** Windows and icons of the personal apps. This public version is intentionally empty. */

type IconComponent = ComponentType<{ size?: number; className?: string }>;

export const PERSONAL_ICONS: Record<PersonalAppId, IconComponent> = {} as Record<PersonalAppId, IconComponent>;

export const PERSONAL_ICONS_BY_NAME: Record<string, IconComponent> = {};

export function renderPersonalApp(appId: PersonalAppId): ReactElement {
  void appId;
  return <></>;
}
