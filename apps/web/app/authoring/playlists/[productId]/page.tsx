import { redirect } from "next/navigation";
export default async function Page({
  params,
}: {
  readonly params: Promise<{ readonly productId: string }>;
}) {
  const { productId } = await params;
  redirect(`/authoring/products/${productId}`);
}
