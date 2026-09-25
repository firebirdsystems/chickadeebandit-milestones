import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";
import { CATEGORIES, canShareMilestone } from "../src/logic.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, "../manifest.json"), "utf-8"));
const page = readFileSync(join(__dirname, "../src/index.html"), "utf-8");

const item = manifest.shareable?.milestone;

/**
 * A share link is an anonymous read that skips row policies, so the declared
 * columns are the whole public surface. These pin that surface to what the
 * panel tells the adult minting the link: title, story, kind and photos.
 */
describe("shareable.milestone", () => {
  it("anchors on the milestones table by id", () => {
    expect(Object.keys(manifest.shareable)).toEqual(["milestone"]);
    expect(item.table).toBe("milestones");
    expect(item.id_column ?? "id").toBe("id");
    expect(item.title_column).toBe("title");
  });

  it("projects exactly the story and the kind", () => {
    expect(item.columns.map((c) => c.column)).toEqual(["note", "category"]);
  });

  // Who it's about: a person row carries its own visibility ("private" people
  // exist), and a lookup from the public page could not respect that — so the
  // people join is left out entirely. The date: occurred_date is always stored
  // as a full yyyy-mm-dd even when date_precision is month or year, so printing
  // it would state a day nobody ever knew. The panel tells the sharer to put
  // either in the story if they want it on the page.
  it("never reaches who it is about, when it happened, or who wrote it", () => {
    const text = JSON.stringify(item);
    for (const s of ["occurred_date", "date_precision", "milestone_people", "people", "person_id", "created_by"]) {
      expect(text).not.toContain(s);
    }
  });

  it("labels each kind the way the app does", () => {
    const kind = item.columns.find((c) => c.column === "category");
    expect(kind.value_labels).toEqual(Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label])));
  });

  it("shows only milestones the whole household can see", () => {
    expect(item.visible_where).toEqual({ column: "visibility", values: ["everyone"] });
  });

  // No file_acls.read: the public page serves every photo on the row. Adding a
  // read ACL (e.g. uploader-only) would hide photos uploaded by anyone other
  // than the adult who made the link.
  it("carries the photos from file_ids, with no file read ACL", () => {
    expect(item.files.ids_column).toBe("file_ids");
    expect(manifest.file_acls?.read).toBeUndefined();
  });

  it("is read-only: no submit form, feed or aggregates", () => {
    expect(item.submit).toBeUndefined();
    expect(item.feed).toBeUndefined();
    expect(item.aggregates).toBeUndefined();
  });

  it("is the item type the page mints", () => {
    expect(page).toMatch(/itemType:\s*"milestone"/);
  });

  it("tells the sharer that who and when stay in the household", () => {
    const scope = page.match(/scopeHtml:\s*\(\)\s*=>\s*"([^"]+)"/)?.[1] ?? "";
    expect(scope).toMatch(/Who it’s about and when it happened stay in the household/);
  });
});

// The mint only checks the row exists; visible_where is applied on read. A
// private milestone must never get a Share button, or it mints a dead link.
describe("canShareMilestone", () => {
  it("offers milestones everyone can see", () => {
    expect(canShareMilestone({ id: "m1", visibility: "everyone" })).toBe(true);
  });

  it("never offers private ones", () => {
    expect(canShareMilestone({ id: "m1", visibility: "private" })).toBe(false);
  });

  it("treats a missing row or visibility as not shareable", () => {
    expect(canShareMilestone(null)).toBe(false);
    expect(canShareMilestone({ id: "m1" })).toBe(false);
  });
});
