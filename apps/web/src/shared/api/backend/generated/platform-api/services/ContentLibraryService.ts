/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class ContentLibraryService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Read the bounded real-data Home projection
   * @returns any
   * @throws ApiError
   */
  public readHomeContent(): CancelablePromise<{
    guides: Array<{
      access: 'free' | 'membership' | 'workshop';
      availability: 'available' | 'locked' | 'unavailable';
      contentVersion: number;
      cover: {
        coverId: string;
        renditions: Array<{
          height: number;
          width: number;
        }>;
      } | null;
      format: {
        id: string;
        name: string;
        slug: string;
      };
      materialId: string;
      primaryVideoDurationSeconds?: number;
      primaryVideoId: string | null;
      publishedAt: string;
      seriesMemberships: Array<{
        ordinal: number;
        series: {
          id: string;
          name: string;
          slug: string;
        };
      }>;
      slug: string;
      summary: string;
      tags: Array<{
        id: string;
        name: string;
      }>;
      title: string;
      topic: {
        id: string;
        name: string;
        slug: string;
      };
    }>;
    notes: Array<{
      access: 'free' | 'membership' | 'workshop';
      availability: 'available' | 'locked' | 'unavailable';
      contentVersion: number;
      cover: {
        coverId: string;
        renditions: Array<{
          height: number;
          width: number;
        }>;
      } | null;
      format: {
        id: string;
        name: string;
        slug: string;
      };
      materialId: string;
      primaryVideoDurationSeconds?: number;
      primaryVideoId: string | null;
      publishedAt: string;
      seriesMemberships: Array<{
        ordinal: number;
        series: {
          id: string;
          name: string;
          slug: string;
        };
      }>;
      slug: string;
      summary: string;
      tags: Array<{
        id: string;
        name: string;
      }>;
      title: string;
      topic: {
        id: string;
        name: string;
        slug: string;
      };
    }>;
    playlists: Array<{
      count: number;
      cover: {
        coverId: string;
        renditions: Array<{
          height: number;
          width: number;
        }>;
      } | null;
      id: string;
      name: string;
      previewItems: Array<{
        access: 'free' | 'membership' | 'workshop';
        availability: 'available' | 'locked' | 'unavailable';
        contentVersion: number;
        cover: {
          coverId: string;
          renditions: Array<{
            height: number;
            width: number;
          }>;
        } | null;
        format: {
          id: string;
          name: string;
          slug: string;
        };
        materialId: string;
        primaryVideoDurationSeconds?: number;
        primaryVideoId: string | null;
        publishedAt: string;
        seriesMemberships: Array<{
          ordinal: number;
          series: {
            id: string;
            name: string;
            slug: string;
          };
        }>;
        slug: string;
        summary: string;
        tags: Array<{
          id: string;
          name: string;
        }>;
        title: string;
        topic: {
          id: string;
          name: string;
          slug: string;
        };
      }>;
      slug: string;
      summary: string | null;
    }>;
    topics: Array<{
      count: number;
      cover: {
        coverId: string;
        renditions: Array<{
          height: number;
          width: number;
        }>;
      } | null;
      id: string;
      name: string;
      previewItems: Array<{
        access: 'free' | 'membership' | 'workshop';
        availability: 'available' | 'locked' | 'unavailable';
        contentVersion: number;
        cover: {
          coverId: string;
          renditions: Array<{
            height: number;
            width: number;
          }>;
        } | null;
        format: {
          id: string;
          name: string;
          slug: string;
        };
        materialId: string;
        primaryVideoDurationSeconds?: number;
        primaryVideoId: string | null;
        publishedAt: string;
        seriesMemberships: Array<{
          ordinal: number;
          series: {
            id: string;
            name: string;
            slug: string;
          };
        }>;
        slug: string;
        summary: string;
        tags: Array<{
          id: string;
          name: string;
        }>;
        title: string;
        topic: {
          id: string;
          name: string;
          slug: string;
        };
      }>;
      slug: string;
      summary: string | null;
    }>;
    videos: Array<{
      access: 'free' | 'membership' | 'workshop';
      availability: 'available' | 'locked' | 'unavailable';
      contentVersion: number;
      cover: {
        coverId: string;
        renditions: Array<{
          height: number;
          width: number;
        }>;
      } | null;
      format: {
        id: string;
        name: string;
        slug: string;
      };
      materialId: string;
      primaryVideoDurationSeconds?: number;
      primaryVideoId: string | null;
      publishedAt: string;
      seriesMemberships: Array<{
        ordinal: number;
        series: {
          id: string;
          name: string;
          slug: string;
        };
      }>;
      slug: string;
      summary: string;
      tags: Array<{
        id: string;
        name: string;
      }>;
      title: string;
      topic: {
        id: string;
        name: string;
        slug: string;
      };
    }>;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/library/home',
      errors: {
        401: `Optional Account proof is invalid`,
        500: `Home catalog or Account resolution failed internally`,
        503: `Home catalog or Account dependency is unavailable`,
      },
    });
  }
  /**
   * List safe published Material projections
   * @returns any A deterministic page of published Materials
   * @throws ApiError
   */
  public listPublishedMaterials({
    sort,
    series,
    format,
    topic,
    q,
    canonicalTopic,
    after,
  }: {
    sort?: 'newest' | 'relevance' | 'series' | 'title',
    series?: Array<string>,
    format?: Array<string>,
    topic?: Array<string>,
    q?: string,
    canonicalTopic?: string,
    after?: string,
  }): CancelablePromise<{
    facets: {
      formats: Array<{
        count: number;
        cover: {
          coverId: string;
          renditions: Array<{
            height: number;
            width: number;
          }>;
        } | null;
        id: string;
        name: string;
        previewItems: Array<{
          access: 'free' | 'membership' | 'workshop';
          availability: 'available' | 'locked' | 'unavailable';
          contentVersion: number;
          cover: {
            coverId: string;
            renditions: Array<{
              height: number;
              width: number;
            }>;
          } | null;
          format: {
            id: string;
            name: string;
            slug: string;
          };
          materialId: string;
          primaryVideoDurationSeconds?: number;
          primaryVideoId: string | null;
          publishedAt: string;
          seriesMemberships: Array<{
            ordinal: number;
            series: {
              id: string;
              name: string;
              slug: string;
            };
          }>;
          slug: string;
          summary: string;
          tags: Array<{
            id: string;
            name: string;
          }>;
          title: string;
          topic: {
            id: string;
            name: string;
            slug: string;
          };
        }>;
        slug: string;
        summary: string | null;
      }>;
      series: Array<{
        count: number;
        cover: {
          coverId: string;
          renditions: Array<{
            height: number;
            width: number;
          }>;
        } | null;
        id: string;
        name: string;
        previewItems: Array<{
          access: 'free' | 'membership' | 'workshop';
          availability: 'available' | 'locked' | 'unavailable';
          contentVersion: number;
          cover: {
            coverId: string;
            renditions: Array<{
              height: number;
              width: number;
            }>;
          } | null;
          format: {
            id: string;
            name: string;
            slug: string;
          };
          materialId: string;
          primaryVideoDurationSeconds?: number;
          primaryVideoId: string | null;
          publishedAt: string;
          seriesMemberships: Array<{
            ordinal: number;
            series: {
              id: string;
              name: string;
              slug: string;
            };
          }>;
          slug: string;
          summary: string;
          tags: Array<{
            id: string;
            name: string;
          }>;
          title: string;
          topic: {
            id: string;
            name: string;
            slug: string;
          };
        }>;
        slug: string;
        summary: string | null;
      }>;
      topics: Array<{
        count: number;
        cover: {
          coverId: string;
          renditions: Array<{
            height: number;
            width: number;
          }>;
        } | null;
        id: string;
        name: string;
        previewItems: Array<{
          access: 'free' | 'membership' | 'workshop';
          availability: 'available' | 'locked' | 'unavailable';
          contentVersion: number;
          cover: {
            coverId: string;
            renditions: Array<{
              height: number;
              width: number;
            }>;
          } | null;
          format: {
            id: string;
            name: string;
            slug: string;
          };
          materialId: string;
          primaryVideoDurationSeconds?: number;
          primaryVideoId: string | null;
          publishedAt: string;
          seriesMemberships: Array<{
            ordinal: number;
            series: {
              id: string;
              name: string;
              slug: string;
            };
          }>;
          slug: string;
          summary: string;
          tags: Array<{
            id: string;
            name: string;
          }>;
          title: string;
          topic: {
            id: string;
            name: string;
            slug: string;
          };
        }>;
        slug: string;
        summary: string | null;
      }>;
    };
    items: Array<{
      access: 'free' | 'membership' | 'workshop';
      availability: 'available' | 'locked' | 'unavailable';
      contentVersion: number;
      cover: {
        coverId: string;
        renditions: Array<{
          height: number;
          width: number;
        }>;
      } | null;
      format: {
        id: string;
        name: string;
        slug: string;
      };
      materialId: string;
      primaryVideoDurationSeconds?: number;
      primaryVideoId: string | null;
      publishedAt: string;
      seriesMemberships: Array<{
        ordinal: number;
        series: {
          id: string;
          name: string;
          slug: string;
        };
      }>;
      slug: string;
      summary: string;
      tags: Array<{
        id: string;
        name: string;
      }>;
      title: string;
      topic: {
        id: string;
        name: string;
        slug: string;
      };
    }>;
    nextCursor: string | null;
    totalCount: number;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/library/materials',
      query: {
        'sort': sort,
        'series': series,
        'format': format,
        'topic': topic,
        'q': q,
        'canonicalTopic': canonicalTopic,
        'after': after,
      },
      errors: {
        400: `Catalog query is malformed`,
        401: `Optional Account proof is invalid`,
        500: `Catalog or Account resolution failed internally`,
        503: `Catalog or Account proof dependency is unavailable`,
      },
    });
  }
  /**
   * Read deterministic related Materials
   * @returns any Explicit pins followed by metadata-related Materials
   * @throws ApiError
   */
  public readRelatedPublishedMaterials({
    slug,
  }: {
    slug: string,
  }): CancelablePromise<{
    hasNext: boolean;
    items: Array<{
      access: 'free' | 'membership' | 'workshop';
      availability: 'available' | 'locked' | 'unavailable';
      contentVersion: number;
      cover: {
        coverId: string;
        renditions: Array<{
          height: number;
          width: number;
        }>;
      } | null;
      format: {
        id: string;
        name: string;
        slug: string;
      };
      materialId: string;
      primaryVideoDurationSeconds?: number;
      primaryVideoId: string | null;
      publishedAt: string;
      seriesMemberships: Array<{
        ordinal: number;
        series: {
          id: string;
          name: string;
          slug: string;
        };
      }>;
      slug: string;
      summary: string;
      tags: Array<{
        id: string;
        name: string;
      }>;
      title: string;
      topic: {
        id: string;
        name: string;
        slug: string;
      };
    }>;
    kind: 'related';
    reference: {
      cover: {
        coverId: string;
        renditions: Array<{
          height: number;
          width: number;
        }>;
      } | null;
      id: string;
      name: string;
      slug: string;
      summary: string;
    };
    relatedSeries: Array<{
      cover: {
        coverId: string;
        renditions: Array<{
          height: number;
          width: number;
        }>;
      } | null;
      id: string;
      matchingMaterialCount: number;
      name: string;
      slug: string;
      summary: string;
      totalMaterialCount: number;
    }>;
    topics: Array<{
      cover: {
        coverId: string;
        renditions: Array<{
          height: number;
          width: number;
        }>;
      } | null;
      id: string;
      name: string;
      slug: string;
    }>;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/library/materials/{slug}/related',
      path: {
        'slug': slug,
      },
      errors: {
        400: `Discovery slug is malformed`,
        401: `Optional Account proof is invalid`,
        404: `Topic, Series or source Material is not published`,
        500: `Discovery or Account resolution failed internally`,
        503: `Discovery or Account dependency is unavailable`,
      },
    });
  }
  /**
   * Read a generated ordered Series view
   * @returns any Published Materials in author-defined Series order
   * @throws ApiError
   */
  public readPublishedSeries({
    slug,
  }: {
    slug: string,
  }): CancelablePromise<{
    hasNext: boolean;
    items: Array<{
      access: 'free' | 'membership' | 'workshop';
      availability: 'available' | 'locked' | 'unavailable';
      contentVersion: number;
      cover: {
        coverId: string;
        renditions: Array<{
          height: number;
          width: number;
        }>;
      } | null;
      format: {
        id: string;
        name: string;
        slug: string;
      };
      materialId: string;
      primaryVideoDurationSeconds?: number;
      primaryVideoId: string | null;
      publishedAt: string;
      seriesMemberships: Array<{
        ordinal: number;
        series: {
          id: string;
          name: string;
          slug: string;
        };
      }>;
      slug: string;
      summary: string;
      tags: Array<{
        id: string;
        name: string;
      }>;
      title: string;
      topic: {
        id: string;
        name: string;
        slug: string;
      };
    }>;
    kind: 'series';
    reference: {
      cover: {
        coverId: string;
        renditions: Array<{
          height: number;
          width: number;
        }>;
      } | null;
      id: string;
      name: string;
      slug: string;
      summary: string;
    };
    relatedSeries: Array<{
      cover: {
        coverId: string;
        renditions: Array<{
          height: number;
          width: number;
        }>;
      } | null;
      id: string;
      matchingMaterialCount: number;
      name: string;
      slug: string;
      summary: string;
      totalMaterialCount: number;
    }>;
    topics: Array<{
      cover: {
        coverId: string;
        renditions: Array<{
          height: number;
          width: number;
        }>;
      } | null;
      id: string;
      name: string;
      slug: string;
    }>;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/library/series/{slug}',
      path: {
        'slug': slug,
      },
      errors: {
        400: `Discovery slug is malformed`,
        401: `Optional Account proof is invalid`,
        404: `Topic, Series or source Material is not published`,
        500: `Discovery or Account resolution failed internally`,
        503: `Discovery or Account dependency is unavailable`,
      },
    });
  }
  /**
   * Read a generated Topic view
   * @returns any Published Materials in the Topic
   * @throws ApiError
   */
  public readPublishedTopic({
    slug,
  }: {
    slug: string,
  }): CancelablePromise<{
    hasNext: boolean;
    items: Array<{
      access: 'free' | 'membership' | 'workshop';
      availability: 'available' | 'locked' | 'unavailable';
      contentVersion: number;
      cover: {
        coverId: string;
        renditions: Array<{
          height: number;
          width: number;
        }>;
      } | null;
      format: {
        id: string;
        name: string;
        slug: string;
      };
      materialId: string;
      primaryVideoDurationSeconds?: number;
      primaryVideoId: string | null;
      publishedAt: string;
      seriesMemberships: Array<{
        ordinal: number;
        series: {
          id: string;
          name: string;
          slug: string;
        };
      }>;
      slug: string;
      summary: string;
      tags: Array<{
        id: string;
        name: string;
      }>;
      title: string;
      topic: {
        id: string;
        name: string;
        slug: string;
      };
    }>;
    kind: 'topic';
    reference: {
      cover: {
        coverId: string;
        renditions: Array<{
          height: number;
          width: number;
        }>;
      } | null;
      id: string;
      name: string;
      slug: string;
      summary: string;
    };
    relatedSeries: Array<{
      cover: {
        coverId: string;
        renditions: Array<{
          height: number;
          width: number;
        }>;
      } | null;
      id: string;
      matchingMaterialCount: number;
      name: string;
      slug: string;
      summary: string;
      totalMaterialCount: number;
    }>;
    topics: Array<{
      cover: {
        coverId: string;
        renditions: Array<{
          height: number;
          width: number;
        }>;
      } | null;
      id: string;
      name: string;
      slug: string;
    }>;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/library/topics/{slug}',
      path: {
        'slug': slug,
      },
      errors: {
        400: `Discovery slug is malformed`,
        401: `Optional Account proof is invalid`,
        404: `Topic, Series or source Material is not published`,
        500: `Discovery or Account resolution failed internally`,
        503: `Discovery or Account dependency is unavailable`,
      },
    });
  }
}
