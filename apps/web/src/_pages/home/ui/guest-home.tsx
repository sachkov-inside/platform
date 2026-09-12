import { ArrowRight, BookOpen, Code2, GitBranch, Layers, MessageCircle, Terminal, Users } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { formatMaterialCount } from "@/features/library-discovery";

import type { HomeCollection } from "../model/home-view";
import { collectionDiscoveryHref } from "@/shared/routing/material-reader";

/** Reuses the #380 presenter composition with the author-selected Series. */
export function FeaturedSeries({ series }: { readonly series: HomeCollection }) {
  return <section className="home-featured" aria-labelledby="featured-title">
    <div className="home-featured-copy">
      <p className="home-featured-label">Закреплено автором · Руководство</p>
      <h2 id="featured-title">{series.name}</h2>
      {series.summary && <p className="home-featured-description">{series.summary}</p>}
      <div className="home-featured-bottom">
        <span>{formatMaterialCount(series.count)}</span>
        <Link href={collectionDiscoveryHref("series", series.slug, "/")}>Открыть руководство <ArrowRight aria-hidden="true" /></Link>
      </div>
    </div>
    <div className="home-presenter" aria-hidden="true">
      <div className="home-presenter-crop">
        {/* Pre-encoded transparent WebP: no runtime image transformation is needed. */}
        {/* oxlint-disable-next-line next/no-img-element */}
        <img src="/images/kirill-mini-app.webp" alt="" width={900} height={900} loading="eager" />
      </div>
      <div className="home-shoulder-sparks">
        <span className="home-spark home-spark-code"><Code2 /></span>
        <span className="home-spark home-spark-git"><GitBranch /></span>
        <span className="home-spark home-spark-terminal"><Terminal /></span>
      </div>
    </div>
  </section>;
}

export function HomeAccessInvitation({ href }: { readonly href: Route }) {
  return <section className="home-access-strip" aria-label="Подписка Inside">
    <BookOpen aria-hidden="true" />
    <div><strong>Гайды, руководства и общение с автором</strong><p>Подписка открывает все материалы, обсуждение со мной и сообщество.</p></div>
    <AccessLink href={href} label="Полный доступ" />
  </section>;
}

const benefits = [
  { Icon: BookOpen, title: "Цельные практические гайды", text: "Задача, объяснение, код и проверка результата — в одном материале." },
  { Icon: Layers, title: "Современная инженерия", text: "Разработка с ИИ, архитектура и инженерная база на реальных задачах." },
  { Icon: MessageCircle, title: "Обсуждение со мной", text: "Задавай вопросы по материалам и обсуждай со мной свои решения." },
  { Icon: Users, title: "Сообщество разработчиков", text: "Сравнивай подходы, делись опытом и разбирайся вместе с участниками." },
] as const;

export function HomeMembershipBenefits({ href }: { readonly href: Route }) {
  return <>
    <section className="home-membership-benefits" aria-labelledby="home-benefits">
      <h2 id="home-benefits">Что даёт подписка</h2>
      <div className="home-benefits">{benefits.map(({ Icon, title, text }) => <div key={title}>
        <Icon aria-hidden="true" /><h3>{title}</h3><p>{text}</p>
      </div>)}</div>
    </section>
    <section className="home-invitation" aria-labelledby="home-full-access">
      <div><p className="home-eyebrow">Полный доступ к Inside</p><h2 id="home-full-access">Изучай. Применяй. Обсуждай.</h2><p>Все материалы и руководства, вопросы автору и сообщество разработчиков — в одной подписке.</p></div>
      <AccessLink href={href} label="Получить полный доступ" />
    </section>
  </>;
}

/** Покупка начинается внутри платформы: это внутренний переход, а не уход на сторонний сервис. */
function AccessLink({ href, label }: { readonly href: Route; readonly label: string }) {
  return <Link className="home-access-link" href={href}>{label}<ArrowRight aria-hidden="true" /></Link>;
}
