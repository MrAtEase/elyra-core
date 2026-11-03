import { redirect } from "next/navigation";

export default function AdminWorkspaceRedirectPage() {
  redirect("/workspace/admin/identity");
}
