export type Role = string;
export type Permission = string;

export type VisibilityRule = {
  roles?: Role[];
  permissions?: Permission[];
  features?: string[];
};

export type NavItem = {
  id: string;
  label: string;
  labelKey?: string;
  route: string;
  order: number;
  icon?: string;
  group?: string;
  visibleIf?: VisibilityRule;
};

export type DashboardModulePlacement = {
  area: string;
  order: number;
};

export type DashboardModule = {
  kind: string;
  placement: DashboardModulePlacement;
  span?: "auto" | "full" | number;
  config?: Record<string, unknown>;
  visibleIf?: VisibilityRule;
};

export type DashboardManifest = {
  id: string;
  label: string;
  description?: string;
  modules: DashboardModule[];
  shell: {
    rail: {
      items: NavItem[];
    };
  };
};
