import { redirect } from "next/navigation";

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; segments: string[] }>;
}) {
  const { segments } = await params;
  const target = segments[0] ? `/os/${segments[0]}` : "/os";
  redirect(target);
}
