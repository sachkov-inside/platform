export function LibraryPage() {
  return (
    <>
      <div className="page-introduction">
        <h1>Библиотека</h1>
        <p className="page-introduction__lead">
          Полный каталог материалов с поиском по тексту и фильтрами по реальному содержанию.
        </p>
      </div>
      <section className="page-placeholder">
        <h2>Поиск появится вместе с материалами</h2>
        <p>
          Здесь нет демонстрационных публикаций: результаты, темы, форматы и серии подключатся к
          канонической коллекции, когда она будет готова.
        </p>
        <p className="page-placeholder__status">Статус раздела: ожидает каталог</p>
      </section>
    </>
  );
}
