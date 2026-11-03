"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import {
  SHELL_LAYER_DATA_ATTR,
  SHELL_LAYERS,
} from "./layers";

type IdentityMenuProps = {
  open: boolean;
  userName: string;
  userEmail: string;
  workspaceLabel: string;
  workspaceRoleLabel: string;
  canAccessWorkspaceSettings: boolean;
  canAccessMembers: boolean;
  showPlatformAdmin: boolean;
  onClose: () => void;
  onLogout: () => void;
  activeWorkspaceId?: string;
  onSwitchWorkspace?: (id: string) => void;
};

const QUICK_LINKS = [
  { label: "Profile", href: "/os/settings/profile" },
  { label: "System Settings", href: "/os/settings/system-settings" },
  { label: "Integrations", href: "/os/settings/integrations" },
  { label: "AI Settings", href: "/os/settings/ai" },
  { label: "Billing", href: "/os/settings/billing" },
];
const WORKSPACE_LINKS = [
  { label: "Workspace Settings", href: "/os/settings/workspace-profile" },
  { label: "Members & Roles", href: "/os/settings/members-roles" },
];
const ADMIN_LINKS = [
  { label: "Platform Admin", href: "/os/settings/platform-admin" },
  { label: "System Admin", href: "/os/settings/system-admin" },
];
const HELP_LINK = { label: "Help / Feedback", href: "mailto:help @elyra-core.app" };

export default function IdentityMenu({
  open,
  userName,
  userEmail,
  workspaceLabel,
  workspaceRoleLabel,
  canAccessWorkspaceSettings,
  canAccessMembers,
  showPlatformAdmin,
  onClose,
  onLogout,
}: IdentityMenuProps) {
  return (
    <AnimatePresence>
      {open ? (
        <>
          <div
            className="fixed inset-0 cursor-default bg-black/25"
            style={{ zIndex: SHELL_LAYERS.overlay + 1 }}
            onClick={onClose}
            aria-hidden
            {...{ [SHELL_LAYER_DATA_ATTR]: "identityMenu" }}
          />
          <motion.section
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", damping: 28, stiffness: 360 }}
            className="fixed right-6 top-14 w-[min(320px,calc(100%-32px))] rounded-2xl border border-black/10 bg-white/90 p-4 text-sm text-neutral-900 shadow-2xl backdrop-blur-2xl"
            style={{ zIndex: SHELL_LAYERS.overlay + 2 }}
            role="dialog"
            aria-label="Account menu"
            {...{ [SHELL_LAYER_DATA_ATTR]: "identityMenu" }}
          >
            <div className="mb-3 rounded-2xl border border-black/10 bg-black/[0.03] p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-black/[0.08] text-[12px] font-semibold text-neutral-900/90">
                  {userName[0] ?? userEmail[0] ?? "P"}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-neutral-900">{userName}</p>
                  <p className="text-[11px] text-neutral-900/50">{userEmail}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.2em] text-neutral-900/40">
                <span>{workspaceLabel}</span>
                <span>{workspaceRoleLabel}</span>
              </div>
              <Link
                href="/os/settings/profile"
                onClick={onClose}
                className="mt-3 block rounded-xl border border-black/10 bg-black/[0.04] px-3 py-2 text-[11px] text-neutral-900/60 transition hover:border-black/20 hover:bg-black/[0.08]"
              >
                View Profile
              </Link>
            </div>

            <div className="space-y-2 text-[11px] text-neutral-900/70">
              <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-900/40">
                Quick access
              </p>
              {QUICK_LINKS.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  onClick={onClose}
                  className="block rounded-xl border border-black/10 bg-black/[0.03] px-3 py-2 text-neutral-900/70 transition hover:border-black/20 hover:bg-black/[0.06]"
                >
                  {link.label}
                </Link>
              ))}
            </div>

            {(canAccessWorkspaceSettings || canAccessMembers) && (
              <div className="mt-4 space-y-2 text-[11px] text-neutral-900/70">
                <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-900/40">
                  Workspace
                </p>
                {canAccessWorkspaceSettings ? (
                  <Link
                    href="/os/settings/workspace-profile"
                    onClick={onClose}
                    className="block rounded-xl border border-black/10 bg-black/[0.03] px-3 py-2 text-neutral-900/70 transition hover:border-black/20 hover:bg-black/[0.06]"
                  >
                    Workspace Settings
                  </Link>
                ) : null}
                {canAccessMembers ? (
                  <Link
                    href="/os/settings/members-roles"
                    onClick={onClose}
                    className="block rounded-xl border border-black/10 bg-black/[0.03] px-3 py-2 text-neutral-900/70 transition hover:border-black/20 hover:bg-black/[0.06]"
                  >
                    Members & Roles
                  </Link>
                ) : null}
              </div>
            )}

            {showPlatformAdmin ? (
              <div className="mt-4 space-y-2 text-[11px] text-neutral-900/70">
                <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-900/40">Admin</p>
                {ADMIN_LINKS.map((link) => (
                  <Link
                    key={link.label}
                    href={link.href}
                    onClick={onClose}
                    className="block rounded-xl border border-black/10 bg-black/[0.03] px-3 py-2 text-neutral-900/70 transition hover:border-black/20 hover:bg-black/[0.06]"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            ) : null}

            <div className="mt-4 space-y-2 text-[11px] text-neutral-900/70">
              <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-900/40">Support</p>
              <Link
                href={HELP_LINK.href}
                onClick={onClose}
                className="block rounded-xl border border-black/10 bg-black/[0.03] px-3 py-2 text-neutral-900/70 transition hover:border-black/20 hover:bg-black/[0.06]"
              >
                {HELP_LINK.label}
              </Link>
            </div>

            <div className="mt-4 border-t border-black/5 pt-3 text-[11px]">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onLogout();
                }}
                className="w-full rounded-xl border border-black/10 bg-black/[0.04] px-3 py-2 text-left text-neutral-900/70 transition hover:border-black/20 hover:bg-black/[0.06]"
              >
                Logout
              </button>
            </div>
          </motion.section>
        </>
      ) : null}
    </AnimatePresence>
  );
}
