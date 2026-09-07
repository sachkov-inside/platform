/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class CommunicationsService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Manage Telegram communications as the authenticated Account
   * @returns any
   * @throws ApiError
   */
  public manageCommunications({
    requestBody,
  }: {
    requestBody: ({
      contractVersion: 'inside-communications-v1';
      expectedRevision: number;
      operation: 'templates.read';
      operationId: string;
      payload: {
        templateId: string;
      };
    } | {
      contractVersion: 'inside-communications-v1';
      expectedRevision: number;
      operation: 'templates.save';
      operationId: string;
      payload: {
        content: ({
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          text: string;
          type: 'text';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'photo';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'video';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'video_note';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'voice';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'document';
        });
        templateId: string;
      };
    } | {
      contractVersion: 'inside-communications-v1';
      expectedRevision: number;
      operation: 'funnels.read';
      operationId: string;
      payload: {
        funnelId: string;
      };
    } | {
      contractVersion: 'inside-communications-v1';
      expectedRevision: number;
      operation: 'funnels.list';
      operationId: string;
      payload: {
        cursor?: string;
      };
    } | {
      contractVersion: 'inside-communications-v1';
      expectedRevision: number;
      operation: 'funnels.save';
      operationId: string;
      payload: {
        entryResponse: {
          parts: Array<{
            content: ({
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              text: string;
              type: 'text';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'photo';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'video';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'video_note';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'voice';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'document';
            });
            partId: string;
          }>;
          stepId: string;
        };
        funnelId: string;
        isDefault: boolean;
        name: string;
        sources: Array<{
          code: string;
          name: string;
          sourceId: string;
        }>;
        steps: Array<{
          delayAnchor?: 'entry';
          delaySeconds: number;
          parts: Array<{
            content: ({
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              text: string;
              type: 'text';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'photo';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'video';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'video_note';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'voice';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'document';
            });
            partId: string;
          }>;
          stepId: string;
        }>;
      };
    } | {
      contractVersion: 'inside-communications-v1';
      expectedRevision: number;
      operation: 'funnels.publish';
      operationId: string;
      payload: {
        funnelId: string;
      };
    } | {
      contractVersion: 'inside-communications-v1';
      expectedRevision: number;
      operation: 'funnels.preview';
      operationId: string;
      payload: {
        funnelId: string;
      };
    } | {
      contractVersion: 'inside-communications-v1';
      expectedRevision: number;
      operation: 'funnels.lifecycle';
      operationId: string;
      payload: {
        action: 'pause' | 'resume' | 'archive' | 'restore';
        funnelId: string;
      };
    } | {
      contractVersion: 'inside-communications-v1';
      expectedRevision: number;
      operation: 'funnels.rollback';
      operationId: string;
      payload: {
        funnelId: string;
        publishedRevision: number;
      };
    } | {
      contractVersion: 'inside-communications-v1';
      expectedRevision: number;
      operation: 'broadcasts.read';
      operationId: string;
      payload: {
        broadcastId: string;
      };
    } | {
      contractVersion: 'inside-communications-v1';
      expectedRevision: number;
      operation: 'broadcasts.save';
      operationId: string;
      payload: {
        audience: ({
          kind: 'all';
        } | {
          funnelIds: Array<string>;
          kind: 'funnels';
        });
        broadcastId: string;
        parts: Array<{
          content: ({
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            text: string;
            type: 'text';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'photo';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'video';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'video_note';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'voice';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'document';
          });
          partId: string;
          sendAfterSeconds?: number;
        }>;
        scheduledAt: (string | string | null);
      };
    } | {
      contractVersion: 'inside-communications-v1';
      expectedRevision: number;
      operation: 'broadcasts.launch';
      operationId: string;
      payload: {
        broadcastId: string;
      };
    } | {
      contractVersion: 'inside-communications-v1';
      expectedRevision: number;
      operation: 'broadcasts.lifecycle';
      operationId: string;
      payload: {
        action: 'pause' | 'resume' | 'cancel';
        broadcastId: string;
      };
    } | {
      contractVersion: 'inside-communications-v1';
      expectedRevision: number;
      operation: 'delivery.resolve';
      operationId: string;
      payload: {
        action: 'skip' | 'retry';
        deliveryId: string;
        duplicateRiskAccepted: boolean;
        partId: string;
      };
    } | {
      contractVersion: 'inside-communications-v1';
      expectedRevision: number;
      operation: 'templates.testSend';
      operationId: string;
      payload: {
        templateId: string;
      };
    } | {
      contractVersion: 'inside-communications-v1';
      expectedRevision: number;
      operation: 'statistics.read';
      operationId: string;
      payload: {
        broadcastId?: string;
        cursor?: string;
        funnelId?: string;
      };
    } | {
      contractVersion: 'inside-communications-v1';
      expectedRevision: number;
      operation: 'intro.read';
      operationId: string;
      payload: any;
    } | {
      contractVersion: 'inside-communications-v1';
      expectedRevision: number;
      operation: 'intro.save';
      operationId: string;
      payload: {
        introId: string;
        parts: Array<{
          content: ({
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            text: string;
            type: 'text';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'photo';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'video';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'video_note';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'voice';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'document';
          });
          partId: string;
        }>;
      };
    } | {
      contractVersion: 'inside-communications-v1';
      expectedRevision: number;
      operation: 'deliveries.read';
      operationId: string;
      payload: {
        broadcastId?: string;
        cursor?: string;
        deliveryId?: string;
        funnelId?: string;
      };
    } | {
      contractVersion: 'inside-communications-v1';
      expectedRevision: number;
      operation: 'broadcasts.list';
      operationId: string;
      payload: {
        cursor?: string;
      };
    } | {
      contractVersion: 'inside-communications-v1';
      expectedRevision: number;
      operation: 'entries.read';
      operationId: string;
      payload: {
        contactId: string;
        cursor?: string;
      };
    } | {
      contractVersion: 'inside-communications-v1';
      expectedRevision: number;
      operation: 'templates.list';
      operationId: string;
      payload: {
        cursor?: string;
      };
    }),
  }): CancelablePromise<{
    botStartUrl?: string;
    ok: boolean;
    targetErrors?: Array<{
      reason: 'not_found' | 'not_published' | 'not_free' | 'incomplete';
      targetId: string | null;
      url: string;
    }>;
    trackingBacklog?: ({
      kind: 'ready';
      oldestAgeSeconds: number;
      pending: number;
    } | {
      kind: 'unavailable';
    });
    value: ({
      contractVersion: 'inside-communications-v1';
      status: 'ok';
      template: {
        botIdentity: string;
        content: ({
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          text: string;
          type: 'text';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'photo';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'video';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'video_note';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'voice';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'document';
        });
        revision: number;
        templateId: string;
      };
    } | {
      contractVersion: 'inside-communications-v1';
      funnel: {
        entryResponse: {
          parts: Array<{
            content: ({
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              text: string;
              type: 'text';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'photo';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'video';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'video_note';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'voice';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'document';
            });
            partId: string;
          }>;
          stepId: string;
        };
        funnelId: string;
        isDefault: boolean;
        lifecycle: 'draft' | 'published' | 'paused' | 'archived';
        name: string;
        publishedRevision: (number | string | null);
        revision: number;
        sources: Array<{
          code: string;
          name: string;
          sourceId: string;
        }>;
        steps: Array<{
          delayAnchor?: 'entry';
          delaySeconds: number;
          parts: Array<{
            content: ({
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              text: string;
              type: 'text';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'photo';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'video';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'video_note';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'voice';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'document';
            });
            partId: string;
          }>;
          stepId: string;
        }>;
      };
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v1';
      funnels: Array<{
        entryResponse: {
          parts: Array<{
            content: ({
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              text: string;
              type: 'text';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'photo';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'video';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'video_note';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'voice';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'document';
            });
            partId: string;
          }>;
          stepId: string;
        };
        funnelId: string;
        isDefault: boolean;
        lifecycle: 'draft' | 'published' | 'paused' | 'archived';
        name: string;
        publishedRevision: (number | string | null);
        revision: number;
        sources: Array<{
          code: string;
          name: string;
          sourceId: string;
        }>;
        steps: Array<{
          delayAnchor?: 'entry';
          delaySeconds: number;
          parts: Array<{
            content: ({
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              text: string;
              type: 'text';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'photo';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'video';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'video_note';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'voice';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'document';
            });
            partId: string;
          }>;
          stepId: string;
        }>;
      }>;
      nextCursor: (string | string | null);
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v1';
      preview: {
        addedStepIds: Array<string>;
        completedParticipantsReceivingNewSteps: number;
        deletedStepIds: Array<string>;
        editedStepIds: Array<string>;
        eligibleContacts: number;
        funnelId: string;
        reorderedStepIds: Array<string>;
        revision: number;
        validationErrors: Array<{
          reason: 'not_found' | 'not_published' | 'not_free' | 'incomplete';
          target: {
            kind: 'material' | 'series';
            targetId: string;
          };
        }>;
      };
      status: 'ok';
    } | {
      broadcast: {
        audience: ({
          kind: 'all';
        } | {
          funnelIds: Array<string>;
          kind: 'funnels';
        });
        audienceSnapshotId: (string | string | null);
        broadcastId: string;
        parts: Array<{
          content: ({
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            text: string;
            type: 'text';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'photo';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'video';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'video_note';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'voice';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'document';
          });
          partId: string;
          sendAfterSeconds?: number;
        }>;
        revision: number;
        scheduledAt: (string | string | null);
        snapshotSize: number;
        state: 'draft' | 'scheduled' | 'running' | 'paused' | 'cancelled' | 'completed';
      };
      contractVersion: 'inside-communications-v1';
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v1';
      deliveryId: string;
      outcome: 'skipped' | 'retry_requested';
      partId: string;
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v1';
      status: 'ok';
      testDeliveryId: string;
    } | {
      contractVersion: 'inside-communications-v1';
      status: 'ok';
      targets: Array<{
        eligible: boolean;
        reason: 'eligible' | 'not_found' | 'not_published' | 'not_free' | 'incomplete';
        safeUrl: (string | string | null);
        target: {
          kind: 'material' | 'series';
          targetId: string;
        };
      }>;
    } | {
      contractVersion: 'inside-communications-v1';
      safeUrl: string;
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v1';
      eventId: string;
      outcome: 'recorded' | 'duplicate';
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v1';
      statistics: {
        analyticsLagSeconds: number;
        blocked: number;
        contacts: Array<{
          contactId: string;
          entries: Array<{
            enteredAt: string;
            funnelId: (string | string | null);
            outcome: string;
            sourceCode: (string | string | null);
            sourceId: (string | string | null);
          }>;
          firstSourceId: (string | string | null);
          latestSourceId: (string | string | null);
          marketingEnabled: boolean;
          nextEntryCursor: (string | string | null);
          reachable: boolean;
        }>;
        deliveries: {
          failed: number;
          partialCancelled: number;
          pending: number;
          sent: number;
          suppressed: number;
          unknown: number;
        };
        knownAutomationHits: number;
        marketingOff: number;
        nextCursor: (string | string | null);
        reachable: number;
        totalBotContacts: number;
        trackingHits: number;
        uniqueParticipants: number;
        uniqueTokensWithHits: number;
      };
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v1';
      intro: {
        introId: string;
        parts: Array<{
          content: ({
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            text: string;
            type: 'text';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'photo';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'video';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'video_note';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'voice';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'document';
          });
          partId: string;
        }>;
        revision: number;
      };
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v1';
      deliveries: Array<{
        broadcastId: (string | string | null);
        cancelRequested: boolean;
        completedAt: (string | string | null);
        contactId: string;
        deliveryId: string;
        funnelId: (string | string | null);
        parts: Array<{
          attempts: Array<{
            attemptedAt: string;
            attemptId: string;
            diagnosticCode: (string | string | null);
            duplicateRiskAccepted: boolean;
            outcome: 'sent' | 'api_rejected' | 'retryable' | 'unknown';
          }>;
          diagnosticCode: (string | string | null);
          partId: string;
          state: 'pending' | 'in_flight' | 'sent' | 'failed' | 'unknown' | 'suppressed' | 'skipped' | 'cancelled';
        }>;
        publishedRevision: number;
        revision: number;
        snapshot: Array<{
          content: ({
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            text: string;
            type: 'text';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'photo';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'video';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'video_note';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'voice';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'document';
          });
          partId: string;
          sendAfterSeconds?: number;
        }>;
        stepId: (string | string | null);
      }>;
      nextCursor: (string | string | null);
      status: 'ok';
    } | {
      broadcasts: Array<{
        audience: ({
          kind: 'all';
        } | {
          funnelIds: Array<string>;
          kind: 'funnels';
        });
        audienceSnapshotId: (string | string | null);
        broadcastId: string;
        parts: Array<{
          content: ({
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            text: string;
            type: 'text';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'photo';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'video';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'video_note';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'voice';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'document';
          });
          partId: string;
          sendAfterSeconds?: number;
        }>;
        revision: number;
        scheduledAt: (string | string | null);
        snapshotSize: number;
        state: 'draft' | 'scheduled' | 'running' | 'paused' | 'cancelled' | 'completed';
      }>;
      contractVersion: 'inside-communications-v1';
      nextCursor: (string | string | null);
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v1';
      entries: Array<{
        enteredAt: string;
        funnelId: (string | string | null);
        outcome: string;
        sourceCode: (string | string | null);
        sourceId: (string | string | null);
      }>;
      nextCursor: (string | string | null);
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v1';
      nextCursor: (string | string | null);
      status: 'ok';
      templates: Array<{
        botIdentity: string;
        content: ({
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          text: string;
          type: 'text';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'photo';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'video';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'video_note';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'voice';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'document';
        });
        revision: number;
        templateId: string;
      }>;
    });
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/communications',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Read an authorized template by ID or reference link without fetching the link
   * @returns any
   * @throws ApiError
   */
  public resolveCommunicationsTemplate({
    requestBody,
  }: {
    requestBody: {
      operationId: string;
      reference: string;
    },
  }): CancelablePromise<{
    botStartUrl?: string;
    ok: boolean;
    targetErrors?: Array<{
      reason: 'not_found' | 'not_published' | 'not_free' | 'incomplete';
      targetId: string | null;
      url: string;
    }>;
    trackingBacklog?: ({
      kind: 'ready';
      oldestAgeSeconds: number;
      pending: number;
    } | {
      kind: 'unavailable';
    });
    value: ({
      contractVersion: 'inside-communications-v1';
      status: 'ok';
      template: {
        botIdentity: string;
        content: ({
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          text: string;
          type: 'text';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'photo';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'video';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'video_note';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'voice';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'document';
        });
        revision: number;
        templateId: string;
      };
    } | {
      contractVersion: 'inside-communications-v1';
      funnel: {
        entryResponse: {
          parts: Array<{
            content: ({
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              text: string;
              type: 'text';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'photo';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'video';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'video_note';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'voice';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'document';
            });
            partId: string;
          }>;
          stepId: string;
        };
        funnelId: string;
        isDefault: boolean;
        lifecycle: 'draft' | 'published' | 'paused' | 'archived';
        name: string;
        publishedRevision: (number | string | null);
        revision: number;
        sources: Array<{
          code: string;
          name: string;
          sourceId: string;
        }>;
        steps: Array<{
          delayAnchor?: 'entry';
          delaySeconds: number;
          parts: Array<{
            content: ({
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              text: string;
              type: 'text';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'photo';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'video';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'video_note';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'voice';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'document';
            });
            partId: string;
          }>;
          stepId: string;
        }>;
      };
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v1';
      funnels: Array<{
        entryResponse: {
          parts: Array<{
            content: ({
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              text: string;
              type: 'text';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'photo';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'video';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'video_note';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'voice';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'document';
            });
            partId: string;
          }>;
          stepId: string;
        };
        funnelId: string;
        isDefault: boolean;
        lifecycle: 'draft' | 'published' | 'paused' | 'archived';
        name: string;
        publishedRevision: (number | string | null);
        revision: number;
        sources: Array<{
          code: string;
          name: string;
          sourceId: string;
        }>;
        steps: Array<{
          delayAnchor?: 'entry';
          delaySeconds: number;
          parts: Array<{
            content: ({
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              text: string;
              type: 'text';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'photo';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'video';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'video_note';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'voice';
            } | {
              buttons: Array<{
                row?: number;
                text: string;
                url: string;
              }>;
              entities: Array<{
                language?: string;
                length: number;
                offset: number;
                type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
                url?: string;
              }>;
              fileId: string;
              text: string;
              type: 'document';
            });
            partId: string;
          }>;
          stepId: string;
        }>;
      }>;
      nextCursor: (string | string | null);
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v1';
      preview: {
        addedStepIds: Array<string>;
        completedParticipantsReceivingNewSteps: number;
        deletedStepIds: Array<string>;
        editedStepIds: Array<string>;
        eligibleContacts: number;
        funnelId: string;
        reorderedStepIds: Array<string>;
        revision: number;
        validationErrors: Array<{
          reason: 'not_found' | 'not_published' | 'not_free' | 'incomplete';
          target: {
            kind: 'material' | 'series';
            targetId: string;
          };
        }>;
      };
      status: 'ok';
    } | {
      broadcast: {
        audience: ({
          kind: 'all';
        } | {
          funnelIds: Array<string>;
          kind: 'funnels';
        });
        audienceSnapshotId: (string | string | null);
        broadcastId: string;
        parts: Array<{
          content: ({
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            text: string;
            type: 'text';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'photo';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'video';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'video_note';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'voice';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'document';
          });
          partId: string;
          sendAfterSeconds?: number;
        }>;
        revision: number;
        scheduledAt: (string | string | null);
        snapshotSize: number;
        state: 'draft' | 'scheduled' | 'running' | 'paused' | 'cancelled' | 'completed';
      };
      contractVersion: 'inside-communications-v1';
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v1';
      deliveryId: string;
      outcome: 'skipped' | 'retry_requested';
      partId: string;
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v1';
      status: 'ok';
      testDeliveryId: string;
    } | {
      contractVersion: 'inside-communications-v1';
      status: 'ok';
      targets: Array<{
        eligible: boolean;
        reason: 'eligible' | 'not_found' | 'not_published' | 'not_free' | 'incomplete';
        safeUrl: (string | string | null);
        target: {
          kind: 'material' | 'series';
          targetId: string;
        };
      }>;
    } | {
      contractVersion: 'inside-communications-v1';
      safeUrl: string;
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v1';
      eventId: string;
      outcome: 'recorded' | 'duplicate';
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v1';
      statistics: {
        analyticsLagSeconds: number;
        blocked: number;
        contacts: Array<{
          contactId: string;
          entries: Array<{
            enteredAt: string;
            funnelId: (string | string | null);
            outcome: string;
            sourceCode: (string | string | null);
            sourceId: (string | string | null);
          }>;
          firstSourceId: (string | string | null);
          latestSourceId: (string | string | null);
          marketingEnabled: boolean;
          nextEntryCursor: (string | string | null);
          reachable: boolean;
        }>;
        deliveries: {
          failed: number;
          partialCancelled: number;
          pending: number;
          sent: number;
          suppressed: number;
          unknown: number;
        };
        knownAutomationHits: number;
        marketingOff: number;
        nextCursor: (string | string | null);
        reachable: number;
        totalBotContacts: number;
        trackingHits: number;
        uniqueParticipants: number;
        uniqueTokensWithHits: number;
      };
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v1';
      intro: {
        introId: string;
        parts: Array<{
          content: ({
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            text: string;
            type: 'text';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'photo';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'video';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'video_note';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'voice';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'document';
          });
          partId: string;
        }>;
        revision: number;
      };
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v1';
      deliveries: Array<{
        broadcastId: (string | string | null);
        cancelRequested: boolean;
        completedAt: (string | string | null);
        contactId: string;
        deliveryId: string;
        funnelId: (string | string | null);
        parts: Array<{
          attempts: Array<{
            attemptedAt: string;
            attemptId: string;
            diagnosticCode: (string | string | null);
            duplicateRiskAccepted: boolean;
            outcome: 'sent' | 'api_rejected' | 'retryable' | 'unknown';
          }>;
          diagnosticCode: (string | string | null);
          partId: string;
          state: 'pending' | 'in_flight' | 'sent' | 'failed' | 'unknown' | 'suppressed' | 'skipped' | 'cancelled';
        }>;
        publishedRevision: number;
        revision: number;
        snapshot: Array<{
          content: ({
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            text: string;
            type: 'text';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'photo';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'video';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'video_note';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'voice';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'document';
          });
          partId: string;
          sendAfterSeconds?: number;
        }>;
        stepId: (string | string | null);
      }>;
      nextCursor: (string | string | null);
      status: 'ok';
    } | {
      broadcasts: Array<{
        audience: ({
          kind: 'all';
        } | {
          funnelIds: Array<string>;
          kind: 'funnels';
        });
        audienceSnapshotId: (string | string | null);
        broadcastId: string;
        parts: Array<{
          content: ({
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            text: string;
            type: 'text';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'photo';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'video';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'video_note';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'voice';
          } | {
            buttons: Array<{
              row?: number;
              text: string;
              url: string;
            }>;
            entities: Array<{
              language?: string;
              length: number;
              offset: number;
              type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
              url?: string;
            }>;
            fileId: string;
            text: string;
            type: 'document';
          });
          partId: string;
          sendAfterSeconds?: number;
        }>;
        revision: number;
        scheduledAt: (string | string | null);
        snapshotSize: number;
        state: 'draft' | 'scheduled' | 'running' | 'paused' | 'cancelled' | 'completed';
      }>;
      contractVersion: 'inside-communications-v1';
      nextCursor: (string | string | null);
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v1';
      entries: Array<{
        enteredAt: string;
        funnelId: (string | string | null);
        outcome: string;
        sourceCode: (string | string | null);
        sourceId: (string | string | null);
      }>;
      nextCursor: (string | string | null);
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v1';
      nextCursor: (string | string | null);
      status: 'ok';
      templates: Array<{
        botIdentity: string;
        content: ({
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          text: string;
          type: 'text';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'photo';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'video';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'video_note';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'voice';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'document';
        });
        revision: number;
        templateId: string;
      }>;
    });
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/communications/templates/resolve',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Verify a current confirmed author association and communications permission
   * @returns any
   * @throws ApiError
   */
  public authorizeTelegramCommunicationsAuthor({
    requestBody,
  }: {
    requestBody: {
      contractVersion: 'inside-communications-v1';
      permission: 'communications:manage';
      requestId: string;
      subject: ({
        accountRef: string;
        kind: 'account';
      } | {
        accountRef: string;
        botIdentity: string;
        kind: 'telegram';
        telegramIdentityRef: string;
      });
    },
  }): CancelablePromise<({
    accountRef: string;
    contractVersion: 'inside-communications-v1';
    requestId: string;
    status: 'allowed';
  } | {
    contractVersion: 'inside-communications-v1';
    requestId: string;
    status: 'denied';
  })> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/integrations/telegram/v1/communications/authorize',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Check public Material and Series targets in an immutable author content snapshot
   * @returns any
   * @throws ApiError
   */
  public validateTelegramAuthorContent({
    requestBody,
  }: {
    requestBody: {
      contractVersion: 'inside-communications-v1';
      parts: Array<{
        content: ({
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          text: string;
          type: 'text';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'photo';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'video';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'video_note';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'voice';
        } | {
          buttons: Array<{
            row?: number;
            text: string;
            url: string;
          }>;
          entities: Array<{
            language?: string;
            length: number;
            offset: number;
            type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'text_link' | 'blockquote' | 'expandable_blockquote';
            url?: string;
          }>;
          fileId: string;
          text: string;
          type: 'document';
        });
        partId: string;
      }>;
      permission: 'communications:manage';
      requestId: string;
      subject: ({
        accountRef: string;
        kind: 'account';
      } | {
        accountRef: string;
        botIdentity: string;
        kind: 'telegram';
        telegramIdentityRef: string;
      });
    },
  }): CancelablePromise<({
    accountRef: string;
    contractVersion: 'inside-communications-v1';
    requestId: string;
    status: 'ok';
    targetErrors: Array<{
      reason: 'not_found' | 'not_published' | 'not_free' | 'incomplete';
      targetId: (string | string | null);
      url: string;
    }>;
  } | {
    contractVersion: 'inside-communications-v1';
    requestId: string;
    status: 'denied';
  })> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/integrations/telegram/v1/communications/validate-content',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
