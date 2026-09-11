import type { Decorator } from "@storybook/react-vite";

import { BroadcastsPageFrame } from "@/_pages/communications/ui/broadcasts-page-frame";

import { authoringPageEnvironment } from "./story-environment";

/**
 * Окружение story для панелей страницы рассылок: авторская оболочка и рамка самой страницы,
 * поэтому панель видна в том же кадре, что и на `/authoring/communications/broadcasts`.
 */
export function broadcastsPageEnvironment() {
  const environment = authoringPageEnvironment("/authoring/communications/broadcasts");
  return {
    ...environment,
    decorators: [
      ((Story) => (
        <BroadcastsPageFrame>
          <Story />
        </BroadcastsPageFrame>
      )) satisfies Decorator,
      ...environment.decorators,
    ],
  };
}
