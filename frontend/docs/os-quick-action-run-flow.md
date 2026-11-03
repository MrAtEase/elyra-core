# Elyra OS Quick Action Run Flow

## End-to-end flow

```mermaid
flowchart LR
  UI["Orb / Dashboard Quick Action"] --> KP["KernelProvider.executeQuickAction(action)"]
  KP --> API["POST /api/os/runs/quick-action"]
  API --> AUTH["whoami + workspace scope check"]
  AUTH --> RUN["create/update orchestration_runs (status=executing)"]
  RUN --> EXEC["executeToolCall(workspace_id, run_id, tool_name, args, idempotency_key)"]
  EXEC -->|succeeded| PERSIST["persist tool_calls + artifacts (os_tool_artifacts)"]
  EXEC -->|waiting_for_auth| WAITAUTH["execution.status=waiting_for_auth"]
  EXEC -->|waiting_for_approval| WAITAPPROVAL["execution.status=waiting_for_approval"]
  PERSIST --> RESP["return execution + artifacts[]"]
  WAITAUTH --> RESP
  WAITAPPROVAL --> RESP
  RESP --> KPUPDATE["Kernel updates intent timeline + orb state + artifacts cards"]
  KPUPDATE --> UI2["ElyPanel / Assistant surface shows timeline + artifact cards"]
  WAITAPPROVAL --> CONFIRM["User confirms approval in panel"]
  CONFIRM --> API2["POST /api/os/runs/quick-action (approval_granted=true)"]
  API2 --> EXEC
```

## Integration points

1. UI entrypoints (quick actions)
   - `components/os/shell/OrbArea.tsx`
   - `components/os/shell/DesktopSurface.tsx`
2. Kernel orchestration (client state + timeline)
   - `components/os/kernel/KernelProvider.tsx`
   - New method in context: `executeQuickAction(action)`
3. Client API call
   - `components/os/kernel/aiClient.ts`
   - New method: `executeQuickAction(...)`
4. Backend run endpoint
   - `app/api/os/runs/quick-action/route.ts`
   - Validates workspace scope, ensures run row, calls tool execution service, maps waiting states, returns artifacts.
5. Tool execution runtime
   - `lib/orb-os/tools/execution.ts`
   - Supports approval gate bypass with `approval_granted`.
6. Artifact rendering
   - `components/os/shell/cards/ArtifactResultCard.tsx`
   - `components/os/shell/ElyPanel.tsx`
   - `components/os/shell/DesktopSurface.tsx`
