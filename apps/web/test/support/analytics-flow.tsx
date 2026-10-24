import { createRoot } from "react-dom/client";
import { useState } from "react";
import {
  AnalyticsObservation,
  AnalyticsSettingsLink,
  StorageAndAnalyticsNotice,
} from "@/features/storage-notice";
import type { AnalyticsEvent } from "@/features/storage-notice/model/analytics-contract";
function Flow() {
  const [event, setEvent] = useState<AnalyticsEvent>("product_view");
  return (
    <main>
      <h1>Руководство</h1>
      <div style={{ position: "relative", width: 100, height: 10 }}>
        <AnalyticsObservation key={event} event={event} />
      </div>
      <p role="status">{event}</p>
      <button
        onClick={() => {
          setEvent("material_view");
        }}
      >
        Открыть материал
      </button>
      <button
        onClick={() => {
          setEvent("access_restricted");
        }}
      >
        Закрытый материал
      </button>
      <button
        onClick={() => {
          setEvent("checkout_started");
        }}
      >
        К покупке
      </button>
      <AnalyticsSettingsLink />
      <StorageAndAnalyticsNotice edition={2} policyHref="/legal/cookies" />
    </main>
  );
}
const root = document.getElementById("root");
if (root === null) throw new Error("Missing root");
createRoot(root).render(<Flow />);
