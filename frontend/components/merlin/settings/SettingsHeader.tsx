"use client";

import type { CSSProperties } from "react";

import { BRAND } from "@/components/merlin/brandConfig";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";

const FALLBACK_BRAND = {
  productName: BRAND.productName,
  assistantName: BRAND.agentName,
  workspaceLabel: BRAND.workspaceLabel,
  logoUrl: BRAND.logoSrc ?? null,
  accentColor: null,
  themeMode: "light",
};

function buildInitials(label: string | undefined) {
  if (!label) return "FD";
  return label
    .split(" ")
    .map((segment) => segment.trim())
    .filter((s) => s.length > 0)
    .slice(0, 2)
    .map((segment) => segment.charAt(0).toUpperCase())
    .join("");
}

export default function SettingsHeader() {
  const { data } = useWorkspaceData();
  const workspace = data?.activeWorkspace;
  const brand = workspace?.brand ?? FALLBACK_BRAND;
  const user = data?.user;
  const workspaceLabel = workspace?.name ?? brand.workspaceLabel ?? brand.productName;
  const accentColor = brand.accentColor ?? "#5cffec";
  const accentStyle = {
    "--settings-accent": accentColor,
  } as CSSProperties;

  return (
    <header className="settings-header" style={accentStyle}>
      <div className="settings-header__workspace">
        {brand.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logoUrl} alt={`${workspaceLabel} logo`} className="settings-header__logo" />
        ) : (
          <div className="settings-header__logoPlaceholder">{buildInitials(workspaceLabel)}</div>
        )}
        <div>
          <p className="settings-header__eyebrow">Workspace</p>
          <h1>{workspaceLabel}</h1>
          <p className="settings-header__meta">{workspace?.slug ? `/${workspace.slug}` : brand.productName}</p>
        </div>
      </div>
      <div className="settings-header__right">
        <div className="settings-orbStatus">
          <span className="settings-orbStatus__indicator" aria-hidden="true" />
          <span>Orb status steady</span>
        </div>
        <div className="settings-header__user">
          <p className="settings-header__eyebrow">Signed in as</p>
          <strong>{user?.email || "—"}</strong>
        </div>
      </div>
    </header>
  );
}
