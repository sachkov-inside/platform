import { themeRestoreSource } from "../model/theme-preference";

/**
 * Applies the saved theme in `<head>`, before the body is parsed, so a dark page never paints
 * light first. The root layout renders it once for every section of the site; section layouts
 * declare no `themeColor`, because the script owns that tag.
 */
export function ThemeRestore() {
  return <script dangerouslySetInnerHTML={{ __html: themeRestoreSource }} />;
}
