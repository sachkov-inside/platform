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
      contractVersion: 'inside-communications-v2';
      expectedRevision: number;
      operation: 'templates.read';
      operationId: string;
      payload: {
        templateId: string;
      };
    } | {
      contractVersion: 'inside-communications-v2';
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
      contractVersion: 'inside-communications-v2';
      expectedRevision: number;
      operation: 'sequences.read';
      operationId: string;
      payload: {
        sequenceId: string;
      };
    } | {
      contractVersion: 'inside-communications-v2';
      expectedRevision: number;
      operation: 'sequences.list';
      operationId: string;
      payload: {
        cursor?: string;
      };
    } | {
      contractVersion: 'inside-communications-v2';
      expectedRevision: number;
      operation: 'sequences.save';
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
        isDefault: boolean;
        name: string;
        sequenceId: string;
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
      contractVersion: 'inside-communications-v2';
      expectedRevision: number;
      operation: 'sequences.publish';
      operationId: string;
      payload: {
        sequenceId: string;
      };
    } | {
      contractVersion: 'inside-communications-v2';
      expectedRevision: number;
      operation: 'sequences.preview';
      operationId: string;
      payload: {
        sequenceId: string;
      };
    } | {
      contractVersion: 'inside-communications-v2';
      expectedRevision: number;
      operation: 'sequences.lifecycle';
      operationId: string;
      payload: {
        action: 'pause' | 'resume' | 'archive' | 'restore';
        sequenceId: string;
      };
    } | {
      contractVersion: 'inside-communications-v2';
      expectedRevision: number;
      operation: 'sequences.rollback';
      operationId: string;
      payload: {
        publishedRevision: number;
        sequenceId: string;
      };
    } | {
      contractVersion: 'inside-communications-v2';
      expectedRevision: number;
      operation: 'broadcasts.read';
      operationId: string;
      payload: {
        broadcastId: string;
      };
    } | {
      contractVersion: 'inside-communications-v2';
      expectedRevision: number;
      operation: 'broadcasts.save';
      operationId: string;
      payload: {
        audience: ({
          kind: 'all';
        } | {
          kind: 'sequences';
          sequenceIds: Array<string>;
        } | {
          intakeId: string;
          kind: 'waitlist';
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
      contractVersion: 'inside-communications-v2';
      expectedRevision: number;
      operation: 'broadcasts.launch';
      operationId: string;
      payload: {
        broadcastId: string;
      };
    } | {
      contractVersion: 'inside-communications-v2';
      expectedRevision: number;
      operation: 'broadcasts.lifecycle';
      operationId: string;
      payload: {
        action: 'pause' | 'resume' | 'cancel';
        broadcastId: string;
      };
    } | {
      contractVersion: 'inside-communications-v2';
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
      contractVersion: 'inside-communications-v2';
      expectedRevision: number;
      operation: 'templates.testSend';
      operationId: string;
      payload: {
        templateId: string;
      };
    } | {
      contractVersion: 'inside-communications-v2';
      expectedRevision: number;
      operation: 'statistics.read';
      operationId: string;
      payload: {
        broadcastId?: string;
        cursor?: string;
        sequenceId?: string;
      };
    } | {
      contractVersion: 'inside-communications-v2';
      expectedRevision: number;
      operation: 'intro.read';
      operationId: string;
      payload: any;
    } | {
      contractVersion: 'inside-communications-v2';
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
      contractVersion: 'inside-communications-v2';
      expectedRevision: number;
      operation: 'deliveries.read';
      operationId: string;
      payload: {
        broadcastId?: string;
        cursor?: string;
        deliveryId?: string;
        sequenceId?: string;
      };
    } | {
      contractVersion: 'inside-communications-v2';
      expectedRevision: number;
      operation: 'broadcasts.list';
      operationId: string;
      payload: {
        cursor?: string;
      };
    } | {
      contractVersion: 'inside-communications-v2';
      expectedRevision: number;
      operation: 'entries.read';
      operationId: string;
      payload: {
        contactId: string;
        cursor?: string;
      };
    } | {
      contractVersion: 'inside-communications-v2';
      expectedRevision: number;
      operation: 'templates.list';
      operationId: string;
      payload: {
        cursor?: string;
      };
    } | {
      contractVersion: 'inside-communications-v2';
      expectedRevision: number;
      operation: 'broadcasts.preview';
      operationId: string;
      payload: {
        broadcastId: string;
      };
    } | {
      contractVersion: 'inside-communications-v2';
      expectedRevision: number;
      operation: 'receipts.read';
      operationId: string;
      payload: {
        receiptOperationId: string;
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
      contractVersion: 'inside-communications-v2';
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
      contractVersion: 'inside-communications-v2';
      sequence: {
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
        isDefault: boolean;
        lifecycle: 'draft' | 'published' | 'paused' | 'archived';
        name: string;
        publishedRevision: (number | string | null);
        revision: number;
        sequenceId: string;
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
      contractVersion: 'inside-communications-v2';
      nextCursor: (string | string | null);
      sequences: Array<{
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
        isDefault: boolean;
        lifecycle: 'draft' | 'published' | 'paused' | 'archived';
        name: string;
        publishedRevision: (number | string | null);
        revision: number;
        sequenceId: string;
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
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v2';
      preview: {
        addedStepIds: Array<string>;
        completedParticipantsReceivingNewSteps: number;
        deletedStepIds: Array<string>;
        editedStepIds: Array<string>;
        eligibleContacts: number;
        reorderedStepIds: Array<string>;
        revision: number;
        sequenceId: string;
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
          kind: 'sequences';
          sequenceIds: Array<string>;
        } | {
          intakeId: string;
          kind: 'waitlist';
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
        waitlistAudience?: {
          active: number;
          eligible: number;
          excluded: number;
        };
      };
      contractVersion: 'inside-communications-v2';
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v2';
      deliveryId: string;
      outcome: 'skipped' | 'retry_requested';
      partId: string;
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v2';
      status: 'ok';
      testDeliveryId: string;
    } | {
      contractVersion: 'inside-communications-v2';
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
      contractVersion: 'inside-communications-v2';
      safeUrl: string;
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v2';
      eventId: string;
      outcome: 'recorded' | 'duplicate';
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v2';
      statistics: {
        analyticsLagSeconds: number;
        blocked: number;
        contacts: Array<{
          contactId: string;
          entries: Array<{
            enteredAt: string;
            outcome: string;
            sequenceId: (string | string | null);
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
      contractVersion: 'inside-communications-v2';
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
      contractVersion: 'inside-communications-v2';
      deliveries: Array<{
        broadcastId: (string | string | null);
        cancelRequested: boolean;
        completedAt: (string | string | null);
        contactId: string;
        deliveryId: string;
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
        sequenceId: (string | string | null);
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
          kind: 'sequences';
          sequenceIds: Array<string>;
        } | {
          intakeId: string;
          kind: 'waitlist';
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
        waitlistAudience?: {
          active: number;
          eligible: number;
          excluded: number;
        };
      }>;
      contractVersion: 'inside-communications-v2';
      nextCursor: (string | string | null);
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v2';
      entries: Array<{
        enteredAt: string;
        outcome: string;
        sequenceId: (string | string | null);
        sourceCode: (string | string | null);
        sourceId: (string | string | null);
      }>;
      nextCursor: (string | string | null);
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v2';
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
    } | {
      contractVersion: 'inside-communications-v2';
      status: 'ok';
      waitlistPreview: {
        active: number;
        broadcastId: string;
        eligible: number;
        purchaseUrl: string;
        revision: number;
        saleOpen: boolean;
      };
    } | {
      contractVersion: 'inside-communications-v2';
      receipt: {
        createdAt: string;
        operationId: string;
        requestJson: string;
        resultJson: string;
      };
      status: 'ok';
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
      contractVersion: 'inside-communications-v2';
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
      contractVersion: 'inside-communications-v2';
      sequence: {
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
        isDefault: boolean;
        lifecycle: 'draft' | 'published' | 'paused' | 'archived';
        name: string;
        publishedRevision: (number | string | null);
        revision: number;
        sequenceId: string;
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
      contractVersion: 'inside-communications-v2';
      nextCursor: (string | string | null);
      sequences: Array<{
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
        isDefault: boolean;
        lifecycle: 'draft' | 'published' | 'paused' | 'archived';
        name: string;
        publishedRevision: (number | string | null);
        revision: number;
        sequenceId: string;
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
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v2';
      preview: {
        addedStepIds: Array<string>;
        completedParticipantsReceivingNewSteps: number;
        deletedStepIds: Array<string>;
        editedStepIds: Array<string>;
        eligibleContacts: number;
        reorderedStepIds: Array<string>;
        revision: number;
        sequenceId: string;
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
          kind: 'sequences';
          sequenceIds: Array<string>;
        } | {
          intakeId: string;
          kind: 'waitlist';
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
        waitlistAudience?: {
          active: number;
          eligible: number;
          excluded: number;
        };
      };
      contractVersion: 'inside-communications-v2';
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v2';
      deliveryId: string;
      outcome: 'skipped' | 'retry_requested';
      partId: string;
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v2';
      status: 'ok';
      testDeliveryId: string;
    } | {
      contractVersion: 'inside-communications-v2';
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
      contractVersion: 'inside-communications-v2';
      safeUrl: string;
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v2';
      eventId: string;
      outcome: 'recorded' | 'duplicate';
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v2';
      statistics: {
        analyticsLagSeconds: number;
        blocked: number;
        contacts: Array<{
          contactId: string;
          entries: Array<{
            enteredAt: string;
            outcome: string;
            sequenceId: (string | string | null);
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
      contractVersion: 'inside-communications-v2';
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
      contractVersion: 'inside-communications-v2';
      deliveries: Array<{
        broadcastId: (string | string | null);
        cancelRequested: boolean;
        completedAt: (string | string | null);
        contactId: string;
        deliveryId: string;
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
        sequenceId: (string | string | null);
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
          kind: 'sequences';
          sequenceIds: Array<string>;
        } | {
          intakeId: string;
          kind: 'waitlist';
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
        waitlistAudience?: {
          active: number;
          eligible: number;
          excluded: number;
        };
      }>;
      contractVersion: 'inside-communications-v2';
      nextCursor: (string | string | null);
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v2';
      entries: Array<{
        enteredAt: string;
        outcome: string;
        sequenceId: (string | string | null);
        sourceCode: (string | string | null);
        sourceId: (string | string | null);
      }>;
      nextCursor: (string | string | null);
      status: 'ok';
    } | {
      contractVersion: 'inside-communications-v2';
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
    } | {
      contractVersion: 'inside-communications-v2';
      status: 'ok';
      waitlistPreview: {
        active: number;
        broadcastId: string;
        eligible: number;
        purchaseUrl: string;
        revision: number;
        saleOpen: boolean;
      };
    } | {
      contractVersion: 'inside-communications-v2';
      receipt: {
        createdAt: string;
        operationId: string;
        requestJson: string;
        resultJson: string;
      };
      status: 'ok';
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
      contractVersion: 'inside-communications-v2';
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
    contractVersion: 'inside-communications-v2';
    requestId: string;
    status: 'allowed';
  } | {
    contractVersion: 'inside-communications-v2';
    requestId: string;
    status: 'denied';
  })> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/integrations/telegram/v2/communications/authorize',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Read or recheck current public feed announcements
   * @returns any
   * @throws ApiError
   */
  public readTelegramMaterialAnnouncements({
    requestBody,
  }: {
    requestBody: {
      after?: string;
      announcementRef?: string;
      contractVersion: 'inside.material-announcements.v1';
    },
  }): CancelablePromise<{
    items: Array<{
      announcementRef: string;
      materialId: string;
      notAfter: string;
      occurredAt: string;
      summary: string;
      title: string;
      url: string;
    }>;
    nextCursor: string | null;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/integrations/telegram/v2/communications/materials',
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
      contractVersion: 'inside-communications-v2';
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
    contractVersion: 'inside-communications-v2';
    requestId: string;
    status: 'ok';
    targetErrors: Array<{
      reason: 'not_found' | 'not_published' | 'not_free' | 'incomplete';
      targetId: (string | string | null);
      url: string;
    }>;
  } | {
    contractVersion: 'inside-communications-v2';
    requestId: string;
    status: 'denied';
  })> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/integrations/telegram/v2/communications/validate-content',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Derive an active intake notification audience or recheck one dispatch recipient
   * @returns any
   * @throws ApiError
   */
  public readTelegramWaitlistAudience({
    requestBody,
  }: {
    requestBody: ({
      actorAccountRef: string;
      contractVersion: 'inside-communications-v2';
      intakeId: string;
      recipient?: {
        accountRef: string;
        telegramIdentityRef: string;
      };
      requestId: string;
    } | {
      accountRef: string;
      contractVersion: 'inside.waitlist-confirmation.v1';
      eventId: string;
      intakeId: string;
      linkRevision: number;
      telegramIdentityRef: string;
    }),
  }): CancelablePromise<({
    active: number;
    contractVersion: 'inside-communications-v2';
    members: Array<{
      accountRef: string;
      telegramIdentityRef: string;
    }>;
    purchaseUrl: string;
    requestId: string;
    saleOpen: boolean;
    status: 'ok';
  } | {
    eventId: string;
    status: 'accepted' | 'suppressed';
  })> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/integrations/telegram/v2/communications/waitlist',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
