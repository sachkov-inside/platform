const processes = [
  ["Web", "Next.js App Router"],
  ["API", "NestJS with Fastify and OpenAPI"],
  ["Worker", "NestJS application process"],
  ["MCP", "NestJS application process"],
] as const;

export default function HomePage() {
  return (
    <main>
      <p className="eyebrow">Inside Platform</p>
      <h1>Основа приложения готова</h1>
      <p className="summary">
        Автономный skeleton разделяет process entrypoints и оставляет продуктовые
        возможности следующим вертикальным срезам.
      </p>

      <section aria-labelledby="processes-heading">
        <h2 id="processes-heading">Process seams</h2>
        <dl>
          {processes.map(([name, implementation]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{implementation}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
