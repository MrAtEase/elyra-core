import type { WindowType } from "@/lib/os/layoutTypes";

export type PaletteCommand = {
  id: string;
  label: string;
  keywords: string[];
  run: () => void;
};

type CommandActions = {
  openWindow: (type: WindowType) => void;
  newRun: () => void;
};

export function createCommandPalette(actions: CommandActions): PaletteCommand[] {
  return [
    {
      id: "open-runs",
      label: "Open Runs",
      keywords: ["runs", "execute", "tasks"],
      run: () => actions.openWindow("runs"),
    },
    {
      id: "open-approvals",
      label: "Open Approvals",
      keywords: ["approvals", "confirmations"],
      run: () => actions.openWindow("approvals"),
    },
    {
      id: "open-files",
      label: "Open Files",
      keywords: ["files", "documents"],
      run: () => actions.openWindow("files"),
    },
    {
      id: "open-admin",
      label: "Open Admin",
      keywords: ["admin", "policy", "audit"],
      run: () => actions.openWindow("admin"),
    },
    {
      id: "open-settings",
      label: "Open Settings",
      keywords: ["settings", "preferences"],
      run: () => actions.openWindow("settings"),
    },
    {
      id: "new-run",
      label: "New Run",
      keywords: ["new", "run", "execute"],
      run: actions.newRun,
    },
  ];
}
