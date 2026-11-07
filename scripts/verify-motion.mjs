import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// Prerequisite: npm ci (Playwright is a development dependency).
// Start the unconfigured local app on port 3000, then run node scripts/verify-motion.mjs.
// Uses an isolated context: all created records stay in this disposable browser.
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await mkdir(".next/qa", { recursive: true });
try {
  await page.goto("http://127.0.0.1:3000/");
  await page.getByRole("button", { name: "New report", exact: true }).waitFor();
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await page.getByRole("textbox", { name: "Project name", exact: true }).fill("Motion QA");
  await page.getByRole("dialog", { name: "New project", exact: true }).getByRole("button", { name: "Create project", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByText("Project created.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "New report", exact: true }).click();
  let modal = page.getByRole("dialog", { name: "Add a report", exact: true });
  await modal.getByRole("textbox", { name: "Title", exact: true }).fill("Check workspace motion");
  await modal.getByRole("textbox", { name: "Details (optional)", exact: true }).fill("Isolated browser verification.");
  await modal.getByRole("combobox", { name: "Report type", exact: true }).selectOption("Bug report");
  await modal.getByRole("combobox", { name: "Project", exact: true }).selectOption({ label: "Motion QA" });
  await modal.getByRole("button", { name: "Save report", exact: true }).click();
  await modal.waitFor({ state: "hidden" });
  await page.getByText("Report created.", { exact: true }).waitFor();
  await page.getByRole("button", { name: /Check workspace motion.*Open/ }).click();
  modal = page.getByRole("dialog", { name: "Report details", exact: true });
  await modal.getByRole("button", { name: "Edit report", exact: true }).click();
  modal = page.getByRole("dialog", { name: "Edit report", exact: true });
  await modal.getByRole("textbox", { name: "Title", exact: true }).fill("Verified workspace motion");
  await modal.getByRole("button", { name: "Save report", exact: true }).click();
  await modal.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Verified workspace motion completed", exact: true }).click();
  await page.getByText("Report marked done.", { exact: true }).waitFor();
  const search = page.getByRole("searchbox", { name: "Search reports", exact: true });
  await search.fill("no-match");
  await page.getByRole("heading", { name: "No matching reports" }).waitFor();
  await search.press("Escape");
  assert.equal(await search.inputValue(), "");
  assert.equal(await search.evaluate(el => el === document.activeElement), true);
  await page.screenshot({ path: ".next/qa/motion-desktop.png", fullPage: true });

  await page.getByRole("button", { name: "Clients", exact: true }).click();
  await page.getByRole("button", { name: "New product", exact: true }).click();
  modal = page.getByRole("dialog", { name: "New product", exact: true });
  await modal.getByRole("textbox", { name: "Product name", exact: true }).fill("QA Product");
  await modal.getByRole("button", { name: "Create product", exact: true }).click();
  await modal.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Add client", exact: true }).click();
  modal = page.getByRole("dialog", { name: "Add client", exact: true });
  await modal.getByRole("textbox", { name: "Company name", exact: true }).fill("QA Company");
  await modal.getByRole("checkbox", { name: "QA Product", exact: true }).check();
  await modal.getByRole("button", { name: "Save client", exact: true }).click();
  await modal.waitFor({ state: "hidden" });
  await page.getByText("Client added.", { exact: true }).waitFor();
  await page.getByRole("button", { name: /QA Company/ }).click();
  modal = page.getByRole("dialog", { name: "Client details", exact: true });
  await modal.getByRole("button", { name: "Close client", exact: true }).press("Escape");
  await modal.waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("button", { name: /QA Company/ }).evaluate(el => el === document.activeElement), true);

  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.getByRole("button", { name: "Open my profile", exact: true }).click();
  modal = page.getByRole("dialog", { name: "My profile", exact: true });
  await modal.getByRole("textbox", { name: "Name", exact: true }).fill("QA Member");
  await modal.getByRole("button", { name: "Save profile", exact: true }).click();
  await modal.getByText("Profile saved.", { exact: true }).waitFor();
  await modal.getByRole("button", { name: "Close profile", exact: true }).press("Escape");
  await modal.waitFor({ state: "hidden" });
  await page.screenshot({ path: ".next/qa/motion-mobile.png", fullPage: true });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Reports 1", exact: true }).click();
  await page.getByRole("button", { name: "New report", exact: true }).click();
  modal = page.getByRole("dialog", { name: "Add a report", exact: true });
  assert.equal(await modal.evaluate(el => getComputedStyle(el).transitionDuration), "0s");
  await modal.getByRole("button", { name: "Close", exact: true }).press("Escape");
  await modal.waitFor({ state: "hidden" });
  await search.fill("no-match");
  await page.getByRole("heading", { name: "No matching reports" }).waitFor();
  assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running").length), 0);
  assert.deepEqual(errors, []);
  console.log("PASS: report create/edit/status/search, client/product creation, drawer Escape and focus return, profile save, 375px overflow, reduced motion, no page errors.");
} catch (error) {
  await page.screenshot({ path: ".next/qa/motion-failure.png", fullPage: true });
  console.error(await page.locator("body").innerText());
  throw error;
} finally {
  await context.close();
  await browser.close();
}
