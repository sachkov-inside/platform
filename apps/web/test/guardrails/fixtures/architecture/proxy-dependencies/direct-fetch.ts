/** Нарушение в обход транспорта: адрес темы проверяется прямым запросом по сети. */
export async function topicAddressExists(pathname: string): Promise<boolean> {
  return (await fetch(new URL(pathname, "http://backend.internal"))).ok;
}
