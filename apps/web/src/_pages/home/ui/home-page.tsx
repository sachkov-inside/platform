export function HomePage() {
  return (
    <>
      <div className="page-introduction">
        <h1>Главная</h1>
        <p className="page-introduction__lead">
          Точка входа в материалы Inside: новые публикации, темы и активные серии.
        </p>
      </div>
      <section className="page-placeholder">
        <h2>Коллекция собирается</h2>
        <p>
          Здесь появятся опубликованные материалы и быстрые пути к продолжению чтения. Пока
          страница честно показывает только готовую основу приложения.
        </p>
        <p className="page-placeholder__status">
          Статус раздела: ожидает опубликованные материалы
        </p>
      </section>
    </>
  );
}
