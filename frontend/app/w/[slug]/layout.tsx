import { Suspense } from "react";
import VisionWorkspaceRuntime from "@/components/nav/VisionWorkspaceRuntime";

export default function WorkspaceSlugLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <VisionWorkspaceRuntime>{children}</VisionWorkspaceRuntime>
    </Suspense>
  );
}
