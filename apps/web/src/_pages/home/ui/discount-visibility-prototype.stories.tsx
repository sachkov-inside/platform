import type { Meta, StoryObj } from "@storybook/react-vite";
import { usePathname } from "next/navigation";
import { mocked } from "storybook/test";
import { currentLegalEdition } from "@inside/legal";
import { storageNoticeKey } from "@/features/storage-notice";
import { ArrowDown, ArrowRight, Minimize2, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { CohortStatusView } from "@/features/ai-engineering-course";
import {
  CohortCallView,
  CourseLearningLink,
} from "@/features/ai-engineering-course";
import {
  createLibraryCatalogQueryOptions,
  type LibraryCatalogPage,
} from "@/features/library-catalog";
import { ThemeSwitch } from "@/features/theme-preference";
import { HeaderAuthControl } from "@/widgets/auth-control";
import type { ProductSalesState } from "@/entities/subscription";
import { cohortCall } from "@/_pages/library-discovery/model/cohort-call";
import { cohortStatus } from "@/_pages/library-discovery/model/cohort-status";
import { ProductLandingView } from "@/_pages/library-discovery/ui/product-landing-view";
import { homeMaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import {
  aiEngineeringCourseChapters,
  aiEngineeringCoursePage,
} from "@/storybook/ai-engineering-course.fixtures";
import { productWithSupportOffer } from "@/storybook/billing.fixtures";
import { illustratedPinnedHome } from "@/storybook/home.fixtures";
import { PublicShellFrame } from "@/storybook/story-environment";

import { HomeFeedView } from "./home-feed.client";
import { HomePage } from "./home-page";
import styles from "./discount-visibility-prototype.module.css";

// Throwaway (owner request 2026-11-23): how a running discount shows on Home and on the course
// page, so a visitor notices it at the top or anywhere on the site. Five structurally different
// variants for the owner to compare. Fixture data and in-memory state only; nothing in production
// imports this file.

/* Данные скидки --------------------------------------------------------- */

const promo = {
  name: "Чёрная пятница",
  percent: "−25 %",
  product: "AI Engineering",
  price: "29 900 ₽",
  oldPrice: "39 900 ₽",
  until: "до 30 ноября",
  // Конец 30 ноября по Москве.
  endsAt: Date.parse("2026-11-30T21:00:00Z"),
  courseHref: "/products/ai-engineering#enroll",
} as const;

function useCountdown(endsAt: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.floor((endsAt - now) / 1000));
  return {
    days: Math.floor(left / 86_400),
    hours: Math.floor((left % 86_400) / 3600),
    minutes: Math.floor((left % 3600) / 60),
    seconds: left % 60,
  };
}
const pad = (value: number) => String(value).padStart(2, "0");

function daysWord(days: number) {
  const tail = days % 10;
  const teen = days % 100 >= 11 && days % 100 <= 14;
  if (tail === 1 && !teen) return "день";
  if (tail >= 2 && tail <= 4 && !teen) return "дня";
  return "дней";
}

function Percent() {
  return <span className={styles["percent"]}>{promo.percent}</span>;
}

function Price() {
  return (
    <span className={styles["offerPrice"]}>
      <span className={styles["offerNow"]}>{promo.price}</span>
      <s className={styles["struck"]}>
        <span className="sr-only">Без скидки: </span>
        {promo.oldPrice}
      </s>
    </span>
  );
}

function Timer() {
  const { days, hours, minutes, seconds } = useCountdown(promo.endsAt);
  const cells = [
    [days, "дн"],
    [hours, "ч"],
    [minutes, "мин"],
    [seconds, "сек"],
  ] as const;
  return (
    <div
      className={styles["timer"]}
      role="timer"
      aria-label={`До конца скидки ${days} ${daysWord(days)} ${hours} ч`}
    >
      {cells.map(([value, unit]) => (
        <span className={styles["timerCell"]} key={unit}>
          <span className={styles["timerValue"]}>{pad(value)}</span>
          <span className={styles["timerUnit"]}>{unit}</span>
        </span>
      ))}
    </div>
  );
}

/* Страницы ----------------------------------------------------------------- */

type PageKind = "home" | "course";

const runningCohort: ProductSalesState = {
  productId: "00000000-0000-4000-8000-000000000814",
  revision: 1,
  name: "Поток 1",
  stage: "running",
  startsOn: "2026-11-09",
  nextEvent: "",
  priceAfterStartKopecks: 3_990_000,
};
const discountedOffer = {
  ...productWithSupportOffer,
  firstPriceKopecks: 2_990_000,
};

/** Билет с ценой внизу страницы курса, как сейчас: он во всех вариантах одинаковый. */
function currentTicket() {
  const status = cohortStatus({
    cohort: runningCohort,
    offer: discountedOffer,
    productAccess: "closed",
    slug: "ai-engineering",
    today: "2026-11-23",
  });
  return status === null ? null : <CohortStatusView status={status} />;
}

/** Первый экран курса, как сейчас: живая метка набора и кнопка оплаты. */
function currentHeroCall() {
  return (
    <CohortCallView
      call={cohortCall({
        cohort: runningCohort,
        offer: discountedOffer,
        productAccess: "closed",
        signedIn: false,
        slug: "ai-engineering",
      })}
    />
  );
}

function CoursePage({
  heroCall = currentHeroCall(),
  heroBadge,
}: {
  readonly heroCall?: ReactNode;
  readonly heroBadge?: ReactNode;
}) {
  return (
    <ProductLandingView
      heroCall={heroCall}
      heroBadge={heroBadge}
      statusCall={currentTicket()}
      returnTarget={homeMaterialReaderReturnTarget}
      result={{
        kind: "empty",
        discoveryKind: "product",
        chapters: aiEngineeringCourseChapters,
        relatedProduct: [],
        topics: [],
        reference: {
          name: "AI Engineering",
          slug: "ai-engineering",
          summary: "",
          productPage: {
            presentation: "ai-engineering-course",
            page: aiEngineeringCoursePage,
          },
        },
      }}
    />
  );
}

const courseHero = aiEngineeringCoursePage.blocks.find(
  (block) => block.kind === "hero",
);
if (courseHero === undefined)
  throw new Error("Описание курса без первого экрана");
const homeWithCourse = {
  ...illustratedPinnedHome,
  pinnedProduct: {
    id: "ai-engineering-course",
    cover: null,
    previewItems: [],
    slug: "ai-engineering",
    name: "AI Engineering",
    summary: null,
    count: 24,
    presentation: "ai-engineering-course" as const,
    card: aiEngineeringCoursePage.card,
    hero: {
      badge: courseHero.badge,
      lead: courseHero.lead,
      highlights: courseHero.highlights,
    },
  },
};
const feedItems = [
  ...illustratedPinnedHome.videos,
  ...illustratedPinnedHome.guides,
];
const feedPage: LibraryCatalogPage = {
  kind: "ready",
  items: feedItems,
  facets: { formats: [], products: [], topics: [] },
  nextCursor: null,
  totalCount: feedItems.length,
};
const feed = (
  <HomeFeedView
    initialQuery={{
      after: null,
      q: "",
      sort: "newest",
      formatSlugs: [],
      topicSlug: null,
    }}
    createQueryOptions={(state) =>
      createLibraryCatalogQueryOptions(() => Promise.resolve(feedPage), state)
    }
  />
);

/** Кнопка карточки курса на Главной, как сейчас. */
const currentHomeCall = (
  <CohortCallView
    call={{
      banner: null,
      action: {
        kind: "programme",
        href: "/products/ai-engineering/programme",
        label: "Посмотреть программу",
      },
    }}
  />
);

function Home({
  courseCall = currentHomeCall,
  top,
}: {
  readonly courseCall?: ReactNode;
  readonly top?: ReactNode;
}) {
  return (
    <>
      {top}
      <HomePage
        result={{ kind: "ready", value: homeWithCourse }}
        feed={feed}
        courseCall={courseCall}
      />
    </>
  );
}

function Shell({
  page,
  accountSlot,
  children,
}: {
  readonly page: PageKind;
  readonly accountSlot?: ReactNode;
  readonly children: ReactNode;
}) {
  const path = page === "home" ? "/" : "/products/ai-engineering";
  return accountSlot === undefined ? (
    <PublicShellFrame currentPath={path}>{children}</PublicShellFrame>
  ) : (
    <PublicShellFrame currentPath={path} accountSlot={accountSlot}>
      {children}
    </PublicShellFrame>
  );
}

/* A. Полоса над сайтом -------------------------------------------------- */

function TopStrip({ page }: { readonly page: PageKind }) {
  const [open, setOpen] = useState(true);
  const { days, hours, minutes } = useCountdown(promo.endsAt);
  if (!open) return null;
  return (
    <div className={styles["strip"]} role="region" aria-label="Скидка">
      <Percent />
      <p className={styles["stripText"]}>
        <strong>
          {promo.name}: {promo.product} за {promo.price}
        </strong>
        <span className={`${styles["stripMuted"]} ${styles["stripWide"]}`}>
          вместо {promo.oldPrice} · до конца
        </span>
        <span className={`${styles["digits"]} ${styles["stripMuted"]}`}>
          {days} д {pad(hours)}:{pad(minutes)}
        </span>
      </p>
      <a
        className={styles["stripLink"]}
        href={page === "course" ? "#enroll" : promo.courseHref}
      >
        <span className={styles["stripWide"]}>
          {page === "course" ? "К цене" : "Смотреть курс"}
        </span>
        {page === "course" ? (
          <ArrowDown aria-hidden="true" />
        ) : (
          <ArrowRight aria-hidden="true" />
        )}
      </a>
      <button
        className={styles["stripClose"]}
        type="button"
        aria-label="Скрыть"
        onClick={() => setOpen(false)}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  );
}

function VariantA({ page }: { readonly page: PageKind }) {
  return (
    <div className={styles["withStrip"]}>
      <TopStrip page={page} />
      <Shell page={page}>{page === "home" ? <Home /> : <CoursePage />}</Shell>
    </div>
  );
}

/* B. Скидка внутри предложения ----------------------------------------- */

function InlineOffer({ action }: { readonly action: ReactNode }) {
  return (
    <div className={styles["offer"]}>
      <span className={styles["offerTag"]}>
        <Percent />
        {promo.name} · {promo.until}
      </span>
      <Price />
      {action}
    </div>
  );
}

function VariantB({ page }: { readonly page: PageKind }) {
  return (
    <Shell page={page}>
      {page === "home" ? (
        <Home
          courseCall={
            <InlineOffer
              action={
                <a className={styles["offerAction"]} href={promo.courseHref}>
                  Смотреть курс
                  <ArrowRight aria-hidden="true" />
                </a>
              }
            />
          }
        />
      ) : (
        <CoursePage
          heroCall={
            <div className={styles["courseSlot"]}>
              <InlineOffer
                action={
                  <a className={styles["offerAction"]} href="#enroll">
                    Купить со скидкой
                    <ArrowDown aria-hidden="true" />
                  </a>
                }
              />
            </div>
          }
          heroBadge={
            <span className={styles["sticker"]}>
              <span className={styles["stickerPercent"]}>{promo.percent}</span>
              <span className={styles["stickerNote"]}>{promo.until}</span>
            </span>
          }
        />
      )}
    </Shell>
  );
}

/* C. Плавающая карточка ------------------------------------------------ */

function FloatingCard({ page }: { readonly page: PageKind }) {
  const [state, setState] = useState<"hidden" | "card" | "pill">("hidden");
  const { days } = useCountdown(promo.endsAt);
  useEffect(() => {
    // Карточка выезжает не сразу: сначала человек видит саму страницу.
    const timer = window.setTimeout(() => setState("card"), 1200);
    return () => window.clearTimeout(timer);
  }, []);
  if (state === "hidden") return null;
  if (state === "pill")
    return (
      <button
        className={styles["floatingPill"]}
        type="button"
        onClick={() => setState("card")}
      >
        {promo.percent} · ещё {days} {daysWord(days)}
      </button>
    );
  return (
    <aside className={styles["floating"]} aria-label="Скидка">
      <div className={styles["floatingHead"]}>
        <span className={styles["floatingEyebrow"]}>{promo.name}</span>
        <button
          className={styles["iconButton"]}
          type="button"
          aria-label="Свернуть"
          onClick={() => setState("pill")}
        >
          <Minimize2 aria-hidden="true" />
        </button>
      </div>
      <p className={styles["floatingTitle"]}>
        {promo.percent} на {promo.product}
      </p>
      <div className={styles["floatingPrice"]}>
        <Price />
      </div>
      <Timer />
      <a
        className={styles["offerAction"]}
        href={page === "course" ? "#enroll" : promo.courseHref}
      >
        {page === "course" ? "К цене" : "Забрать скидку"}
        <ArrowRight aria-hidden="true" />
      </a>
    </aside>
  );
}

function VariantC({ page }: { readonly page: PageKind }) {
  return (
    <>
      <Shell page={page}>{page === "home" ? <Home /> : <CoursePage />}</Shell>
      <FloatingCard page={page} />
    </>
  );
}

/* D. Метка в шапке ----------------------------------------------------- */

function HeaderChip({ page }: { readonly page: PageKind }) {
  const { days } = useCountdown(promo.endsAt);
  return (
    <a
      className={styles["headerChip"]}
      href={page === "course" ? "#enroll" : promo.courseHref}
    >
      <Percent />
      <span className={styles["headerChipLong"]}>на {promo.product} ·</span>
      <span className={styles["headerChipDays"]}>
        ещё {days} {daysWord(days)}
      </span>
      <span className={styles["headerChipPulse"]} aria-hidden="true" />
    </a>
  );
}

function VariantD({ page }: { readonly page: PageKind }) {
  return (
    <Shell
      page={page}
      accountSlot={
        <div className="flex items-center gap-2 sm:gap-3">
          <HeaderChip page={page} />
          <ThemeSwitch surface="public" />
          <HeaderAuthControl state="guest" avatar={null} />
        </div>
      }
    >
      {page === "home" ? <Home /> : <CoursePage />}
    </Shell>
  );
}

/* E. Большой баннер на Главной ---------------------------------------- */

function HomeBanner() {
  return (
    <section className="public-page-container mx-auto" aria-label="Скидка">
      <div className={styles["banner"]}>
        <div style={{ position: "relative", zIndex: 1 }}>
          <span className={styles["bannerEyebrow"]}>
            {promo.name} · {promo.until}
          </span>
          <h2 className={styles["bannerTitle"]}>
            <span className={styles["percentText"]}>{promo.percent}</span> на
            курс {promo.product}
          </h2>
          <p className={styles["bannerLead"]}>
            Полный курс с менторингом и проверкой заданий. Цена вернётся к
            прежней 1 декабря.
          </p>
          <div className={styles["bannerRow"]}>
            <a className={styles["offerAction"]} href={promo.courseHref}>
              Забрать скидку
              <ArrowRight aria-hidden="true" />
            </a>
            <Price />
          </div>
        </div>
        <div className={styles["bannerTimer"]}>
          <Timer />
          <span className={styles["bannerTimerLabel"]}>до конца скидки</span>
        </div>
      </div>
    </section>
  );
}

function VariantE({ page }: { readonly page: PageKind }) {
  return (
    <Shell page={page}>
      {page === "home" ? (
        <Home top={<HomeBanner />} />
      ) : (
        <CoursePage
          heroCall={
            <div
              className={`grid justify-items-start gap-3 ${styles["courseSlot"]}`}
            >
              <a className={styles["courseRibbon"]} href="#enroll">
                <Percent />
                <span>
                  {promo.name}: {promo.price}{" "}
                  <s style={{ opacity: 0.6 }}>{promo.oldPrice}</s>
                </span>
                <span style={{ opacity: 0.7 }}>{promo.until}</span>
                <ArrowDown aria-hidden="true" />
              </a>
            </div>
          }
        />
      )}
    </Shell>
  );
}

/* F. Полоса на анимации Главной, короткая полоса над страницей курса -------- */

/**
 * Окно анимации на Главной уже ведёт на курс, поэтому полоса внутри него без своей ссылки. Модуль
 * карточки прототип не меняет: полоса встаёт в окно порталом после первой отрисовки.
 */
function FilmDiscount() {
  const [film, setFilm] = useState<HTMLElement | null>(null);
  const { days, hours, minutes } = useCountdown(promo.endsAt);
  useEffect(() => {
    const find = () =>
      document.querySelector<HTMLElement>(
        '[data-product-presentation="ai-engineering-course"] .home-course-film',
      );
    const found = find();
    if (found !== null) {
      setFilm(found);
      return;
    }
    const observer = new MutationObserver(() => {
      const late = find();
      if (late === null) return;
      observer.disconnect();
      setFilm(late);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  if (film === null) return null;
  return createPortal(
    <span className={styles["filmStrip"]}>
      <Percent />
      <span className={styles["filmStripText"]}>
        <span className={styles["filmStripPrice"]}>{promo.price}</span>
        <s className={styles["filmStripOld"]}>{promo.oldPrice}</s>
      </span>
      <span className={`${styles["digits"]} ${styles["filmStripTimer"]}`}>
        {days} д {pad(hours)}:{pad(minutes)}
      </span>
    </span>,
    film,
  );
}

function ShortStrip() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div className={styles["strip"]} role="region" aria-label="Скидка">
      <Percent />
      <p className={styles["stripText"]}>
        <strong>
          <span className={styles["stripWide"]}>{promo.name} </span>
          {promo.until}
        </strong>
      </p>
      <a className={styles["stripLink"]} href="#enroll">
        К цене
        <ArrowDown aria-hidden="true" />
      </a>
      <button
        className={styles["stripClose"]}
        type="button"
        aria-label="Скрыть"
        onClick={() => setOpen(false)}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  );
}

function VariantF({ page }: { readonly page: PageKind }) {
  if (page === "home")
    return (
      <Shell page={page}>
        <Home />
        <FilmDiscount />
      </Shell>
    );
  return (
    <div className={styles["withStrip"]}>
      <ShortStrip />
      <Shell page={page}>
        <CoursePage />
      </Shell>
    </div>
  );
}

/* G и H. Бейдж «идёт скидка» на Главной, короткая полоса над страницей курса -- */

/** Находит узел карточки курса после отрисовки: модуль карточки прототип не меняет. */
function useCourseCardNode(selector: string) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const find = () =>
      document.querySelector<HTMLElement>(
        `[data-product-presentation="ai-engineering-course"] ${selector}`,
      );
    const found = find();
    if (found !== null) {
      setNode(found);
      return;
    }
    const observer = new MutationObserver(() => {
      const late = find();
      if (late === null) return;
      observer.disconnect();
      setNode(late);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [selector]);
  return node;
}

function DiscountBadge({ place }: { readonly place: "film" | "title" }) {
  const node = useCourseCardNode(
    place === "film" ? ".home-course-film" : ".home-course-heading h2",
  );
  if (node === null) return null;
  return createPortal(
    <span
      className={`${styles["saleBadge"]} ${
        place === "film" ? styles["saleBadgeFilm"] : styles["saleBadgeTitle"]
      }`}
    >
      <span className={styles["saleBadgeDot"]} aria-hidden="true" />
      Скидка {promo.percent.replace("−", "")} {promo.until}
    </span>,
    node,
  );
}

function badgeVariant(place: "film" | "title") {
  return function BadgeVariant({ page }: { readonly page: PageKind }) {
    if (page === "home")
      return (
        <Shell page={page}>
          <Home />
          <DiscountBadge place={place} />
        </Shell>
      );
    return (
      <div className={styles["withStrip"]}>
        <ShortStrip />
        <Shell page={page}>
          <CoursePage />
        </Shell>
      </div>
    );
  };
}
/**
 * Выбор владельца 23.11.2026: бейдж на углу анимации Главной. Слева на Главной «Открыть курс», на
 * анимации кнопки нет. На странице курса слева светло-оранжевая метка набора ведёт вниз к цене и
 * называет скидку, на анимации кнопка программы (у участника «Продолжить обучение»).
 */
function VariantG({ page }: { readonly page: PageKind }) {
  if (page === "home")
    return (
      <Shell page={page}>
        <div className={styles["homeWithoutFilmCall"]}>
          <Home
            courseCall={
              <CohortCallView
                call={{
                  banner: null,
                  action: {
                    kind: "programme",
                    href: "/products/ai-engineering",
                    label: "Открыть курс",
                  },
                }}
              />
            }
          />
        </div>
        <DiscountBadge place="film" />
      </Shell>
    );
  const call = cohortCall({
    cohort: runningCohort,
    offer: discountedOffer,
    productAccess: "closed",
    signedIn: false,
    slug: "ai-engineering",
  });
  return (
    <div className={styles["withStrip"]}>
      <ShortStrip />
      <Shell page={page}>
        <CoursePage
          heroCall={
            <CohortCallView
              call={{
                banner: {
                  kind: "live",
                  text: call.banner?.text ?? "Идёт набор",
                  detail: `${promo.percent} ${promo.until}`,
                  href: "#enroll",
                },
                action: null,
              }}
            />
          }
          heroBadge={
            <CourseLearningLink slug="ai-engineering" intent="programme" />
          }
        />
      </Shell>
    </div>
  );
}
const VariantH = badgeVariant("title");

/* Истории -------------------------------------------------------------- */

const variants = {
  A: VariantA,
  B: VariantB,
  C: VariantC,
  D: VariantD,
  E: VariantE,
  F: VariantF,
  G: VariantG,
  H: VariantH,
} as const;

function DiscountPrototype({
  variant,
  page,
}: {
  readonly variant: keyof typeof variants;
  readonly page: PageKind;
}) {
  const View = variants[variant];
  return <View page={page} />;
}

const meta = {
  beforeEach: ({ args }) => {
    mocked(usePathname).mockReturnValue(
      args.page === "home" ? "/" : "/products/ai-engineering",
    );
    window.localStorage.setItem(
      storageNoticeKey,
      String(currentLegalEdition("cookies").version),
    );
  },
  id: "prototypes-discount",
  title: "Prototypes/Скидка на сайте",
  component: DiscountPrototype,
  parameters: {
    layout: "fullscreen",
    nextjs: { appDirectory: true },
    docs: {
      description: {
        component:
          "Прототип (23.11.2026): как показать действующую скидку на Главной и на странице курса. A: полоса над сайтом. B: скидка внутри предложения курса. C: плавающая карточка с таймером. D: метка в шапке. E: большой баннер на Главной. F: полоса на анимации Главной и короткая полоса над страницей курса. G: бейдж скидки на углу анимации. H: бейдж скидки у названия курса.",
      },
    },
  },
  argTypes: {
    variant: { control: "inline-radio", options: Object.keys(variants) },
    page: { control: "inline-radio", options: ["home", "course"] },
  },
} satisfies Meta<typeof DiscountPrototype>;
export default meta;
type Story = StoryObj<typeof meta>;

const desktop = {
  viewport: { value: "desktop1440", isRotated: false },
} as const;
const mobile = { viewport: { value: "mobile390", isRotated: false } } as const;

export const A_StripHome: Story = {
  name: "A. Полоса над сайтом · Главная",
  args: { variant: "A", page: "home" },
  globals: desktop,
};
export const A_StripCourse: Story = {
  name: "A. Полоса над сайтом · Курс",
  args: { variant: "A", page: "course" },
  globals: desktop,
};
export const A_StripMobile: Story = {
  name: "A. Полоса над сайтом · Телефон",
  args: { variant: "A", page: "home" },
  globals: mobile,
};
export const B_InlineHome: Story = {
  name: "B. Внутри предложения · Главная",
  args: { variant: "B", page: "home" },
  globals: desktop,
};
export const B_InlineCourse: Story = {
  name: "B. Внутри предложения · Курс",
  args: { variant: "B", page: "course" },
  globals: desktop,
};
export const B_InlineMobile: Story = {
  name: "B. Внутри предложения · Телефон",
  args: { variant: "B", page: "course" },
  globals: mobile,
};
export const C_FloatingHome: Story = {
  name: "C. Плавающая карточка · Главная",
  args: { variant: "C", page: "home" },
  globals: desktop,
};
export const C_FloatingCourse: Story = {
  name: "C. Плавающая карточка · Курс",
  args: { variant: "C", page: "course" },
  globals: desktop,
};
export const C_FloatingMobile: Story = {
  name: "C. Плавающая карточка · Телефон",
  args: { variant: "C", page: "home" },
  globals: mobile,
};
export const D_HeaderHome: Story = {
  name: "D. Метка в шапке · Главная",
  args: { variant: "D", page: "home" },
  globals: desktop,
};
export const D_HeaderCourse: Story = {
  name: "D. Метка в шапке · Курс",
  args: { variant: "D", page: "course" },
  globals: desktop,
};
export const D_HeaderMobile: Story = {
  name: "D. Метка в шапке · Телефон",
  args: { variant: "D", page: "home" },
  globals: mobile,
};
export const E_BannerHome: Story = {
  name: "E. Большой баннер · Главная",
  args: { variant: "E", page: "home" },
  globals: desktop,
};
export const E_BannerCourse: Story = {
  name: "E. Большой баннер · Курс",
  args: { variant: "E", page: "course" },
  globals: desktop,
};
export const E_BannerMobile: Story = {
  name: "E. Большой баннер · Телефон",
  args: { variant: "E", page: "home" },
  globals: mobile,
};
export const F_FilmHome: Story = {
  name: "F. Полоса на анимации · Главная",
  args: { variant: "F", page: "home" },
  globals: desktop,
};
export const F_FilmHomeMobile: Story = {
  name: "F. Полоса на анимации · Главная, телефон",
  args: { variant: "F", page: "home" },
  globals: mobile,
};
export const F_ShortStripCourse: Story = {
  name: "F. Короткая полоса · Курс",
  args: { variant: "F", page: "course" },
  globals: desktop,
};
export const F_ShortStripCourseMobile: Story = {
  name: "F. Короткая полоса · Курс, телефон",
  args: { variant: "F", page: "course" },
  globals: mobile,
};
export const G_BadgeFilmHome: Story = {
  name: "G. Бейдж на анимации · Главная",
  args: { variant: "G", page: "home" },
  globals: desktop,
};
export const G_BadgeFilmHomeMobile: Story = {
  name: "G. Бейдж на анимации · Главная, телефон",
  args: { variant: "G", page: "home" },
  globals: mobile,
};
export const H_BadgeTitleHome: Story = {
  name: "H. Бейдж у названия · Главная",
  args: { variant: "H", page: "home" },
  globals: desktop,
};
export const H_BadgeTitleHomeMobile: Story = {
  name: "H. Бейдж у названия · Главная, телефон",
  args: { variant: "H", page: "home" },
  globals: mobile,
};
export const G_CourseWithBadge: Story = {
  name: "G. Курс: метка набора и кнопка на анимации",
  args: { variant: "G", page: "course" },
  globals: desktop,
};
export const G_CourseWithBadgeMobile: Story = {
  name: "G. Курс: метка набора, телефон",
  args: { variant: "G", page: "course" },
  globals: mobile,
};
