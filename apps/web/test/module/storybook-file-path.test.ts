import { expect, it } from "vitest";
import { convertToFilePath } from "@storybook/addon-vitest/internal/test-utils";

it("registers Storybook tests from non-ASCII checkout paths", () => {
  expect(
    convertToFilePath(
      "file:///Users/dev/%D0%BF%D1%80%D0%BE%D1%84%D0%B8%D0%BB%D1%8C/name%20with%20spaces.stories.tsx",
    ),
  ).toBe("/Users/dev/профиль/name with spaces.stories.tsx");
  expect(
    convertToFilePath(
      "file:///C:/Projects/%D0%BF%D1%80%D0%BE%D1%84%D0%B8%D0%BB%D1%8C/profile.stories.tsx",
    ),
  ).toBe("C:/Projects/профиль/profile.stories.tsx");
});
