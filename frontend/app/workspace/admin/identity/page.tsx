"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import SettingsPane from "@/components/merlin/settings/SettingsPane";
import SettingsFormRow from "@/components/merlin/settings/SettingsFormRow";
import SettingsTextField from "@/components/merlin/settings/SettingsTextField";
import SettingsColorField from "@/components/merlin/settings/SettingsColorField";
import SettingsSaveBar from "@/components/merlin/settings/SettingsSaveBar";
import ConnectionsPanel from "@/components/workspace/admin/ConnectionsPanel";
import { getWorkspaceAccess } from "@/components/workspace/admin/access";
import AccessWhyPopover from "@/components/workspace/AccessWhyPopover";
import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";
import { THEME_REGISTRY, type ThemeKey } from "@/lib/theme";
import { getWorkspaceIdentityEndpoint, getWorkspaceThemeDefaultEndpoint } from "@/utils/auth-guard";

const FALLBACK_BRAND = {
  productName: "M.I.R.A. OS",
  assistantName: "M.E.R.L.I.N",
  workspaceLabel: "Workspace",
  logoUrl: null,
  accentColor: null,
  themeMode: "light",
};

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugifyInput(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .trim();
}

export default function WorkspaceIdentityAdminPage() {
  const { data, refresh } = useWorkspaceData();
  const workspace = data?.activeWorkspace;
  const access = getWorkspaceAccess((data as Record<string, any> | null) ?? null);
  const canManageIdentity = access.canManageIdentity;
  const brand = workspace?.brand ?? FALLBACK_BRAND;

  const [name, setName] = useState(workspace?.name ?? "");
  const [brandName, setBrandName] = useState(workspace?.brandNameOverride ?? "");
  const [slug, setSlug] = useState(workspace?.slug ?? "");
  const [label, setLabel] = useState(brand.workspaceLabel ?? "");
  const [primaryColor, setPrimaryColor] = useState(brand.accentColor ?? "");
  const [logo, setLogo] = useState(brand.logoUrl ?? "");
  const [defaultThemeKey, setDefaultThemeKey] = useState<ThemeKey | "">(
    workspace?.defaultThemeKey ?? ""
  );

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [statusError, setStatusError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);
  const [logoUploadSuccess, setLogoUploadSuccess] = useState<string | null>(null);

  useEffect(() => {
    setName(workspace?.name ?? "");
    setBrandName(workspace?.brandNameOverride ?? "");
    setSlug(workspace?.slug ?? "");
    setLabel(workspace?.brand?.workspaceLabel ?? "");
    setPrimaryColor(workspace?.brand?.accentColor ?? "");
    setLogo(workspace?.brand?.logoUrl ?? "");
    setDefaultThemeKey(workspace?.defaultThemeKey ?? "");
  }, [
    workspace?.id,
    workspace?.name,
    workspace?.brandNameOverride,
    workspace?.slug,
    workspace?.brand?.workspaceLabel,
    workspace?.brand?.accentColor,
    workspace?.brand?.logoUrl,
    workspace?.defaultThemeKey,
  ]);

  const initialSnapshot = useMemo(
    () => ({
      name: workspace?.name ?? "",
      brandName: workspace?.brandNameOverride ?? "",
      slug: workspace?.slug ?? "",
      label: workspace?.brand?.workspaceLabel ?? "",
      primaryColor: workspace?.brand?.accentColor ?? "",
      logoUrl: workspace?.brand?.logoUrl ?? "",
      defaultThemeKey: workspace?.defaultThemeKey ?? "",
    }),
    [
      workspace?.id,
      workspace?.name,
      workspace?.brandNameOverride,
      workspace?.slug,
      workspace?.brand?.workspaceLabel,
      workspace?.brand?.accentColor,
      workspace?.brand?.logoUrl,
      workspace?.defaultThemeKey,
    ]
  );

  const identityDirty = Boolean(
    workspace &&
      (name.trim() !== initialSnapshot.name ||
        brandName.trim() !== initialSnapshot.brandName ||
        slug.trim() !== initialSnapshot.slug ||
        label.trim() !== initialSnapshot.label ||
        primaryColor.trim() !== initialSnapshot.primaryColor ||
        logo.trim() !== initialSnapshot.logoUrl)
  );
  const themeDefaultDirty = Boolean(workspace && defaultThemeKey !== initialSnapshot.defaultThemeKey);
  const isDirty = identityDirty || themeDefaultDirty;

  const handleSlugBlur = useCallback(() => {
    if (!slug.trim() && name.trim()) {
      setSlug(slugifyInput(name));
      setFieldErrors((prev) => ({ ...prev, slug: "" }));
      return;
    }
    setSlug(slugifyInput(slug));
    setFieldErrors((prev) => ({ ...prev, slug: "" }));
  }, [name, slug]);

  const handleLogoUpload = useCallback(async () => {
    if (!canManageIdentity) {
      setLogoUploadError("Only workspace admins can upload logos.");
      return;
    }
    if (!workspace?.id) {
      setLogoUploadError("Select a workspace to upload a logo.");
      return;
    }
    const file = uploadInputRef.current?.files?.[0];
    if (!file) {
      setLogoUploadError("Choose an image file to upload.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setLogoUploadError("Upload must be an image file.");
      return;
    }
    setLogoUploadError(null);
    setLogoUploadSuccess(null);
    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append("logo", file, file.name);
      const response = await fetch(`/assistant/workspaces/${workspace.id}/logo/upload`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as Record<string, any> | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Unable to upload this logo.");
      }
      const nextLogoUrl =
        typeof payload.logoUrl === "string" && payload.logoUrl.trim()
          ? payload.logoUrl.trim()
          : `/assistant/workspaces/${workspace.id}/logo`;
      setLogo(nextLogoUrl);
      setLogoUploadSuccess("Logo uploaded.");
      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }
      await refresh();
    } catch (error) {
      setLogoUploadError(
        error instanceof Error ? error.message : "Unable to upload the logo right now."
      );
    } finally {
      setUploadingLogo(false);
    }
  }, [canManageIdentity, refresh, workspace?.id]);

  useEffect(() => {
    if (!successMessage) {
      return;
    }
    const timer = setTimeout(() => {
      setSuccessMessage(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  const handleSave = useCallback(async () => {
    if (!canManageIdentity) {
      setStatusError("Only admins can update workspace identity.");
      return;
    }
    if (!isDirty) {
      return;
    }
    if (!workspace?.id) {
      setStatusError("Select a workspace to update.");
      return;
    }
    setFieldErrors({});
    setStatusError(null);
    setSuccessMessage(null);
    let trimmedName = "";
    let trimmedBrandName = "";
    let trimmedSlug = "";
    let trimmedLabel = "";
    let trimmedColor = "";
    let trimmedLogo = "";
    if (identityDirty) {
      trimmedName = name.trim();
      trimmedBrandName = brandName.trim();
      trimmedSlug = slug.trim().toLowerCase();
      trimmedLabel = label.trim();
      trimmedColor = primaryColor.trim();
      trimmedLogo = logo.trim();

      const errors: Record<string, string> = {};
      if (trimmedName.length < 2) {
        errors.name = "Name must be at least 2 characters.";
      }
      if (trimmedSlug && (!SLUG_PATTERN.test(trimmedSlug) || trimmedSlug.length < 3 || trimmedSlug.length > 40)) {
        errors.slug = "Use lowercase letters, numbers, hyphens (3-40 chars).";
      }
      if (trimmedLabel.length > 60) {
        errors.label = "Label must be 60 characters or fewer.";
      }
      if (trimmedBrandName.length > 60) {
        errors.brandName = "Brand name must be 60 characters or fewer.";
      }
      if (trimmedColor && !/^#[0-9a-fA-F]{6}$/.test(trimmedColor)) {
        errors.primaryColor = "Color must follow #RRGGBB format.";
      }

      if (Object.keys(errors).length) {
        setFieldErrors(errors);
        setStatusError("Fix the highlighted fields to proceed.");
        return;
      }
    }

    setIsSaving(true);
    try {
      if (identityDirty) {
        const response = await fetch(getWorkspaceIdentityEndpoint(workspace.id), {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmedName,
            brandName: trimmedBrandName,
            slug: trimmedSlug,
            label: trimmedLabel,
            primaryColor: trimmedColor,
            logoUrl: trimmedLogo,
          }),
        });
        const payload = (await response.json()) as Record<string, any>;
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || "Unable to update workspace identity.");
        }
      }
      if (themeDefaultDirty) {
        const response = await fetch(getWorkspaceThemeDefaultEndpoint(workspace.id), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ themeKey: defaultThemeKey || null }),
        });
        const payload = (await response.json()) as Record<string, any>;
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || "Unable to update workspace default theme.");
        }
      }
      setSuccessMessage("Workspace settings saved.");
      await refresh();
    } catch (error) {
      setStatusError(
        error instanceof Error ? error.message : "Unable to save workspace identity at the moment."
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    canManageIdentity,
    defaultThemeKey,
    identityDirty,
    isDirty,
    label,
    logo,
    name,
    brandName,
    primaryColor,
    refresh,
    slug,
    themeDefaultDirty,
    workspace?.id,
  ]);

  if (!workspace) {
    return (
      <SettingsPane
        eyebrow="Workspace · Identity"
        title="Identity"
        description="Workspace branding, slug and identity metadata."
        scope="WORKSPACE"
      >
        <div className="settings-placeholder">
          <p>No workspace selected.</p>
        </div>
      </SettingsPane>
    );
  }

  return (
    <SettingsPane
      eyebrow="Workspace · Identity"
      title="Identity"
      description="Workspace branding, slug and identity metadata."
      scope="WORKSPACE"
    >
      {!canManageIdentity ? (
        <div className="settings-form__helper">
          <p className="settings-form__error">Only admins can edit workspace identity settings.</p>
          <AccessWhyPopover requiredCaps={["workspace.identity.manage"]} />
        </div>
      ) : null}
      <p className="settings-identity-note">
        Updates here will surface in the workspace control panel and the agent brand block.
      </p>
      <div className="settings-form">
        <SettingsFormRow label="Workspace Name" helper="The public name for your workspace.">
          <SettingsTextField
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Workspace title"
            spellCheck={false}
            disabled={!canManageIdentity}
            error={fieldErrors.name ?? null}
          />
        </SettingsFormRow>
        <SettingsFormRow
          label="Brand name"
          helper="Optional custom brand name shown in the workspace header."
        >
          <SettingsTextField
            value={brandName}
            onChange={(event) => setBrandName(event.target.value)}
            placeholder="Workspace brand"
            spellCheck={false}
            disabled={!canManageIdentity}
            error={fieldErrors.brandName ?? null}
          />
        </SettingsFormRow>
        <SettingsFormRow
          label="Workspace Slug"
          helper="Lowercase letters, numbers, and hyphens only (3-40 chars)."
        >
          <SettingsTextField
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            onBlur={handleSlugBlur}
            placeholder="workspace-slug"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            id="workspace-slug"
            disabled={!canManageIdentity}
            error={fieldErrors.slug ?? null}
          />
        </SettingsFormRow>
        <SettingsFormRow
          label="Workspace Label"
          helper="Optional subtitle that appears below the agent name."
        >
          <SettingsTextField
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Portugal Workspace"
            spellCheck={false}
            disabled={!canManageIdentity}
            error={fieldErrors.label ?? null}
          />
        </SettingsFormRow>
        <SettingsFormRow
          label="Primary Color"
          helper="Hex color (#RRGGBB) used for the brand accent."
        >
          <SettingsColorField
            id="primary-color"
            value={primaryColor}
            placeholder="#5cffec"
            onChange={(value) => setPrimaryColor(value)}
            disabled={!canManageIdentity}
            error={fieldErrors.primaryColor ?? null}
          />
        </SettingsFormRow>
        <SettingsFormRow
          label="Workspace Default Theme"
          helper="Used when members choose to follow the workspace default."
        >
          <select
            value={defaultThemeKey}
            onChange={(event) => setDefaultThemeKey(event.target.value as ThemeKey | "")}
            disabled={!canManageIdentity}
          >
            <option value="">Automatic (follows workspace mode)</option>
            {THEME_REGISTRY.map((theme) => (
              <option key={theme.key} value={theme.key}>
                {theme.name}
              </option>
            ))}
          </select>
        </SettingsFormRow>
        <SettingsFormRow
          label="Logo"
          helper="Paste a logo URL for now; upload tooling is handled separately."
        >
          <SettingsTextField
            value={logo}
            onChange={(event) => setLogo(event.target.value)}
            placeholder="https://example.com/logo.png"
            spellCheck={false}
            disabled={!canManageIdentity}
          />
        </SettingsFormRow>
        <SettingsFormRow
          label="Upload logo"
          helper="Upload a PNG, JPG, or SVG so the workspace shell can render it from the assistant."
        >
          <div>
            <div className="settings-logo-upload">
              <input
                ref={uploadInputRef}
                type="file"
                accept="image/*"
                className="settings-logo-upload__field"
                disabled={!canManageIdentity || uploadingLogo}
                onChange={() => {
                  setLogoUploadError(null);
                  setLogoUploadSuccess(null);
                }}
              />
              <button
                type="button"
                className="settings-logo-upload__button"
                onClick={handleLogoUpload}
                disabled={!canManageIdentity || uploadingLogo}
              >
                {uploadingLogo ? "Uploading…" : "Upload logo"}
              </button>
            </div>
            {logoUploadError ? (
              <p className="settings-form__error">{logoUploadError}</p>
            ) : logoUploadSuccess ? (
              <p className="settings-form__helper">{logoUploadSuccess}</p>
            ) : null}
          </div>
        </SettingsFormRow>
        <SettingsSaveBar
          onSave={handleSave}
          saving={isSaving}
          success={successMessage}
          error={statusError}
          disabled={!isDirty || !canManageIdentity}
        />
      </div>
      <ConnectionsPanel />
    </SettingsPane>
  );
}
