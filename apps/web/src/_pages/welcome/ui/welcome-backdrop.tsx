import { Suspense, type ReactNode } from "react";

import "./welcome-backdrop.css";

/** The site stays visible behind the decision but cannot be used or read by assistive technology. */
export function WelcomeBackdrop({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <div aria-hidden="true" className="welcome-backdrop" inert>
      <Suspense fallback={null}>{children}</Suspense>
    </div>
  );
}
