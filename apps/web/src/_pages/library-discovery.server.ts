/** Server-only public interface for Product and related Material views. */
export {
  ProductProgrammePage,
  PublishedSeriesPage,
} from "./library-discovery/index.server";

export {
  handleWaitlistRead,
  handleWaitlistIntent,
  handleWaitlistJoin,
  handleWaitlistWithdraw,
} from "./library-discovery/api/product-waitlist-route.server";
