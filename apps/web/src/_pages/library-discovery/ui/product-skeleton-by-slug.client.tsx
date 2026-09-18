"use client";

import { useParams } from "next/navigation";

import { aiFirstGuide } from "@/features/ai-first-guide";

import "./ai-first-guide-view.css";
import { AiFirstGuideSkeleton, GuideProductSkeleton } from "./guide-product-skeletons";

/** При переходе адрес уже известен клиентскому роутеру, поэтому скелет совпадает со страницей. */
export function ProductSkeletonBySlug() {
  const { slug } = useParams<{ slug?: string }>();
  return slug === aiFirstGuide.slug ? <AiFirstGuideSkeleton /> : <GuideProductSkeleton />;
}
