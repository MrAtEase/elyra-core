"use client";

import { AuthProvider } from "@/components/providers/AuthProvider";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceContext";
import { ElliProvider } from "@/components/providers/ElliProvider";
import { LocaleProvider } from "@/components/providers/LocaleProvider";
import WorkspaceRouteSync from "@/components/workspace/WorkspaceRouteSync";

export default function VisionWorkspaceRuntime({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <WorkspaceProvider>
        <ElliProvider>
          <LocaleProvider>
            <WorkspaceRouteSync />
            {children}
          </LocaleProvider>
        </ElliProvider>
      </WorkspaceProvider>
    </AuthProvider>
  );
}
