// The cleanup proof intercepts this registration boundary, without mocking Vitest itself.
export {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  test,
} from "vitest";
