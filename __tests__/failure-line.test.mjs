import { describe, it, expect } from "vitest";
import { failureLine, uploadFailureLine } from "../src/logic.js";

const err = (props, message = "hub text") => Object.assign(new Error(message), props);
const words = { action: "save the milestone", thing: "milestone" };

describe("failureLine", () => {
  it("names a duplicate by code, or by the hub's text as a fallback", () => {
    expect(failureLine(err({ status: 400, code: "UNIQUE_CONSTRAINT" }), words)).toBe("That milestone already exists.");
    expect(failureLine(err({ status: 400 }, "UNIQUE constraint failed: x.id"), words)).toBe("That milestone already exists.");
  });
  it("names a refusal without asking for a retry", () => {
    expect(failureLine(err({ status: 403 }), words)).toBe("You don’t have permission to save the milestone.");
    expect(failureLine(err({ status: 507 }), words)).toBe("The household’s storage is full — free up space first.");
  });
  it("asks for a wait on a rate limit", () => {
    expect(failureLine(err({ status: 429 }), words)).toBe("Too many tries — wait a minute and try again.");
  });
  it("splits a write that changed nothing by the caller's re-read", () => {
    expect(failureLine(null, { ...words, found: false })).toBe("This milestone has been removed.");
    expect(failureLine(null, { ...words, found: true, guarded: true })).toBe("This milestone was changed by someone else — check it first.");
    expect(failureLine(err({ status: 409 }), { ...words, found: false })).toBe("This milestone has been removed.");
  });
  it("reads a row still there after a plain WHERE id = ? write as the row policy refusing it", () => {
    expect(failureLine(null, { ...words, found: true })).toBe("You don’t have permission to save the milestone.");
  });
  it("says neither removed nor changed when the re-read itself failed", () => {
    expect(failureLine(null, { ...words, found: null })).toBe("Couldn’t save the milestone — try again.");
    expect(failureLine(null, { ...words, found: null, guarded: true })).toBe("Couldn’t save the milestone — try again.");
  });
  it("reads a 404 as removed and a bare 409 as changed when there is no re-read", () => {
    expect(failureLine(err({ status: 404 }), words)).toBe("This milestone has been removed.");
    expect(failureLine(err({ status: 409 }), words)).toBe("This milestone was changed by someone else — check it first.");
  });
  it("asks for a retry only when retrying can work", () => {
    for (const e of [err({}), err({ status: 500 }), err({ status: 503 }), err({ status: 400 }), new TypeError("Failed to fetch"), undefined]) {
      expect(failureLine(e, words)).toBe("Couldn’t save the milestone — try again.");
    }
  });
  it("keeps a line the app wrote for the user, and never shows hub text", () => {
    expect(failureLine(err({ forUser: true }, "Pick one first."), words)).toBe("Pick one first.");
    expect(failureLine(err({ status: 500 }, "D1_ERROR: boom"), words)).not.toMatch(/D1_ERROR/);
    expect(failureLine(new TypeError("Failed to fetch"), words)).not.toMatch(/Failed to fetch/);
  });
});

describe("uploadFailureLine", () => {
  const up = { action: "upload the photo", thing: "file" };
  it("names the file's own refusals, never in the hub's words", () => {
    expect(uploadFailureLine(err({ status: 413 }, "File too large (max 10 MB)"), up)).toBe("That file is too large.");
    expect(uploadFailureLine(err({ status: 415 }, "File type not allowed: x"), up)).toBe("That kind of file can’t be uploaded.");
  });
  it("gives the rest the template's lines", () => {
    expect(uploadFailureLine(err({ status: 403 }), up)).toBe("You don’t have permission to upload the photo.");
    expect(uploadFailureLine(err({ status: 429 }, "Too many requests"), up)).toBe("Too many tries — wait a minute and try again.");
    expect(uploadFailureLine(err({ status: 507 }, "Storage limit exceeded"), up)).toBe("The household’s storage is full — free up space first.");
    for (const e of [err({ status: 0 }, "Network error"), err({ status: 400 }), err({ status: 502 }), new TypeError("Failed to fetch")]) {
      expect(uploadFailureLine(e, up)).toBe("Couldn’t upload the photo — try again.");
    }
  });
});
