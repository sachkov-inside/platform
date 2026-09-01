/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type RecursiveSchema1schema0 = ({
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
  items: Array<Array<RecursiveSchema1schema0>>;
  kind: 'bullet_list';
} | {
  items: Array<Array<RecursiveSchema1schema0>>;
  kind: 'ordered_list';
} | {
  content: Array<RecursiveSchema1schema0>;
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
      content: Array<RecursiveSchema1schema0>;
      header: boolean;
    }>;
  }>;
} | {
  content: Array<RecursiveSchema1schema0>;
  kind: 'callout';
  tone: 'note' | 'tip' | 'warning';
} | {
  alt: string;
  assetId: string;
  caption?: string;
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
} | {
  caption?: string;
  kind: 'video';
  videoId: string;
});
