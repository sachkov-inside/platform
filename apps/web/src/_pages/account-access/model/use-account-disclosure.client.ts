"use client";

import { useEffect, useState } from "react";

/** A matching fragment opens the section; its trigger still controls manual closing. */
export function useAccountDisclosure(id: string) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const reveal = () => {
      if (window.location.hash === `#${id}`) setOpen(true);
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => {
      window.removeEventListener("hashchange", reveal);
    };
  }, [id]);
  return { open, setOpen };
}
