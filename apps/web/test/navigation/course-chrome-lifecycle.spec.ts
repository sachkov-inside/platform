import { expect, test, type Page } from "@playwright/test";

const menuKey = "inside.course-menu.v1";
const programme = "/products/reference-course/programme";
const lesson = `/materials/reference-lesson-5?from=${encodeURIComponent(programme)}`;

async function rejectMenuPersistence(page: Page, rejectReads = false) {
  // Synthetic native write fault in this document only; the second document and own modules stay real.
  await page.addInitScript(
    ({ key, rejectReads }) => {
      const local = localStorage;
      const session = sessionStorage;
      const writeLocal = local.setItem.bind(local);
      const writeSession = session.setItem.bind(session);
      const removeLocal = local.removeItem.bind(local);
      const removeSession = session.removeItem.bind(session);
      writeLocal(key, "collapsed");
      if (rejectReads) {
        const readLocal = local.getItem.bind(local);
        const readSession = session.getItem.bind(session);
        let unavailable = true;
        window.addEventListener(
          "course-menu-storage-read-recovered",
          () => {
            unavailable = false;
          },
          { once: true },
        );
        Storage.prototype.getItem = function (this: Storage, readKey: string) {
          if (this === local) {
            if (readKey === key && unavailable)
              throw new DOMException("Synthetic blocked read", "SecurityError");
            return readLocal(readKey);
          }
          if (this === session) return readSession(readKey);
          throw new TypeError("Unexpected native storage receiver");
        };
      }
      Storage.prototype.setItem = function (
        this: Storage,
        writtenKey: string,
        value: string,
      ) {
        if (this === local) {
          if (writtenKey === key)
            throw new DOMException("Synthetic blocked write", "SecurityError");
          writeLocal(writtenKey, value);
        } else if (this === session) {
          writeSession(writtenKey, value);
        } else throw new TypeError("Unexpected native storage receiver");
      };
      Storage.prototype.removeItem = function (
        this: Storage,
        removedKey: string,
      ) {
        if (this === local) {
          if (removedKey === key)
            throw new DOMException("Synthetic blocked write", "SecurityError");
          removeLocal(removedKey);
        } else if (this === session) {
          removeSession(removedKey);
        } else throw new TypeError("Unexpected native storage receiver");
      };
    },
    { key: menuKey, rejectReads },
  );
}

test("the course menu follows native storage changes and clear from another document", async ({
  page,
  context,
}, info) => {
  test.skip(
    info.project.name !== "desktop-chromium",
    "The collapsible lesson menu belongs to the desktop rail.",
  );
  await page.goto(lesson);
  const collapse = page.getByRole("button", { name: "Свернуть меню уроков" });
  const expand = page.getByRole("button", { name: "Развернуть меню уроков" });
  await expect(collapse).toBeVisible();
  const other = await context.newPage();
  try {
    await other.goto("/legal/privacy");
    await other.evaluate((key) => {
      localStorage.setItem(key, "collapsed");
    }, menuKey);
    await expect(expand).toBeVisible();
    await other.evaluate((key) => {
      localStorage.removeItem(key);
    }, menuKey);
    await expect(collapse).toBeVisible();
    await other.evaluate((key) => {
      localStorage.setItem(key, "collapsed");
    }, menuKey);
    await expect(expand).toBeVisible();
    await other.evaluate(() => {
      localStorage.clear();
    });
    await expect(collapse).toBeVisible();
  } finally {
    await other.close();
  }
});

test("a recovered storage read uses the changed native choice after a hidden menu", async ({
  page,
  context,
}, info) => {
  test.skip(
    info.project.name !== "desktop-chromium",
    "The collapsible lesson menu belongs to the desktop rail.",
  );
  await rejectMenuPersistence(page, true);
  await page.goto(lesson);
  const collapse = page.getByRole("button", { name: "Свернуть меню уроков" });
  const expand = page.getByRole("button", { name: "Развернуть меню уроков" });
  await expect(collapse).toBeVisible();
  await collapse.click();
  await expect(expand).toBeVisible();
  await page
    .getByRole("banner")
    .getByRole("link", { name: "sachkov.dev", exact: true })
    .click();
  await expect(page).toHaveURL("/");
  // End only the named synthetic read fault, then deliver a genuine other-document storage fact.
  await page.evaluate((key) => {
    window.dispatchEvent(new Event("course-menu-storage-read-recovered"));
    const observe = (event: StorageEvent) => {
      if (event.key !== key) return;
      document.documentElement.setAttribute(
        "data-course-menu-native-probe",
        String(event.isTrusted),
      );
      window.removeEventListener("storage", observe);
    };
    window.addEventListener("storage", observe);
  }, menuKey);
  const other = await context.newPage();
  try {
    await other.goto("/legal/privacy");
    await other.evaluate((key) => {
      localStorage.removeItem(key);
    }, menuKey);
    await expect(page.locator("html")).toHaveAttribute(
      "data-course-menu-native-probe",
      "true",
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-course-menu",
      "collapsed",
    );
    await page.goBack();
    await expect(page).toHaveURL(lesson);
    await expect(collapse).toBeVisible();
    expect(
      await page.evaluate((key) => localStorage.getItem(key), menuKey),
    ).toBeNull();
  } finally {
    await other.close();
  }
});

test("a changed persisted choice remains authoritative after a hidden menu and rejected local writes", async ({
  page,
  context,
}, info) => {
  test.skip(
    info.project.name !== "desktop-chromium",
    "The collapsible lesson menu belongs to the desktop rail.",
  );
  await rejectMenuPersistence(page);
  await page.goto(lesson);
  const collapse = page.getByRole("button", { name: "Свернуть меню уроков" });
  const expand = page.getByRole("button", { name: "Развернуть меню уроков" });
  await expect(expand).toBeVisible();
  await expand.click();
  await expect(collapse).toBeVisible();
  await collapse.click();
  await expect(expand).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), menuKey)).toBe(
    "collapsed",
  );
  await page
    .getByRole("banner")
    .getByRole("link", { name: "sachkov.dev", exact: true })
    .click();
  await expect(page).toHaveURL("/");
  await expect(expand).toBeHidden();
  // Observe the genuine native event before returning; the product menu's visible lease is absent.
  await page.evaluate((key) => {
    const observe = (event: StorageEvent) => {
      if (event.key !== key) return;
      document.documentElement.setAttribute(
        "data-course-menu-native-probe",
        String(event.isTrusted),
      );
      window.removeEventListener("storage", observe);
    };
    window.addEventListener("storage", observe);
  }, menuKey);
  const other = await context.newPage();
  try {
    await other.goto("/legal/privacy");
    await other.evaluate((key) => {
      localStorage.removeItem(key);
    }, menuKey);
    await expect(page.locator("html")).toHaveAttribute(
      "data-course-menu-native-probe",
      "true",
    );
    // The retained menu has released its listener, so the hidden choice has not been rewritten.
    await expect(page.locator("html")).toHaveAttribute(
      "data-course-menu",
      "collapsed",
    );
    await page.goBack();
    await expect(page).toHaveURL(lesson);
    await expect(collapse).toBeVisible();
    expect(
      await page.evaluate((key) => localStorage.getItem(key), menuKey),
    ).toBeNull();
  } finally {
    await other.close();
  }
});
