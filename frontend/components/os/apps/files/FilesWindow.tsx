"use client";

import { useMemo, useState } from "react";
import {
  File,
  FileText,
  FileSpreadsheet,
  FileImage,
  Folder,
  FolderOpen,
  Grid3X3,
  List,
  ChevronRight,
  Search,
  Upload,
  Plus,
  Star,
  Clock,
  HardDrive,
  Share2,
  Trash2,
  Download,
  Eye,
  MoreHorizontal,
  Cloud,
  RefreshCw,
} from "lucide-react";
import { useKernel } from "@/components/os/kernel/KernelProvider";

// ── Drive Config (workspace-bound) ────────────────────────────────────────────

type DriveConfig = {
  label: string;
  provider: "icloud" | "google" | "elyra";
  color: string;
  used: number; // GB used
  total: number; // GB total
  folders: string[];
};

const DRIVE_CONFIGS: Record<string, DriveConfig> = {
  "ws-personal": {
    label: "iCloud Drive",
    provider: "icloud",
    color: "#3b82f6",
    used: 6.1,
    total: 50,
    folders: ["Documents", "Desktop", "Photos", "Downloads"],
  },
  "ws-fish-delish": {
    label: "Google Drive",
    provider: "google",
    color: "#34a853",
    used: 12.4,
    total: 100,
    folders: ["Shared drives", "My Drive", "Starred", "Shared with me"],
  },
  "ws-elyra-core": {
    label: "Elyra Google Workspace",
    provider: "elyra",
    color: "#6C9CFC",
    used: 48.7,
    total: 500,
    folders: ["Team Drives", "Shared drives", "My Drive", "Archived"],
  },
};

function getDriveConfig(workspaceId: string): DriveConfig {
  return DRIVE_CONFIGS[workspaceId] ?? DRIVE_CONFIGS["ws-personal"]!;
}

function DriveIcon({ provider, size = 14 }: { provider: DriveConfig["provider"]; size?: number }) {
  if (provider === "icloud") {
    // iCloud cloud icon
    return <Cloud size={size} style={{ color: "#3b82f6" }} />;
  }
  if (provider === "google" || provider === "elyra") {
    // Google Drive triangle icon (SVG inline)
    return (
      <svg width={size} height={size} viewBox="0 0 87.3 78" fill="none">
        <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H13.65c-1.4 0-2.7.4-3.85 1l-3.2 13z" fill="#0066da" />
        <path d="M43.65 25L29.9 1.2C28.55 2 27.4 3.1 26.6 4.5L4.65 42.5c-.8 1.4-1.25 2.95-1.3 4.5H31.6L43.65 25z" fill="#00ac47" />
        <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.25-2.95 1.25-4.5H59.7l5.85 11.2 7.9 12.6z" fill="#ea4335" />
        <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2L43.65 25z" fill="#00832d" />
        <path d="M59.7 53H27.35L13.6 76.8c1.35.8 2.9 1.2 4.5 1.2h50.2c1.6 0 3.15-.45 4.5-1.2L59.7 53z" fill="#2684fc" />
        <path d="M73.4 26.5l-11.5-19.95c-.8-1.4-1.95-2.5-3.3-3.3L44.85 25.5 59.7 53h27.35c0-1.6-.45-3.1-1.25-4.5L73.4 26.5z" fill="#ffba00" />
      </svg>
    );
  }
  return <HardDrive size={size} />;
}

// ── File types ────────────────────────────────────────────────────────────────

type FileItem = {
  id: string;
  name: string;
  kind: "folder" | "file";
  ext?: string;
  location: string;
  size?: string;
  updated: string;
  updatedTs: number;
  starred?: boolean;
  shared?: boolean;
};

type ViewMode = "grid" | "list";
type SidebarSection = "recent" | "all" | "starred" | "shared" | "trash";

const ITEMS: FileItem[] = [
  { id: "f1", name: "Workspace", kind: "folder", location: "/", updated: "Today", updatedTs: Date.now() - 60000 },
  { id: "f2", name: "Launch", kind: "folder", location: "/Workspace", updated: "Today", updatedTs: Date.now() - 120000, starred: true },
  { id: "f3", name: "Design", kind: "folder", location: "/Workspace", updated: "Yesterday", updatedTs: Date.now() - 86400000 },
  { id: "f4", name: "Engineering", kind: "folder", location: "/Workspace", updated: "Mon", updatedTs: Date.now() - 172800000 },
  { id: "f5", name: "Q2-Strategy.docx", kind: "file", ext: "docx", location: "/Workspace/Launch", size: "248 KB", updated: "Yesterday", updatedTs: Date.now() - 90000000, shared: true },
  { id: "f6", name: "Pricing-Model.xlsx", kind: "file", ext: "xlsx", location: "/Workspace/Launch", size: "1.2 MB", updated: "Mon", updatedTs: Date.now() - 172800000, starred: true },
  { id: "f7", name: "Onboarding-Notes.md", kind: "file", ext: "md", location: "/Workspace", size: "14 KB", updated: "Sun", updatedTs: Date.now() - 259200000 },
  { id: "f8", name: "Brand-Assets.png", kind: "file", ext: "png", location: "/Workspace/Design", size: "3.8 MB", updated: "Fri", updatedTs: Date.now() - 432000000, starred: true },
  { id: "f9", name: "Architecture-Diagram.pdf", kind: "file", ext: "pdf", location: "/Workspace/Engineering", size: "780 KB", updated: "Thu", updatedTs: Date.now() - 518400000 },
  { id: "f10", name: "API-Spec.md", kind: "file", ext: "md", location: "/Workspace/Engineering", size: "42 KB", updated: "Wed", updatedTs: Date.now() - 604800000, shared: true },
];

const SIDEBAR_ITEMS: { id: SidebarSection; label: string; icon: React.ElementType; count?: number }[] = [
  { id: "recent", label: "Recent", icon: Clock, count: 5 },
  { id: "all", label: "All Files", icon: HardDrive },
  { id: "starred", label: "Starred", icon: Star, count: 3 },
  { id: "shared", label: "Shared", icon: Share2, count: 2 },
  { id: "trash", label: "Trash", icon: Trash2 },
];

function fileIcon(item: FileItem): React.ElementType {
  if (item.kind === "folder") return Folder;
  const ext = (item.ext ?? "").toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return FileImage;
  if (["xlsx", "csv"].includes(ext)) return FileSpreadsheet;
  if (["docx", "doc", "md", "txt", "pdf"].includes(ext)) return FileText;
  return File;
}

function fileIconColor(item: FileItem): string {
  if (item.kind === "folder") return "text-amber-400";
  const ext = (item.ext ?? "").toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "text-emerald-400";
  if (["xlsx", "csv"].includes(ext)) return "text-green-400";
  if (["docx", "doc"].includes(ext)) return "text-blue-400";
  if (["pdf"].includes(ext)) return "text-red-400";
  if (["md", "txt"].includes(ext)) return "text-violet-400";
  return "text-[color:var(--text-tertiary)]";
}

function getFilteredItems(section: SidebarSection): FileItem[] {
  switch (section) {
    case "recent":
      return [...ITEMS].sort((a, b) => b.updatedTs - a.updatedTs).slice(0, 5);
    case "starred":
      return ITEMS.filter((i) => i.starred);
    case "shared":
      return ITEMS.filter((i) => i.shared);
    case "trash":
      return [];
    default:
      return ITEMS;
  }
}

function breadcrumbParts(location: string): string[] {
  return location.split("/").filter(Boolean);
}

export default function FilesWindow() {
  const { activeWorkspace } = useKernel();
  const drive = useMemo(() => getDriveConfig(activeWorkspace.id), [activeWorkspace.id]);
  const [activeSection, setActiveSection] = useState<SidebarSection>("all");
  const [selectedId, setSelectedId] = useState<string | null>(ITEMS[4]!.id);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [query, setQuery] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const filteredItems = useMemo(() => {
    const base = getFilteredItems(activeSection);
    if (!query.trim()) return base;
    const q = query.toLowerCase();
    return base.filter((i) => i.name.toLowerCase().includes(q) || i.location.toLowerCase().includes(q));
  }, [activeSection, query]);

  const selected = useMemo(() => ITEMS.find((i) => i.id === selectedId) ?? null, [selectedId]);

  const ItemIcon = selected ? fileIcon(selected) : File;
  const sectionTitle = SIDEBAR_ITEMS.find((s) => s.id === activeSection)?.label ?? "Files";

  return (
    <div className="flex h-full overflow-hidden" style={{ fontFamily: "inherit" }}>
      {/* ─── Sidebar ─── */}
      <aside
        className="flex w-52 shrink-0 flex-col border-r"
        style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-surface)" }}
      >
        {/* Header — Drive Info */}
        <div className="border-b px-4 py-3" style={{ borderColor: "var(--os-border-faint)" }}>
          <div className="flex items-center gap-2 mb-1">
            <DriveIcon provider={drive.provider} size={14} />
            <span className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>
              {drive.label}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
            <span className="rounded-full h-1.5 w-1.5 bg-emerald-400" />
            <span>Connected</span>
            <button type="button" className="ml-auto rounded p-0.5 transition hover:bg-white/8">
              <RefreshCw size={9} style={{ color: "var(--text-tertiary)" }} />
            </button>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {SIDEBAR_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => { setActiveSection(item.id); setSelectedId(null); }}
                className="group flex w-full items-center gap-2.5 rounded-lg mx-2 px-3 py-2 text-left transition-all"
                style={{
                  width: "calc(100% - 16px)",
                  background: active ? "var(--os-accent-faint, rgba(108,156,252,0.12))" : "transparent",
                  color: active ? "var(--os-accent)" : "var(--text-secondary)",
                }}
              >
                <Icon size={14} className="shrink-0" />
                <span className="flex-1 text-sm">{item.label}</span>
                {item.count != null && (
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[10px] tabular-nums"
                    style={{ background: "var(--bg-elevated)", color: "var(--text-tertiary)" }}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}

          <div className="mx-4 my-3 border-t" style={{ borderColor: "var(--os-border-faint)" }} />
          <div className="px-4 pb-1">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
              {drive.label}
            </p>
          </div>
          {drive.folders.map((folderName) => (
            <button
              key={folderName}
              type="button"
              onClick={() => { setActiveSection("all"); }}
              className="flex w-full items-center gap-2.5 rounded-lg mx-2 px-3 py-1.5 text-left transition-all"
              style={{
                width: "calc(100% - 16px)",
                color: "var(--text-secondary)",
              }}
            >
              <Folder size={13} className="shrink-0 text-amber-400" />
              <span className="text-xs truncate">{folderName}</span>
            </button>
          ))}
        </nav>

        {/* Storage bar */}
        <div className="border-t p-4" style={{ borderColor: "var(--os-border-faint)" }}>
          <div className="mb-1.5 flex justify-between text-[10px]" style={{ color: "var(--text-tertiary)" }}>
            <span>Storage</span>
            <span>{drive.used} GB / {drive.total} GB</span>
          </div>
          <div className="h-1 w-full rounded-full overflow-hidden" style={{ background: "var(--bg-elevated)" }}>
            <div className="h-full rounded-full" style={{ width: `${Math.round((drive.used / drive.total) * 100)}%`, background: drive.color }} />
          </div>
          <p className="mt-1.5 text-[10px]" style={{ color: "var(--text-tertiary)" }}>
            {(drive.total - drive.used).toFixed(1)} GB free · {drive.label}
          </p>
        </div>
      </aside>

      {/* ─── Main Area ─── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Toolbar */}
        <div
          className="flex items-center gap-3 border-b px-4 py-2.5"
          style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-surface)" }}
        >
          {/* Breadcrumb */}
          <div className="flex items-center gap-1 text-xs" style={{ color: "var(--text-tertiary)" }}>
            <span style={{ color: "var(--text-primary)" }} className="font-medium">
              {sectionTitle}
            </span>
            {activeSection === "all" && selected?.kind === "file" && (
              <>
                {breadcrumbParts(selected.location).map((part, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <ChevronRight size={12} />
                    <span>{part}</span>
                  </span>
                ))}
              </>
            )}
          </div>

          <div className="flex-1" />

          {/* Search */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-tertiary)" }} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search files..."
              className="rounded-lg pl-8 pr-3 py-1.5 text-xs outline-none"
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--os-border-faint)",
                color: "var(--text-primary)",
                width: 180,
              }}
            />
          </div>

          {/* View toggle */}
          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--os-border-faint)" }}>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className="px-2.5 py-1.5 transition"
              style={{
                background: viewMode === "list" ? "var(--os-accent-faint, rgba(108,156,252,0.15))" : "var(--bg-elevated)",
                color: viewMode === "list" ? "var(--os-accent)" : "var(--text-tertiary)",
              }}
            >
              <List size={14} />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className="px-2.5 py-1.5 transition border-l"
              style={{
                borderColor: "var(--os-border-faint)",
                background: viewMode === "grid" ? "var(--os-accent-faint, rgba(108,156,252,0.15))" : "var(--bg-elevated)",
                color: viewMode === "grid" ? "var(--os-accent)" : "var(--text-tertiary)",
              }}
            >
              <Grid3X3 size={14} />
            </button>
          </div>

          {/* Actions */}
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition"
            style={{ background: "var(--os-accent)", color: "#fff" }}
          >
            <Plus size={13} />
            New
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition"
            style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--os-border-faint)" }}
          >
            <Upload size={13} />
            Upload
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* File List / Grid */}
          <div className="flex-1 overflow-y-auto">
            {viewMode === "list" ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b" style={{ borderColor: "var(--os-border-faint)" }}>
                    <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
                      Name
                    </th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
                      Location
                    </th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
                      Size
                    </th>
                    <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
                      Modified
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-12 text-center text-sm" style={{ color: "var(--text-tertiary)" }}>
                        {activeSection === "trash" ? "Trash is empty." : "No files found."}
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((item) => {
                      const Icon = fileIcon(item);
                      const isSelected = selectedId === item.id;
                      const isHovered = hoveredId === item.id;
                      return (
                        <tr
                          key={item.id}
                          onClick={() => setSelectedId(item.id)}
                          onMouseEnter={() => setHoveredId(item.id)}
                          onMouseLeave={() => setHoveredId(null)}
                          className="group cursor-pointer border-b transition-all"
                          style={{
                            borderColor: "var(--os-border-faint)",
                            background: isSelected
                              ? "var(--os-accent-faint, rgba(108,156,252,0.12))"
                              : isHovered
                              ? "var(--bg-elevated)"
                              : "transparent",
                          }}
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2.5">
                              {item.kind === "folder" ? (
                                isSelected ? <FolderOpen size={16} className="shrink-0 text-amber-400" /> : <Folder size={16} className="shrink-0 text-amber-400" />
                              ) : (
                                <Icon size={16} className={`shrink-0 ${fileIconColor(item)}`} />
                              )}
                              <span className="truncate font-medium" style={{ color: "var(--text-primary)", maxWidth: 220 }}>
                                {item.name}
                              </span>
                              {item.starred && <Star size={11} className="shrink-0 text-amber-400" fill="currentColor" />}
                              {item.shared && <Share2 size={11} className="shrink-0" style={{ color: "var(--text-tertiary)" }} />}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-xs truncate" style={{ color: "var(--text-tertiary)", maxWidth: 160 }}>
                            {item.location}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs tabular-nums" style={{ color: "var(--text-tertiary)" }}>
                            {item.size ?? "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs" style={{ color: "var(--text-tertiary)" }}>
                            {item.updated}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            ) : (
              <div className="grid grid-cols-3 gap-3 p-4 sm:grid-cols-4 lg:grid-cols-5">
                {filteredItems.map((item) => {
                  const Icon = fileIcon(item);
                  const isSelected = selectedId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className="flex flex-col items-center gap-2 rounded-xl p-3 text-center transition-all"
                      style={{
                        background: isSelected ? "var(--os-accent-faint, rgba(108,156,252,0.14))" : "var(--bg-elevated)",
                        border: `1px solid ${isSelected ? "var(--os-accent)" : "var(--os-border-faint)"}`,
                      }}
                    >
                      {item.kind === "folder" ? (
                        <Folder size={32} className="text-amber-400" />
                      ) : (
                        <Icon size={32} className={fileIconColor(item)} />
                      )}
                      <span className="w-full truncate text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                        {item.name}
                      </span>
                      <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                        {item.size ?? item.updated}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ─── Preview Pane ─── */}
          <aside
            className="w-64 shrink-0 border-l flex flex-col overflow-y-auto"
            style={{ borderColor: "var(--os-border-faint)", background: "var(--bg-surface)" }}
          >
            {selected ? (
              <>
                {/* File icon header */}
                <div
                  className="flex flex-col items-center gap-3 border-b p-6"
                  style={{ borderColor: "var(--os-border-faint)" }}
                >
                  <div
                    className="flex h-16 w-16 items-center justify-center rounded-2xl"
                    style={{ background: "var(--bg-elevated)", border: "1px solid var(--os-border-soft)" }}
                  >
                    {selected.kind === "folder" ? (
                      <Folder size={32} className="text-amber-400" />
                    ) : (
                      <ItemIcon size={32} className={fileIconColor(selected)} />
                    )}
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                      {selected.name}
                    </p>
                    {selected.ext && (
                      <p className="text-xs uppercase tracking-wide mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                        {selected.ext} File
                      </p>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 border-b p-3" style={{ borderColor: "var(--os-border-faint)" }}>
                  <button
                    type="button"
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition"
                    style={{ background: "var(--os-accent)", color: "#fff" }}
                  >
                    <Eye size={12} />
                    Open
                  </button>
                  <button
                    type="button"
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs transition"
                    style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--os-border-faint)" }}
                  >
                    <Download size={12} />
                    Save
                  </button>
                  <button
                    type="button"
                    className="flex items-center justify-center rounded-lg p-2 text-xs transition"
                    style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--os-border-faint)" }}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </div>

                {/* Metadata */}
                <div className="flex-1 p-4 space-y-4">
                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
                      Details
                    </p>
                    <div className="space-y-2">
                      {[
                        { label: "Type", value: selected.kind === "folder" ? "Folder" : `${(selected.ext ?? "").toUpperCase()} File` },
                        { label: "Path", value: selected.location },
                        ...(selected.size ? [{ label: "Size", value: selected.size }] : []),
                        { label: "Modified", value: selected.updated },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex justify-between gap-2">
                          <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>{label}</span>
                          <span className="text-xs text-right truncate" style={{ color: "var(--text-secondary)", maxWidth: 120 }}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Preview placeholder */}
                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
                      Preview
                    </p>
                    <div
                      className="flex h-32 items-center justify-center rounded-xl"
                      style={{ background: "var(--bg-elevated)", border: "1px solid var(--os-border-faint)" }}
                    >
                      {selected.kind === "folder" ? (
                        <div className="text-center">
                          <Folder size={24} className="mx-auto mb-1 text-amber-400" />
                          <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>Folder contents</p>
                        </div>
                      ) : (
                        <div className="text-center">
                          <ItemIcon size={24} className={`mx-auto mb-1 ${fileIconColor(selected)}`} />
                          <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>Preview not available</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Badges */}
                  <div className="flex gap-2 flex-wrap">
                    {selected.starred && (
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px]"
                        style={{ background: "rgba(251,191,36,0.12)", color: "#f59e0b" }}>
                        <Star size={9} fill="currentColor" /> Starred
                      </span>
                    )}
                    {selected.shared && (
                      <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px]"
                        style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--os-border-faint)" }}>
                        <Share2 size={9} /> Shared
                      </span>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center p-6">
                <div className="text-center">
                  <File size={32} className="mx-auto mb-3" style={{ color: "var(--text-tertiary)", opacity: 0.4 }} />
                  <p className="text-sm" style={{ color: "var(--text-tertiary)" }}>Select a file to preview</p>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
