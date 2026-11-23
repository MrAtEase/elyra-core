/**
 * Personal apps of this Elyra instance (not part of the public product).
 *
 * Elyra can carry private apps next to the product without touching the shell:
 * every place that lists apps (registry, launcher, catalog, routes, window sizes)
 * reads them from here. This public version is intentionally empty.
 */

export type PersonalAppId = never;

export type PersonalAppDef = {
  id: PersonalAppId;
  name: string;
  glyph: string;
  iconName: string;
  description: string;
  hints: string[];
  route: string;
  windowTitle: string;
  window: { width: number; height: number; x: number; y: number };
  dockColor: string;
};

export const PERSONAL_APPS: PersonalAppDef[] = [];

export const PERSONAL_APP_CATEGORY = "Persönlich";

export function isPersonalAppId(value: string): value is PersonalAppId {
  return PERSONAL_APPS.some((app) => app.id === value);
}

export function personalRecord<T>(pick: (app: PersonalAppDef) => T): Record<PersonalAppId, T> {
  return Object.fromEntries(PERSONAL_APPS.map((app) => [app.id, pick(app)])) as Record<PersonalAppId, T>;
}
