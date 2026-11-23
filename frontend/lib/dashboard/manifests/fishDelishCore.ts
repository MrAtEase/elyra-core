import type { DashboardManifest } from "../types";

const fishDelishCore: DashboardManifest = {
  id: "fish-delish-core",
  label: "Fish Delish Core",
  description: "Fish Delish workspace modules and navigation.",
  modules: [
    {
      kind: "focus_queue",
      placement: { area: "primary", order: 5 },
      span: "auto",
    },
    {
      kind: "daily_brief",
      placement: { area: "primary", order: 10 },
      span: "auto",
    },
    {
      kind: "today_timeline",
      placement: { area: "primary", order: 20 },
      span: "auto",
    },
    {
      kind: "blockers",
      placement: { area: "secondary", order: 30 },
      span: "auto",
    },
    {
      kind: "nudges",
      placement: { area: "secondary", order: 40 },
      span: "auto",
    },
  ],
  shell: {
    rail: {
      items: [
        {
          id: "workspace",
          label: "Dashboard",
          labelKey: "nav.dashboard",
          route: "/workspace",
          order: 10,
          icon: "dashboard",
          group: "top",
        },
        {
          id: "work",
          label: "Work",
          route: "/workspace/work/mail",
          order: 20,
          icon: "mail",
          group: "top",
        },
        {
          id: "build",
          label: "Build",
          labelKey: "nav.build",
          route: "/workspace/build/builder",
          order: 30,
          icon: "build",
          group: "top",
          visibleIf: {
            roles: ["owner", "admin", "founder", "builder"],
          },
        },
        {
          id: "settings",
          label: "Settings",
          labelKey: "nav.settings",
          route: "/workspace/settings",
          order: 40,
          icon: "settings",
          group: "bottom",
        },
      ],
    },
  },
};

export default fishDelishCore;
