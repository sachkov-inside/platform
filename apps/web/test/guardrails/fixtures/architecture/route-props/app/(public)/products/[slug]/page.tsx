/** Сгенерированного типа ещё нет, когда lint с проверкой типов идёт до `next typegen`. */
export default async function ProductRoute({
  params,
}: PageProps<"/products/[slug]">) {
  const { slug } = await params;
  return <main>{slug}</main>;
}
