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
} | {
  content: Array<RecursiveSchema0schema0>;
  kind: 'blockquote';
} | {
  kind: 'code_block';
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
  content: Array<RecursiveSchema0schema0>;
  kind: 'callout';
  title?: string;
  tone: 'note' | 'tip' | 'warning' | 'example' | 'good' | 'bad' | 'definition';
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
  height?: number;
  kind: 'image';
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
});
