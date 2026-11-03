import { redirect } from "next/navigation";

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; appKey: string }>;
}) {
  const { slug } = await params;
  redirect(`/w/${slug}`);
}
