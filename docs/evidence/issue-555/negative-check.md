# Что роняет проверку геометрии

Проверка живёт в историях `Loading`, `LoadingMobile`, `NoPin` и `NoPinMobile`
(`apps/web/src/_pages/home/ui/guest-home.stories.tsx`) и идёт в `pnpm test`, то есть в `pnpm check`
и в CI. Ниже — две подделки, которыми она проверена на укус. Обе прогнаны командой

```
pnpm --filter @inside/web exec vitest run --config vitest.config.mts --project=storybook \
  src/_pages/home/ui/guest-home.stories.tsx
```

## Подделка 1: вернуть прежний рукописный заголовок в скелет

`HomeLoading` возвращён к разметке до починки: свой `<h2 className="mt-2 text-lg …">Руководства</h2>`
вне каркаса.

```
 FAIL  src/_pages/home/ui/guest-home.stories.tsx > Loading
 FAIL  src/_pages/home/ui/guest-home.stories.tsx > Loading Mobile
Error: Каркас главной не отрисован
 Tests  2 failed | 12 passed (14)
```

## Подделка 2: оставить каркас, но вынести заголовок из секции руководств

Каркас на месте, секция на месте, но заголовок обёрнут лишним `<div>`, поэтому перестаёт быть
прямым потомком секции и теряет правило `margin-top: 0`.

```
 FAIL  src/_pages/home/ui/guest-home.stories.tsx > Loading
AssertionError: expected 161 to be 113 // Object.is equality
 FAIL  src/_pages/home/ui/guest-home.stories.tsx > Loading Mobile
AssertionError: expected 64 to be 24 // Object.is equality
 Tests  2 failed | 12 passed (14)
```

Первая подделка ловится структурой, вторая — геометрией. Обе возвращают ровно тот класс дефекта,
из-за которого заведена задача.

## Здоровый прогон

```
 Test Files  1 passed (1)
      Tests  14 passed (14)
```
