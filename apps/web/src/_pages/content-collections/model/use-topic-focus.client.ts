"use client";

import { useEffect, useId, useRef } from "react";

/** Retained Topic instances need distinct focus targets in the same document (#2387). */
export function useTopicFocus(openId: string | undefined) {
  const namespace = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const previous = useRef(openId);
  useEffect(() => {
    const left = previous.current;
    if (left === openId) return;
    previous.current = openId;
    if (openId !== undefined) {
      document.getElementById(topicHeadingId(namespace, openId))?.focus();
      return;
    }
    const link = [
      ...(listRef.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ??
        []),
    ].find(
      (anchor) =>
        anchor.getClientRects().length > 0 &&
        new URL(anchor.href).searchParams.get("topic") === left,
    );
    link?.focus();
  }, [namespace, openId]);
  return {
    listRef,
    headingId: (topicId: string) => topicHeadingId(namespace, topicId),
  };
}

function topicHeadingId(namespace: string, topicId: string): string {
  return `topic-editor-${namespace}-${topicId}`;
}
