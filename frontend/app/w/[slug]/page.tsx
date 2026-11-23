import { redirect } from "next/navigation";

export default async function WorkspaceSlugHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await params;
  redirect("/os");
}
