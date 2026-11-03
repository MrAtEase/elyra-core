"use client";

import type { ChangeEvent } from "react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useWorkspaceData } from "@/components/workspace/WorkspaceContext";
import { useLocale } from "@/components/providers/LocaleProvider";
import {
  DEFAULT_DARK_THEME_KEY,
  THEME_REGISTRY,
  type ThemeKey,
} from "@/lib/theme";
import { AppLanguage, LANGUAGE_NATIVE_NAMES } from "@/lib/i18n";
import { useT } from "@/lib/i18n/useT";
import StageShell from "@/components/ui/StageShell";
import { cn } from "@/lib/utils";

const NAV_SECTIONS = [
  { id: "general", labelKey: "settings.general" },
  { id: "notifications", labelKey: "settings.notifications" },
  { id: "personalization", labelKey: "settings.personalization" },
  { id: "apps", labelKey: "settings.apps" },
  { id: "schedules", labelKey: "settings.schedules" },
  { id: "dataControls", labelKey: "settings.dataControls" },
  { id: "security", labelKey: "settings.security" },
  { id: "parentalControls", labelKey: "settings.parentalControls" },
  { id: "account", labelKey: "settings.account" },
] as const;

type SectionDefinition = (typeof NAV_SECTIONS)[number];
type SectionId = SectionDefinition["id"];

export default function WorkspaceSettingsPage() {
  const t = useT();
  const { data, setTheme } = useWorkspaceData();
  const { language, setLanguage } = useLocale();
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<SectionId>("general");
  const [isSavingTheme, setIsSavingTheme] = useState(false);
  const [isSavingLanguage, setIsSavingLanguage] = useState(false);

  const resolvedTheme = data?.resolvedTheme ?? DEFAULT_DARK_THEME_KEY;
  const userThemePreference = data?.userSettings?.theme;
  const accentColor = data?.activeWorkspace?.brand?.accentColor ?? "#5cffec";
  const themeOptions = useMemo(
    () => THEME_REGISTRY.filter((theme) => theme.group === "dark"),
    [],
  );

  const languageOptions = useMemo(() => [
    { value: "auto" as AppLanguage, label: t("settings.language_option_auto") },
    ...Object.entries(LANGUAGE_NATIVE_NAMES).map(([value, label]) => ({
      value: value as AppLanguage,
      label,
    })),
  ], [t]);

  const readStringValue = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const rawRole =
    readStringValue(data?.membership?.role) ||
    readStringValue((data as Record<string, unknown> | null)?.role) ||
    readStringValue((data?.user as Record<string, unknown> | undefined)?.role) ||
    readStringValue(
      (data?.permissions as Record<string, unknown> | undefined)?.role ??
        (data?.permissions as Record<string, unknown> | undefined)?.accessLevel
    );
  const normalizedRole = rawRole.toLowerCase();
  const isAdminFlag =
    Boolean((data?.user as Record<string, unknown> | undefined)?.isAdmin) ||
    Boolean((data as Record<string, unknown> | null)?.isAdmin) ||
    Boolean((data?.permissions as Record<string, unknown> | undefined)?.isAdmin);
  const isAdminOrOwner =
    isAdminFlag ||
    normalizedRole === "admin" ||
    normalizedRole === "owner" ||
    normalizedRole === "administrator";
  const hasWorkspace = Boolean(data?.activeWorkspace?.id);

  const handleThemeSelect = async (nextTheme: ThemeKey) => {
    if (isSavingTheme) return;
    setIsSavingTheme(true);
    try {
      await setTheme(nextTheme);
    } finally {
      setIsSavingTheme(false);
    }
  };

  const handleLanguageChange = async (event: ChangeEvent<HTMLSelectElement>) => {
    const nextLanguage = event.target.value as AppLanguage;
    if (nextLanguage === language) return;
    setIsSavingLanguage(true);
    try {
      await setLanguage(nextLanguage);
    } finally {
      setIsSavingLanguage(false);
    }
  };

  const renderGeneralContent = () => (
    <div className="space-y-6">
      <section className="rounded-3xl border border-border/60 bg-background p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-muted-foreground">{t("settings.appearance_title")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("settings.appearance_description")}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {themeOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => handleThemeSelect(option.key)}
              disabled={isSavingTheme}
              className={cn(
                "rounded-2xl border px-4 py-2 text-sm font-semibold transition",
                resolvedTheme === option.key
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/60 text-foreground hover:border-primary"
              )}
            >
              {option.name}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-border/60 bg-background p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-muted-foreground">{t("settings.accent_color_title")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("settings.accent_color_help")}</p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <span
            className="h-10 w-10 rounded-xl border"
            style={{ backgroundColor: accentColor, borderColor: accentColor }}
          />
          <div>
            <p className="font-semibold text-foreground">{accentColor.toUpperCase()}</p>
          </div>
          <button
            type="button"
            className="text-sm font-semibold text-foreground/80 hover:text-foreground"
            onClick={async () => {
              if (!accentColor || typeof navigator === "undefined" || !navigator.clipboard) {
                return;
              }
              try {
                await navigator.clipboard.writeText(accentColor);
              } catch {
                // ignore
              }
            }}
          >
            {t("settings.accent_color_copy")}
          </button>
        </div>
      </section>

      <section className="rounded-3xl border border-border/60 bg-background p-5 shadow-sm">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-muted-foreground">{t("settings.language")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("settings.language_help")}</p>
        </div>
        <div className="mt-4">
          <select
            value={language}
            onChange={handleLanguageChange}
            disabled={isSavingLanguage}
            className="w-full rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/60"
          >
            {languageOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </section>
      {isAdminOrOwner && hasWorkspace && (
        <details className="group rounded-2xl border border-white/10 bg-white/5 p-4 shadow-sm shadow-slate-950/40" open={false}>
          <summary className="flex cursor-pointer items-center justify-between gap-4 text-left">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-muted-foreground">{t("settings.admin_label")}</p>
              <h3 className="text-base font-semibold text-foreground">{t("settings.admin_title")}</h3>
              <p className="text-sm text-muted-foreground">{t("settings.admin_description")}</p>
            </div>
            <span className="text-xl font-semibold text-muted-foreground transition duration-200 group-open:rotate-45">
              +
            </span>
          </summary>
          <div className="mt-4 border-t border-border/40 pt-4 text-sm text-muted-foreground">
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="rounded-2xl border border-border/60 px-4 py-2 text-sm font-semibold text-foreground transition hover:border-primary"
                onClick={() => router.push("/workspace/admin")}
              >
                {t("settings.admin_workspace")}
              </button>
              <button
                type="button"
                className="rounded-2xl border border-border/60 px-4 py-2 text-sm font-semibold text-foreground transition hover:border-primary"
                onClick={() => router.push("/workspace/admin/members")}
              >
                {t("settings.admin_members")}
              </button>
              <button
                type="button"
                className="rounded-2xl border border-border/60 px-4 py-2 text-sm font-semibold text-foreground transition hover:border-primary"
                onClick={() => router.push("/workspace/admin/access")}
              >
                {t("settings.admin_access")}
              </button>
            </div>
          </div>
        </details>
      )}
    </div>
  );

const renderPlaceholder = (section: SectionDefinition) => (
  <section className="rounded-3xl border border-border/60 bg-background p-5 shadow-sm">
    <p className="text-xs uppercase tracking-[0.4em] text-muted-foreground">{t(section.labelKey)}</p>
    <h3 className="mt-2 text-xl font-semibold text-foreground">{t(section.labelKey)}</h3>
    <p className="mt-2 text-sm text-muted-foreground">{t("settings.comingSoon")}</p>
  </section>
);

const activeSectionDefinition =
  NAV_SECTIONS.find((section) => section.id === activeSection) ?? NAV_SECTIONS[0];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
      <StageShell className="grid gap-6 lg:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]">
        <nav className="settings-stage__nav" aria-label={t("settings.title")}>
          <div className="settings-stage__navList">
            {NAV_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSection(section.id)}
                aria-current={section.id === activeSection ? "page" : undefined}
                className={cn(
                  "settings-stage__navItem",
                  section.id === activeSection
                    ? "settings-stage__navItem--active"
                    : "settings-stage__navItem--inactive"
                )}
              >
                {t(section.labelKey)}
              </button>
            ))}
          </div>
        </nav>
        <div className="space-y-6">
          {activeSection === "general" ? renderGeneralContent() : renderPlaceholder(activeSectionDefinition)}
        </div>
      </StageShell>
    </div>
  );
}
