/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from "../core/CancelablePromise";
import type { BaseHttpRequest } from "../core/BaseHttpRequest";
export class AuthoringOverviewService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Read the admin Overview for a period of Moscow calendar days: metrics with the previous period, a short funnel, items needing attention, recent events and learning by Product. Each block answers by the caller's rights: billing:manage reads sales and access, materials:manage reads submissions; a block without its right is forbidden, a block whose owner failed is unavailable
   * @returns any
   * @throws ApiError
   */
  public readAuthoringOverview({
    period,
  }: {
    /**
     * Days in the period, 30 by default
     */
    period?: 7 | 30 | 90;
  }): CancelablePromise<{
    attention: {
      /**
       * People whose latest community operation failed or is overdue; the people list's telegram=community_failed total
       */
      communityFailures:
        | {
            count: number;
            state: "ready";
          }
        | {
            state: "forbidden";
          }
        | {
            state: "unavailable";
          };
      /**
       * Confirmed payments whose access is not yet applied
       */
      fulfillmentIncomplete:
        | {
            count: number;
            state: "ready";
          }
        | {
            state: "forbidden";
          }
        | {
            state: "unavailable";
          };
      /**
       * Submissions without Author Feedback
       */
      submissionsAwaitingFeedback:
        | {
            count: number;
            state: "ready";
          }
        | {
            state: "forbidden";
          }
        | {
            state: "unavailable";
          };
      /**
       * People with a Telegram delivery whose result is unknown, or that failed in the last 30 days; the people list's telegram=delivery_failed total
       */
      telegramDeliveryFailures:
        | {
            count: number;
            state: "ready";
          }
        | {
            state: "forbidden";
          }
        | {
            state: "unavailable";
          };
      /**
       * Payments whose bank result is unknown or only authorized
       */
      undeterminedPayments:
        | {
            count: number;
            state: "ready";
          }
        | {
            state: "forbidden";
          }
        | {
            state: "unavailable";
          };
    };
    events: {
      access: "ready" | "forbidden" | "unavailable";
      /**
       * Newest first, merged across sources
       */
      items: Array<
        | {
            amountKopecks: number;
            kind: "payment_confirmed";
            occurredAt: string;
            /**
             * Telegram name and @username only with billing:manage; null without it or when unknown. Never an email
             */
            person: {
              accountId: string;
              name: string | null;
              username: string | null;
            };
            product: {
              id: string;
              name: string;
            } | null;
            purchaseRef: string;
          }
        | {
            kind: "access_issued";
            occurredAt: string;
            origin: "purchase" | "course_activation" | "manual" | "other";
            /**
             * Telegram name and @username only with billing:manage; null without it or when unknown. Never an email
             */
            person: {
              accountId: string;
              name: string | null;
              username: string | null;
            };
            product: {
              id: string;
              name: string;
            };
          }
        | {
            kind: "access_revoked";
            occurredAt: string;
            /**
             * Telegram name and @username only with billing:manage; null without it or when unknown. Never an email
             */
            person: {
              accountId: string;
              name: string | null;
              username: string | null;
            };
            product: {
              id: string;
              name: string;
            };
          }
        | {
            kind: "access_restored";
            occurredAt: string;
            /**
             * Telegram name and @username only with billing:manage; null without it or when unknown. Never an email
             */
            person: {
              accountId: string;
              name: string | null;
              username: string | null;
            };
            product: {
              id: string;
              name: string;
            };
          }
        | {
            commented: boolean;
            kind: "submission";
            occurredAt: string;
            /**
             * Telegram name and @username only with billing:manage; null without it or when unknown. Never an email
             */
            person: {
              accountId: string;
              name: string | null;
              username: string | null;
            };
            product: {
              id: string;
              name: string;
            } | null;
            submissionId: string;
            taskTitle: string | null;
          }
      >;
      payments: "ready" | "forbidden" | "unavailable";
      submissions: "ready" | "forbidden" | "unavailable";
    };
    funnel:
      | {
          state: "forbidden";
        }
      | {
          state: "unavailable";
        }
      | {
          /**
           * The full report's default Product (its first); null without Products
           */
          product: {
            id: string;
            name: string;
          } | null;
          state: "ready";
          steps: {
            checkout: number | null;
            entered: number | null;
            openedChapter: number | null;
            paid: number | null;
          };
        };
    learning:
      | {
          state: "forbidden";
        }
      | {
          state: "unavailable";
        }
      | {
          /**
           * Every non-archived Product, most holders first, then by name
           */
          products: Array<{
            /**
             * Mean share of programme Materials read over active holders; null without holders or programme Materials
             */
            averageProgress: number | null;
            holders: number;
            name: string;
            productId: string;
            started: number;
          }>;
          state: "ready";
        };
    metrics:
      | {
          state: "forbidden";
        }
      | {
          /**
           * Product Access first issued that day
           */
          newAccess:
            | {
                state: "unavailable";
              }
            | {
                /**
                 * The current period's new accesses by first-acquisition origin
                 */
                byOrigin: {
                  course_activation: number;
                  manual: number;
                  other: number;
                  purchase: number;
                };
                current: {
                  /**
                   * One entry per day of the period, ascending, zeros included
                   */
                  daily: Array<{
                    date: string;
                    value: number;
                  }>;
                  total: number;
                };
                previous: {
                  /**
                   * One entry per day of the period, ascending, zeros included
                   */
                  daily: Array<{
                    date: string;
                    value: number;
                  }>;
                  total: number;
                };
                state: "ready";
              };
          /**
           * People registered that day, by the people list's person rule
           */
          newAccounts:
            | {
                state: "unavailable";
              }
            | {
                current: {
                  /**
                   * One entry per day of the period, ascending, zeros included
                   */
                  daily: Array<{
                    date: string;
                    value: number;
                  }>;
                  total: number;
                };
                previous: {
                  /**
                   * One entry per day of the period, ascending, zeros included
                   */
                  daily: Array<{
                    date: string;
                    value: number;
                  }>;
                  total: number;
                };
                state: "ready";
              };
          /**
           * Kopecks: confirmed purchases by confirmation day minus confirmed refunds by refund day
           */
          revenue:
            | {
                state: "unavailable";
              }
            | {
                current: {
                  /**
                   * One entry per day of the period, ascending, zeros included
                   */
                  daily: Array<{
                    date: string;
                    value: number;
                  }>;
                  total: number;
                };
                previous: {
                  /**
                   * One entry per day of the period, ascending, zeros included
                   */
                  daily: Array<{
                    date: string;
                    value: number;
                  }>;
                  total: number;
                };
                state: "ready";
              };
          /**
           * Confirmed purchases by confirmation day
           */
          sales:
            | {
                state: "unavailable";
              }
            | {
                current: {
                  /**
                   * One entry per day of the period, ascending, zeros included
                   */
                  daily: Array<{
                    date: string;
                    value: number;
                  }>;
                  total: number;
                };
                previous: {
                  /**
                   * One entry per day of the period, ascending, zeros included
                   */
                  daily: Array<{
                    date: string;
                    value: number;
                  }>;
                  total: number;
                };
                state: "ready";
              };
          state: "ready";
          /**
           * Waitlist joins that day, every intake
           */
          waitlistJoins:
            | {
                state: "unavailable";
              }
            | {
                current: {
                  /**
                   * One entry per day of the period, ascending, zeros included
                   */
                  daily: Array<{
                    date: string;
                    value: number;
                  }>;
                  total: number;
                };
                previous: {
                  /**
                   * One entry per day of the period, ascending, zeros included
                   */
                  daily: Array<{
                    date: string;
                    value: number;
                  }>;
                  total: number;
                };
                state: "ready";
              };
        };
    period: {
      /**
       * The last `days` days, today included
       */
      current: {
        firstDay: string;
        /**
         * Moscow start of the first day, inclusive
         */
        from: string;
        lastDay: string;
        /**
         * Moscow start of the day after the last one, exclusive
         */
        to: string;
      };
      days: 7 | 30 | 90;
      /**
       * The `days` days right before the current period
       */
      previous: {
        firstDay: string;
        /**
         * Moscow start of the first day, inclusive
         */
        from: string;
        lastDay: string;
        /**
         * Moscow start of the day after the last one, exclusive
         */
        to: string;
      };
      timeZone: "Europe/Moscow";
    };
  }> {
    return this.httpRequest.request({
      method: "GET",
      url: "/admin/overview",
      query: {
        period: period,
      },
    });
  }
  /**
   * Read one Product's Overview for a period of Moscow calendar days: active holders by origin, revenue and sales with the previous period, the accepting waitlist intake, learning and recent payment and access events. Requires billing:manage; a block whose owner failed is unavailable
   * @returns any
   * @throws ApiError
   */
  public readProductOverview({
    productId,
    period,
  }: {
    productId: string;
    /**
     * Days in the period, 30 by default
     */
    period?: 7 | 30 | 90;
  }): CancelablePromise<{
    events:
      | {
          state: "unavailable";
        }
      | {
          /**
           * Payments and access of this Product, newest first
           */
          items: Array<
            | {
                amountKopecks: number;
                kind: "payment_confirmed";
                occurredAt: string;
                /**
                 * Telegram name and @username only with billing:manage; null without it or when unknown. Never an email
                 */
                person: {
                  accountId: string;
                  name: string | null;
                  username: string | null;
                };
                product: {
                  id: string;
                  name: string;
                } | null;
                purchaseRef: string;
              }
            | {
                kind: "access_issued";
                occurredAt: string;
                origin: "purchase" | "course_activation" | "manual" | "other";
                /**
                 * Telegram name and @username only with billing:manage; null without it or when unknown. Never an email
                 */
                person: {
                  accountId: string;
                  name: string | null;
                  username: string | null;
                };
                product: {
                  id: string;
                  name: string;
                };
              }
            | {
                kind: "access_revoked";
                occurredAt: string;
                /**
                 * Telegram name and @username only with billing:manage; null without it or when unknown. Never an email
                 */
                person: {
                  accountId: string;
                  name: string | null;
                  username: string | null;
                };
                product: {
                  id: string;
                  name: string;
                };
              }
            | {
                kind: "access_restored";
                occurredAt: string;
                /**
                 * Telegram name and @username only with billing:manage; null without it or when unknown. Never an email
                 */
                person: {
                  accountId: string;
                  name: string | null;
                  username: string | null;
                };
                product: {
                  id: string;
                  name: string;
                };
              }
            | {
                commented: boolean;
                kind: "submission";
                occurredAt: string;
                /**
                 * Telegram name and @username only with billing:manage; null without it or when unknown. Never an email
                 */
                person: {
                  accountId: string;
                  name: string | null;
                  username: string | null;
                };
                product: {
                  id: string;
                  name: string;
                } | null;
                submissionId: string;
                taskTitle: string | null;
              }
          >;
          state: "ready";
        };
    holders:
      | {
          state: "unavailable";
        }
      | {
          active: number;
          byOrigin: {
            course_activation: number;
            manual: number;
            other: number;
            purchase: number;
          };
          state: "ready";
        };
    learning:
      | {
          state: "unavailable";
        }
      | {
          /**
           * Mean share of programme Materials read over active holders; null without holders or programme Materials
           */
          averageProgress: number | null;
          holders: number;
          started: number;
          state: "ready";
        };
    period: {
      /**
       * The last `days` days, today included
       */
      current: {
        firstDay: string;
        /**
         * Moscow start of the first day, inclusive
         */
        from: string;
        lastDay: string;
        /**
         * Moscow start of the day after the last one, exclusive
         */
        to: string;
      };
      days: 7 | 30 | 90;
      /**
       * The `days` days right before the current period
       */
      previous: {
        firstDay: string;
        /**
         * Moscow start of the first day, inclusive
         */
        from: string;
        lastDay: string;
        /**
         * Moscow start of the day after the last one, exclusive
         */
        to: string;
      };
      timeZone: "Europe/Moscow";
    };
    revenue:
      | {
          state: "unavailable";
        }
      | {
          current: {
            /**
             * One entry per day of the period, ascending, zeros included
             */
            daily: Array<{
              date: string;
              value: number;
            }>;
            total: number;
          };
          previous: {
            /**
             * One entry per day of the period, ascending, zeros included
             */
            daily: Array<{
              date: string;
              value: number;
            }>;
            total: number;
          };
          state: "ready";
        };
    sales:
      | {
          state: "unavailable";
        }
      | {
          current: {
            /**
             * One entry per day of the period, ascending, zeros included
             */
            daily: Array<{
              date: string;
              value: number;
            }>;
            total: number;
          };
          previous: {
            /**
             * One entry per day of the period, ascending, zeros included
             */
            daily: Array<{
              date: string;
              value: number;
            }>;
            total: number;
          };
          state: "ready";
        };
    waitlist:
      | {
          state: "unavailable";
        }
      | {
          /**
           * The intake accepting joins now; null when none does
           */
          intake: {
            active: number;
            name: string;
          } | null;
          state: "ready";
        };
  }> {
    return this.httpRequest.request({
      method: "GET",
      url: "/admin/products/{productId}/overview",
      path: {
        productId: productId,
      },
      query: {
        period: period,
      },
    });
  }
}
