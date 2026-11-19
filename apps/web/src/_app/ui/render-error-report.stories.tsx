import { expect, spyOn } from "storybook/test";
import { committedRoot } from "@/storybook/committed-root";
import RootError from "../../../app/error";
import PublicError from "../../../app/(public)/error";

const meta = { title: "Patterns/Telemetry/Render errors" };
export default meta;
export const CommittedFallback = {
  render: () => <div />,
  play: async () => {
    const root = committedRoot(document.createElement("div"));
    const beacon = spyOn(navigator, "sendBeacon").mockReturnValue(true);
    const first = new Error("First"),
      next = new Error("Next");
    const retry = () => undefined;
    async function report(index: number, boundary: string, message: string) {
      const call = beacon.mock.calls[index];
      await expect(call?.[0]).toBe("/api/render-errors");
      const body = call?.[1];
      if (!(body instanceof Blob))
        throw new Error("Missing render-error payload");
      await expect(JSON.parse(await body.text())).toMatchObject({
        boundary,
        message,
        name: "Error",
      });
    }
    try {
      root.show(<RootError error={first} retry={retry} />);
      await report(0, "root", "First");
      root.show(<RootError error={first} retry={retry} />);
      await expect(beacon).toHaveBeenCalledTimes(1);
      root.show(<RootError error={next} retry={retry} />);
      await report(1, "root", "Next");
      root.show(<PublicError error={next} retry={retry} />);
      await report(2, "public", "Next");
      root.show(null);
      await expect(beacon).toHaveBeenCalledTimes(3);
    } finally {
      root.unmount();
      beacon.mockRestore();
    }
  },
};
