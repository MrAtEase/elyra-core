"use client";

import { useState } from "react";

type FileEntry = {
  id: string;
  name: string;
  type: "folder" | "file";
  size?: string;
  modified: string;
};

const ROOT_FILES: FileEntry[] = [
  { id: "f1", name: "Documents", type: "folder", modified: "Feb 14" },
  { id: "f2", name: "Projects", type: "folder", modified: "Feb 13" },
  { id: "f3", name: "Shared", type: "folder", modified: "Feb 10" },
  { id: "f4", name: "Archive", type: "folder", modified: "Jan 28" },
  { id: "f5", name: "Q3-Strategy-Deck.pdf", type: "file", size: "2.4 MB", modified: "Feb 14" },
  { id: "f6", name: "Brand-Guidelines-v3.pdf", type: "file", size: "8.1 MB", modified: "Feb 12" },
  { id: "f7", name: "Meeting-Notes-Feb.md", type: "file", size: "12 KB", modified: "Feb 11" },
  { id: "f8", name: "Invoice-1094.pdf", type: "file", size: "340 KB", modified: "Feb 10" },
];

const FOLDER_FILES: Record<string, FileEntry[]> = {
  f1: [
    { id: "d1", name: "Contracts", type: "folder", modified: "Feb 12" },
    { id: "d2", name: "Proposals", type: "folder", modified: "Feb 8" },
    { id: "d3", name: "Team-Charter.md", type: "file", size: "8 KB", modified: "Feb 10" },
    { id: "d4", name: "Onboarding-Guide.pdf", type: "file", size: "1.2 MB", modified: "Jan 30" },
  ],
  f2: [
    { id: "p1", name: "elyra-core", type: "folder", modified: "Feb 14" },
    { id: "p2", name: "meridian-integration", type: "folder", modified: "Feb 11" },
    { id: "p3", name: "design-system", type: "folder", modified: "Feb 9" },
  ],
  f3: [
    { id: "s1", name: "Shared-Board-Deck.pdf", type: "file", size: "4.8 MB", modified: "Feb 10" },
    { id: "s2", name: "Team-Photos", type: "folder", modified: "Feb 5" },
  ],
  f4: [
    { id: "a1", name: "2025-Reports", type: "folder", modified: "Jan 15" },
    { id: "a2", name: "Old-Contracts", type: "folder", modified: "Dec 20" },
  ],
};

export default function FilesApp() {
  const [path, setPath] = useState<Array<{ id: string; name: string }>>([]);
  const currentFolderId = path.length > 0 ? path[path.length - 1]!.id : null;
  const files = currentFolderId ? (FOLDER_FILES[currentFolderId] ?? []) : ROOT_FILES;

  const openFolder = (entry: FileEntry) => {
    if (entry.type !== "folder") return;
    setPath((prev) => [...prev, { id: entry.id, name: entry.name }]);
  };

  const goToRoot = () => setPath([]);
  const goToIndex = (index: number) => setPath((prev) => prev.slice(0, index + 1));

  return (
    <div className="h-full overflow-auto text-white">
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-1 text-xs">
          <button type="button" onClick={goToRoot} className="text-white/50 hover:text-white/80">
            Home
          </button>
          {path.map((segment, i) => (
            <span key={segment.id} className="flex items-center gap-1">
              <span className="text-white/25">/</span>
              <button
                type="button"
                onClick={() => goToIndex(i)}
                className={i === path.length - 1 ? "text-white/80" : "text-white/50 hover:text-white/80"}
              >
                {segment.name}
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="p-4">
        {files.length === 0 ? (
          <p className="text-sm text-white/40">Empty folder</p>
        ) : (
          <div className="grid gap-0.5">
            {files.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => openFolder(entry)}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-white/[0.04]"
              >
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-semibold ${
                  entry.type === "folder"
                    ? "bg-blue-400/15 text-blue-300"
                    : "bg-white/[0.06] text-white/50"
                }`}>
                  {entry.type === "folder" ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-[13px]">{entry.name}</p>
                  <p className="text-[11px] text-white/35">
                    {entry.modified}
                    {entry.size ? ` \u00b7 ${entry.size}` : ""}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
