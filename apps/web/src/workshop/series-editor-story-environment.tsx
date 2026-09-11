import type { Decorator } from "@storybook/react-vite";

import { SeriesEditorPageFrame } from "@/_pages/content-collections/ui/series-editor-page-frame";

import { authoringPageEnvironment } from "./story-environment";

/**
 * Окружение story для разделов редактора руководства: авторская оболочка и рамка самой страницы,
 * поэтому раздел виден в том же кадре, что и на `/authoring/playlists/<id>`.
 */
export function seriesEditorPageEnvironment(seriesId: string) {
  const environment = authoringPageEnvironment(`/authoring/playlists/${seriesId}`);
  return {
    ...environment,
    decorators: [
      ((Story) => (
        <SeriesEditorPageFrame>
          <Story />
        </SeriesEditorPageFrame>
      )) satisfies Decorator,
      ...environment.decorators,
    ],
  };
}
