import { expect, test, vi } from "vitest";
import { MobileNavigationIdentity } from "@/_app/model/mobile-navigation-identity";

test("only a change between known accounts or guest resets mobile navigation", () => {
  const identity = new MobileNavigationIdentity();
  const reset = vi.fn();
  identity.accept(undefined, reset);
  identity.accept("A", reset);
  identity.accept(undefined, reset);
  identity.accept("A", reset);
  expect(reset).toHaveBeenCalledTimes(0);
  identity.accept(undefined, reset);
  identity.accept("B", reset);
  expect(reset).toHaveBeenCalledTimes(1);
  identity.accept(null, reset);
  expect(reset).toHaveBeenCalledTimes(2);
  identity.accept(undefined, reset);
  identity.accept(null, reset);
  expect(reset).toHaveBeenCalledTimes(2);
  identity.accept("A", reset);
  expect(reset).toHaveBeenCalledTimes(3);
});

test("each shell accepts its first guest independently", () => {
  const first = new MobileNavigationIdentity();
  const second = new MobileNavigationIdentity();
  const reset = vi.fn();
  first.accept("A", reset);
  second.accept(null, reset);
  first.accept("A", reset);
  expect(reset).toHaveBeenCalledTimes(0);
  second.accept("B", reset);
  expect(reset).toHaveBeenCalledTimes(1);
});
