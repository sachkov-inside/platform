import { redirect } from "next/navigation";
export default async function Page({
  params,
}: {
  readonly params: Promise<{ readonly seriesId: string }>;
}) {
  const { seriesId } = await params;
  redirect(`/authoring/products/${seriesId}`);
}
