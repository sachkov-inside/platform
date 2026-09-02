"use client";

import { useEffect, useState } from "react";

const LIVE_SEARCH_DEBOUNCE_MS = 250;

export function useLiveSearchValue<Value>(value: Value): Value {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebounced(value);
    }, LIVE_SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [value]);

  return debounced;
}
