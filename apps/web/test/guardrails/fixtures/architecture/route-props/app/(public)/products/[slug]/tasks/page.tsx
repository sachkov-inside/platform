/** Свой тип под именем сгенерированного: ровно то, чего правило требует. */
interface PageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

export default async function TasksRoute({ params }: PageProps) {
  const { slug } = await params;
  return <main>{slug}</main>;
}
