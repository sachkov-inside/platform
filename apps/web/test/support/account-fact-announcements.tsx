import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { z } from "zod";
import {
  accountProfileChanged,
  useAccountPresentation,
} from "@/features/account-access";
import { useBillingContact } from "@/features/billing-contact";
import {
  billingContactVerified,
  resetBillingContact,
} from "@/features/billing-contact/model/billing-contact-query";
import { useNotificationPreferences } from "@/features/notification-preferences/model/use-notification-preferences.client";
import { notificationPreferencesChanged } from "@/features/notification-preferences/model/notification-preferences-query";
import {
  authorFeedbackWritten,
  resetAwaitingFeedbackCount,
  useAwaitingFeedbackCount,
} from "@/features/submission-feedback-queue";

const parameters = new URLSearchParams(window.location.search);
const kind = z
  .enum(["profile", "contact", "preferences", "feedback"])
  .parse(parameters.get("kind"));
const primary = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const secondary = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function Profile() {
  const query = useAccountPresentation();
  const profile =
    query.data?.kind === "ready" ? query.data.presentation.profile : null;
  return profile?.kind === "profile"
    ? String(profile.profile.version)
    : "loading";
}
function Contact() {
  const query = useBillingContact();
  return query.data?.ok === true
    ? String(query.data.contact?.revision)
    : "loading";
}
function Preferences() {
  const query = useNotificationPreferences();
  return query.data?.ok === true
    ? String(query.data.preferences.revision)
    : "loading";
}
function Feedback() {
  const count = useAwaitingFeedbackCount();
  return count === null ? "loading" : String(count);
}
const Status = {
  profile: Profile,
  contact: Contact,
  preferences: Preferences,
  feedback: Feedback,
}[kind];
function Observers() {
  return (
    <>
      <output aria-label="Primary">
        <Status />
      </output>
      <output aria-label="Same cache">
        <Status />
      </output>
    </>
  );
}
function App() {
  return (
    <>
      <button
        onClick={() => {
          if (kind === "contact") {
            const id = billingContactVerified.announce();
            void resetBillingContact(primary, id);
          } else if (kind === "feedback") {
            const id = authorFeedbackWritten.announce();
            void resetAwaitingFeedbackCount(primary, id);
          } else if (kind === "profile") accountProfileChanged.announce();
          else notificationPreferencesChanged.announce();
        }}
      >
        Announce write
      </button>
      <QueryClientProvider client={primary}>
        <Observers />
      </QueryClientProvider>
      {parameters.has("secondary") ? (
        <QueryClientProvider client={secondary}>
          <output aria-label="Independent cache">
            <Status />
          </output>
        </QueryClientProvider>
      ) : null}
    </>
  );
}
const root = document.getElementById("root");
if (root !== null) createRoot(root).render(<App />);
