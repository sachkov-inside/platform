/**
 * Какой продукт продаёт закрытый материал, открытый без пути руководства. Закрытое живёт внутри
 * продуктов, поэтому призыв ведёт к продукту, в который материал входит. Если продаются два
 * продукта с этим материалом, выбор был бы наугад: призыва к продукту нет, как и без продаваемого.
 */
export function soleSoldGuide(
  guides: readonly { readonly slug: string; readonly sold: boolean }[],
): string | undefined {
  const sold = guides.filter((guide) => guide.sold);
  return sold.length === 1 ? sold[0]?.slug : undefined;
}
