import {
  chromium,
  expect as playwrightExpect,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertBetterSqliteLoads,
  assertSqliteTable,
  buildGeneratedProject,
  cleanupProject,
  createTempProject,
  runDrizzleMigrationCycle,
  scaffoldProject,
  startBuiltServer,
  stopServer,
  writeLibraryCatalogSchema,
  type E2eProject,
  type StartedServer,
} from "./harness.js";

const USER = {
  name: "Ava Librarian",
  email: "ava.librarian@example.test",
  password: "LibraryCatalogE2ePassword1!",
} as const;

const BOOK = {
  title: "The Left Hand of Darkness",
  author: "Ursula K. Le Guin",
  isbn: "9780441478125",
  copiesAvailable: "3",
} as const;

describe.sequential("generated app browser workflow - end-to-end", () => {
  let project: E2eProject | undefined;
  let server: StartedServer | undefined;
  let browser: Browser | undefined;

  beforeAll(async () => {
    project = createTempProject({ prefix: "sapporta-browser-e2e-" });
    await scaffoldProject(project);
    await assertBetterSqliteLoads(project);
    writeLibraryCatalogSchema(project.projectDir);
    await runDrizzleMigrationCycle(project, "library_catalog");
    await assertSqliteTable(project, "library_books", [
      "id",
      "title",
      "author",
      "isbn",
      "copies_available",
      "workspace_id",
    ]);
    await buildGeneratedProject(project);
    server = await startBuiltServer(project, {
      SAPPORTA_MAIL_TRANSPORT: "stream",
      SAPPORTA_REQUIRE_VERIFIED_EMAIL: "true",
    });
    browser = await chromium.launch({ headless: true });
  }, 420_000);

  afterAll(async () => {
    await browser?.close();
    stopServer(server);
    cleanupProject(project);
  });

  it("signs up, verifies email, signs in, creates a book, and edits it in the grid", async () => {
    const context = await browser!.newContext({
      baseURL: server!.baseUrl,
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    try {
      // `/` is gated: an anonymous visitor never reaches the home page. The
      // first visitor to an app without accounts continues to sign-up.
      await page.goto("/");
      await expectHeading(page, "Sign up and create your first workspace");

      await page.goto("/public");
      await playwrightExpect(
        page.getByText("This page is available without signing in."),
      ).toBeVisible();
      await playwrightExpect(
        page.locator("[data-sidebar-region]"),
      ).toHaveCount(0);

      await page.goto("/signup");
      await expectHeading(page, "Sign up and create your first workspace");
      await page.getByLabel("Name").fill(USER.name);
      await page.getByLabel("Email").fill(USER.email);
      await page.getByLabel("Password").fill(USER.password);
      await page.getByRole("button", { name: "Create account" }).click();

      await page.waitForURL("**/verify-email");
      await expectHeading(page, "Verify your email");
      await playwrightExpect(
        page.getByText("Check your inbox for a verification link."),
      ).toBeVisible();

      const verificationUrl = await waitForVerificationUrl(server!, USER.email);
      await page.goto(verificationUrl);
      await playwrightExpect(
        page.getByText("Email verified. Taking you back..."),
      ).toBeVisible();
      await waitForHomePage(page);

      await signInWithPassword(page);
      await verifyResponsiveSidebar(page);
      await page
        .getByRole("button", { name: `Open account menu for ${USER.name}` })
        .click();
      await page.getByRole("button", { name: "Profile" }).click();
      await page.waitForURL("**/account/profile");
      await expectHeading(page, "Account profile");
      const profile = page.getByRole("main");
      await expectProfileRow(profile, "Name", USER.name);
      await expectProfileRow(profile, "Email", USER.email);
      await expectProfileRow(profile, "Email status", "Verified");

      await signInWithPassword(page);
      await page.getByRole("link", { name: "Library Books" }).click();
      await page.waitForURL("**/tables/library_books");
      await expectMainText(page, "Library Books");
      await page.getByRole("button", { name: "New record" }).click();
      await page.waitForURL("**/tables/library_books/new");
      await expectMainText(page, "New record");

      await page.locator("#field-title").fill(BOOK.title);
      await page.locator("#field-author").fill(BOOK.author);
      await page.locator("#field-isbn").fill(BOOK.isbn);
      await page.locator("#field-copies_available").fill(BOOK.copiesAvailable);
      await page.getByRole("button", { name: "Create", exact: true }).click();

      await page.waitForURL("**/tables/library_books");
      const bookRow = page
        .locator('[data-grid-part="row"][data-row-kind="data"]')
        .filter({ hasText: BOOK.title });
      await playwrightExpect(bookRow).toBeVisible();
      await playwrightExpect(bookRow).toContainText(BOOK.author);
      await playwrightExpect(bookRow).toContainText(BOOK.isbn);
      await playwrightExpect(
        bookRow.locator(
          '[data-grid-part="cell"][data-col-id="copies_available"]',
        ),
      ).toHaveText(BOOK.copiesAvailable);

      const copiesCell = bookRow.locator(
        '[data-grid-part="cell"][data-col-id="copies_available"]',
      );
      await copiesCell.dblclick();
      const editor = page.locator('[data-grid-part="editor-input"]');
      await playwrightExpect(editor).toBeVisible();
      await editor.fill("5");
      const saved = page.waitForResponse(
        (response) =>
          response.request().method() === "PUT" &&
          /\/api\/tables\/library_books\/[^/]+$/.test(response.url()),
      );
      await editor.press("Enter");
      expect((await saved).ok()).toBe(true);
      await playwrightExpect(copiesCell).toHaveText("5");

      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  }, 120_000);
});

async function signInWithPassword(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto("/");
  await expectHeading(page, "Sign in");
  await page.getByLabel("Email").fill(USER.email);
  await page.getByLabel("Password").fill(USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await waitForHomePage(page);
}

async function waitForHomePage(page: Page): Promise<void> {
  await page.waitForURL((url) => url.pathname === "/");
  await expectHeading(page, "Welcome to your new Sapporta project");
}

async function verifyResponsiveSidebar(page: Page): Promise<void> {
  const region = page.locator("[data-sidebar-region]");
  const surface = page.locator("[data-sidebar-surface]");

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await playwrightExpect(region).toHaveAttribute(
    "data-sidebar-state",
    "collapsed",
  );
  // The click leaves the pointer inside the sidebar area, and a fine pointer
  // hovering the collapsed region intentionally keeps the surface revealed.
  // Move onto the content area so the sidebar tucks away.
  await page.mouse.move(700, 300);
  await playwrightExpect(surface).toBeHidden();

  await page.mouse.move(4, 300);
  await playwrightExpect(surface).toBeVisible();
  await page.getByRole("main").hover({ position: { x: 500, y: 300 } });
  await playwrightExpect(surface).toBeHidden();

  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await playwrightExpect(region).toHaveAttribute(
    "data-sidebar-state",
    "expanded",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  const openDrawer = page.getByRole("button", { name: "Open sidebar" });
  await openDrawer.click();
  await playwrightExpect(page.locator("[data-sidebar-drawer]")).toBeVisible();
  await page.keyboard.press("Escape");
  await playwrightExpect(openDrawer).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await playwrightExpect(
    page.getByRole("button", { name: "Collapse sidebar" }),
  ).toBeVisible();
}

async function expectHeading(page: Page, name: string): Promise<void> {
  await playwrightExpect(
    page.getByRole("heading", { name, exact: true }),
  ).toBeVisible();
}

async function expectMainText(page: Page, text: string): Promise<void> {
  await playwrightExpect(
    page.getByRole("main").getByText(text, { exact: true }),
  ).toBeVisible();
}

async function expectProfileRow(
  profile: Locator,
  label: string,
  value: string,
): Promise<void> {
  const row = profile.getByText(label, { exact: true }).locator("..");
  await playwrightExpect(row).toContainText(value);
}

async function waitForVerificationUrl(
  server: StartedServer,
  email: string,
): Promise<string> {
  const deadline = Date.now() + 10_000;
  const escapedEmail = escapeRegExp(email);
  const messagePattern = new RegExp(
    `To: ${escapedEmail}[\\s\\S]*?(https?://[^\\s<"]+/verify-email\\?token=[^\\s<"]+)`,
  );

  while (Date.now() < deadline) {
    const match = server.output.join("").match(messagePattern);
    if (match?.[1]) return match[1].replaceAll("&amp;", "&");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(
    [
      `Timed out waiting for the verification email sent to ${email}.`,
      "Server output:",
      server.output.join(""),
    ].join("\n"),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
