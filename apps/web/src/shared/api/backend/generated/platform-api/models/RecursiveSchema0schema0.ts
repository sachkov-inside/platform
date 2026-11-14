/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type RecursiveSchema0schema0 = ({
  content: Array<{
    kind: 'text';
    marks: Array<({
      kind: 'bold' | 'code' | 'italic' | 'strike';
    } | {
      href: string;
      kind: 'link';
    })>;
    text: string;
  }>;
  kind: 'paragraph';
} | {
  content: Array<{
    kind: 'text';
    marks: Array<({
      kind: 'bold' | 'code' | 'italic' | 'strike';
    } | {
      href: string;
      kind: 'link';
    })>;
    text: string;
  }>;
  kind: 'heading';
  level: (2 | 3 | 4);
} | {
  items: Array<Array<RecursiveSchema0schema0>>;
  kind: 'bullet_list';
} | {
  items: Array<Array<RecursiveSchema0schema0>>;
  kind: 'ordered_list';
  start?: number;
} | {
  content: Array<RecursiveSchema0schema0>;
  kind: 'blockquote';
} | {
  kind: 'code_block';
  language?: string;
  text: string;
} | {
  kind: 'horizontal_rule';
} | {
  kind: 'table';
  rows: Array<{
    cells: Array<{
      content: Array<RecursiveSchema0schema0>;
      header: boolean;
    }>;
  }>;
} | {
  collapse?: 'collapsed' | 'expanded';
  content: Array<RecursiveSchema0schema0>;
  kind: 'callout';
  title?: string;
  tone: 'note' | 'tip' | 'warning' | 'example' | 'good' | 'bad' | 'definition' | 'task';
} | {
  description?: string;
  kind: 'resource_card';
  title: string;
  url: string;
} | {
  kind: 'agent_prompt';
  text: string;
  title?: string;
} | {
  content: Array<RecursiveSchema0schema0>;
  kind: 'takeaways';
  title: string;
} | {
  kind: 'labeled_list';
  rows: Array<{
    description?: string;
    label: string;
    name: string;
  }>;
} | {
  content: Array<{
    kind: 'text';
    marks: Array<({
      kind: 'bold' | 'code' | 'italic' | 'strike';
    } | {
      href: string;
      kind: 'link';
    })>;
    text: string;
  }>;
  kind: 'key_point';
} | {
  alt: string;
  assetId: string;
  caption?: string;
  displayWidthPercent?: number;
  format?: 'svg';
  height?: number;
  imageVariants?: {
    tallDark: {
      assetId: string;
      format?: 'svg';
      height?: number;
      variants?: Array<{
        height: number;
        width: number;
      }>;
      width?: number;
    };
    tallLight: {
      assetId: string;
      format?: 'svg';
      height?: number;
      variants?: Array<{
        height: number;
        width: number;
      }>;
      width?: number;
    };
    wideDark: {
      assetId: string;
      format?: 'svg';
      height?: number;
      variants?: Array<{
        height: number;
        width: number;
      }>;
      width?: number;
    };
    wideLight: {
      assetId: string;
      format?: 'svg';
      height?: number;
      variants?: Array<{
        height: number;
        width: number;
      }>;
      width?: number;
    };
  };
  kind: 'image';
  sourceSrc?: string;
  variants?: Array<{
    height: number;
    width: number;
  }>;
  width?: number;
} | {
  assetId: string;
  contentType?: string;
  filename?: string;
  kind: 'file';
  label: string;
  size?: number;
} | {
  context?: Array<RecursiveSchema0schema0>;
  dontKnow?: {
    explanation: Array<RecursiveSchema0schema0>;
    reviewLinks: Array<string>;
  };
  id: string;
  kind: 'quiz';
  options: Array<{
    content: Array<RecursiveSchema0schema0>;
    correct: boolean;
    explanation?: Array<RecursiveSchema0schema0>;
    id: string;
  }>;
  question: Array<RecursiveSchema0schema0>;
  reveal: 'none' | 'after-answer';
  selectionMode: 'single' | 'multiple';
} | {
  chapters?: Array<{
    start: number;
    title: string;
  }>;
  description?: string;
  kind: 'video';
} | {
  kind: 'term_definition';
  termId: string;
} | {
  choices: Array<{
    content: Array<RecursiveSchema0schema0>;
    id: string;
  }>;
  context?: Array<RecursiveSchema0schema0>;
  dontKnow?: {
    explanation: Array<RecursiveSchema0schema0>;
    reviewLinks: Array<string>;
  };
  id: string;
  kind: 'match';
  mode: 'pairs' | 'groups';
  question: Array<RecursiveSchema0schema0>;
  reveal: 'none' | 'after-answer';
  rows: Array<{
    answerId: string;
    content: Array<RecursiveSchema0schema0>;
    explanation: Array<RecursiveSchema0schema0>;
    id: string;
  }>;
} | {
  context?: Array<RecursiveSchema0schema0>;
  dontKnow?: {
    explanation: Array<RecursiveSchema0schema0>;
    reviewLinks: Array<string>;
  };
  id: string;
  kind: 'order';
  question: Array<RecursiveSchema0schema0>;
  reveal: 'none' | 'after-answer';
  steps: Array<{
    content: Array<RecursiveSchema0schema0>;
    explanation: Array<RecursiveSchema0schema0>;
    id: string;
  }>;
} | {
  kind: 'step_break';
  label: string;
});
