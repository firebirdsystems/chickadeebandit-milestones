import { describe, it, expect } from "vitest";
import {
  canonicalDate, formatOccurred, ageAt, canEdit, canDelete,
  activeSubjects, archivedSubjects, normalizeSelectedSubjectId,
  milestonesForActiveSubjects, unsavedFileIds,
  resolveSubject, sortTimeline, latestTimelinePage,
  timelinePageFromDescending, mergeTimelineRows, onThisDay,
  searchableFields, categoryIcon, todayStr,
} from "../src/logic.js";

const ADULT = { id: "a1", name: "Alex", role: "adult" };
const CHILD = { id: "c1", name: "Casey", role: "child" };

describe("canonicalDate", () => {
  it("keeps a full date at day precision", () => {
    expect(canonicalDate(2024, 3, 17, "day")).toBe("2024-03-17");
  });
  it("anchors month precision to the 1st", () => {
    expect(canonicalDate(2024, 3, 17, "month")).toBe("2024-03-01");
  });
  it("anchors year precision to Jan 1", () => {
    expect(canonicalDate(2024, 3, 17, "year")).toBe("2024-01-01");
  });
  it("zero-pads single-digit months and days", () => {
    expect(canonicalDate(2024, 3, 7, "day")).toBe("2024-03-07");
  });
  it("rejects days that do not exist in the selected month", () => {
    expect(() => canonicalDate(2024, 2, 31, "day")).toThrow("does not exist");
  });
  it("accepts leap day only in a leap year", () => {
    expect(canonicalDate(2024, 2, 29, "day")).toBe("2024-02-29");
    expect(() => canonicalDate(2023, 2, 29, "day")).toThrow("does not exist");
  });
  it("validates the year and precision", () => {
    expect(() => canonicalDate(1899, 1, 1, "day")).toThrow("1900 through 2200");
    expect(() => canonicalDate(2024, 1, 1, "week")).toThrow("precisely");
  });
});

describe("formatOccurred", () => {
  it("renders a full date at day precision", () => {
    expect(formatOccurred("2024-03-17", "day")).toBe("Mar 17, 2024");
  });
  it("hides the anchor day at month precision", () => {
    expect(formatOccurred("2024-03-01", "month")).toBe("Mar 2024");
  });
  it("hides month and day at year precision", () => {
    expect(formatOccurred("2024-01-01", "year")).toBe("2024");
  });
  it("returns empty for a missing date", () => {
    expect(formatOccurred("", "day")).toBe("");
  });
});

describe("todayStr", () => {
  it("uses local time, not UTC", () => {
    // 2024-03-17 21:30 local. toISOString() on this instant is the 18th in any
    // timezone west of ~UTC+2:30, which is the bug this guards.
    expect(todayStr(new Date(2024, 2, 17, 21, 30))).toBe("2024-03-17");
  });
  it("zero-pads", () => {
    expect(todayStr(new Date(2024, 0, 5))).toBe("2024-01-05");
  });
  it("uses the supplied household timezone instead of the device timezone", () => {
    const instant = new Date("2024-03-18T01:30:00Z");
    expect(todayStr(instant, "America/Denver")).toBe("2024-03-17");
    expect(todayStr(instant, "Asia/Tokyo")).toBe("2024-03-18");
  });
});

describe("ageAt", () => {
  it("reads in days under a month", () => {
    expect(ageAt("2024-03-01", "2024-03-15", "day")).toBe("14 days old");
  });
  it("singularizes one day", () => {
    expect(ageAt("2024-03-01", "2024-03-02", "day")).toBe("1 day old");
  });
  it("reads in months between one month and two years", () => {
    expect(ageAt("2023-01-10", "2024-03-15", "day")).toBe("14 months old");
  });
  it("does not round a partial month up", () => {
    // Born the 20th, milestone on the 5th — 13 whole months, not 14.
    expect(ageAt("2023-01-20", "2024-03-05", "day")).toBe("13 months old");
  });
  it("reads in years from two years up", () => {
    expect(ageAt("2018-06-01", "2024-09-01", "day")).toBe("6 years old");
  });
  it("is vague when the date is only known to the year", () => {
    expect(ageAt("2018-06-01", "2024-01-01", "year")).toBe("around 6");
  });
  it("never invents an exact day-age from a month anchor", () => {
    expect(ageAt("2024-03-31", "2024-04-01", "month")).toBe("around 1 month old");
    expect(ageAt("2024-03-15", "2024-03-01", "month")).toBe("under a month old");
  });
  it("uses approximate wording for older month-precision milestones", () => {
    expect(ageAt("2020-03-15", "2024-04-01", "month")).toBe("around 4 years old");
  });
  it("returns empty when the birth date is unknown", () => {
    expect(ageAt("", "2024-03-15", "day")).toBe("");
  });
  it("returns empty rather than a negative age", () => {
    expect(ageAt("2024-03-01", "2023-12-25", "day")).toBe("");
  });
});

describe("canEdit / canDelete mirror the row policy", () => {
  const mine   = { created_by: "c1" };
  const theirs = { created_by: "a1" };

  it("lets an author edit their own", () => {
    expect(canEdit(mine, CHILD)).toBe(true);
  });
  it("stops a child editing someone else's", () => {
    expect(canEdit(theirs, CHILD)).toBe(false);
  });
  it("lets an adult correct anyone's", () => {
    expect(canEdit(mine, ADULT)).toBe(true);
  });

  it("does NOT let a child delete their own — delete_adult_only", () => {
    expect(canDelete(mine, CHILD)).toBe(false);
  });
  it("lets an adult delete", () => {
    expect(canDelete(mine, ADULT)).toBe(true);
  });
});

describe("activeSubjects", () => {
  it("drops archived subjects and sorts by name", () => {
    const out = activeSubjects([
      { id: "2", name: "Rowan" },
      { id: "3", name: "Gone", archived_at: "2024-01-01T00:00:00Z" },
      { id: "1", name: "Avery" },
    ]);
    expect(out.map((s) => s.name)).toEqual(["Avery", "Rowan"]);
  });
  it("does not mutate its input", () => {
    const input = [{ id: "2", name: "Rowan" }, { id: "1", name: "Avery" }];
    activeSubjects(input);
    expect(input[0].name).toBe("Rowan");
  });
});

describe("archived subject state", () => {
  const subjects = [
    { id: "b", name: "Bea" },
    { id: "z", name: "Zoe", archived_at: "2024-01-01T00:00:00Z" },
    { id: "a", name: "Ari", archived_at: "2024-01-02T00:00:00Z" },
  ];

  it("lists archived subjects in name order", () => {
    expect(archivedSubjects(subjects).map((s) => s.id)).toEqual(["a", "z"]);
  });

  it("preserves a valid selection and the all-subject selection", () => {
    expect(normalizeSelectedSubjectId("b", subjects)).toBe("b");
    expect(normalizeSelectedSubjectId("all", subjects)).toBe("all");
  });

  it("falls back from a stale selection to the sole active subject", () => {
    expect(normalizeSelectedSubjectId("z", subjects)).toBe("b");
  });

  it("falls back from a stale selection to all when several subjects remain", () => {
    expect(normalizeSelectedSubjectId("missing", [...subjects, { id: "c", name: "Cal" }])).toBe("all");
  });
});

describe("milestonesForActiveSubjects", () => {
  it("excludes milestones for archived or missing subjects", () => {
    const subjects = [
      { id: "live", name: "Rowan" },
      { id: "gone", name: "Old", archived_at: "2024-01-01T00:00:00Z" },
    ];
    const rows = [
      { id: "shown", subject_id: "live" },
      { id: "archived", subject_id: "gone" },
      { id: "orphan", subject_id: "missing" },
    ];
    expect(milestonesForActiveSubjects(rows, subjects).map((m) => m.id)).toEqual(["shown"]);
  });
});

describe("attachment lifecycle", () => {
  it("identifies only newly uploaded files for cancellation cleanup", () => {
    expect(unsavedFileIds([
      { id: "saved", isNew: false },
      { id: "uploaded", isNew: true },
    ])).toEqual(["uploaded"]);
  });

});

describe("resolveSubject", () => {
  const members = [{ id: "m1", name: "Rowan Reyes", birthdate: "2019-04-02" }];

  it("prefers the roster name so a rename propagates", () => {
    const s = { member_id: "m1", name: "Rowan", birth_date: "" };
    expect(resolveSubject(s, members).name).toBe("Rowan Reyes");
  });
  it("falls back to the stored name for a subject with no account", () => {
    const s = { member_id: "", name: "Baby", birth_date: "2024-01-05" };
    expect(resolveSubject(s, members).name).toBe("Baby");
  });
  it("prefers the locally stored birth date, which survives the guest strip", () => {
    const s = { member_id: "m1", name: "Rowan", birth_date: "2019-04-02" };
    expect(resolveSubject(s, members).birthDate).toBe("2019-04-02");
  });
  it("falls back to the roster birthdate when there is no local one", () => {
    const s = { member_id: "m1", name: "Rowan", birth_date: "" };
    expect(resolveSubject(s, members).birthDate).toBe("2019-04-02");
  });
  it("yields no birth date when the roster stripped it and none is stored", () => {
    const s = { member_id: "m1", name: "Rowan", birth_date: "" };
    expect(resolveSubject(s, [{ id: "m1", name: "Rowan Reyes" }]).birthDate).toBe("");
  });
});

describe("sortTimeline", () => {
  it("orders oldest first", () => {
    const out = sortTimeline([
      { id: "b", occurred_date: "2024-01-01", created_at: "2024-01-01T00:00:00Z" },
      { id: "a", occurred_date: "2019-06-01", created_at: "2024-01-01T00:00:00Z" },
    ]);
    expect(out.map((m) => m.id)).toEqual(["a", "b"]);
  });
  it("breaks ties on the same date by when it was recorded", () => {
    const out = sortTimeline([
      { id: "second", occurred_date: "2024-01-01", created_at: "2024-05-02T00:00:00Z" },
      { id: "first",  occurred_date: "2024-01-01", created_at: "2024-05-01T00:00:00Z" },
    ]);
    expect(out.map((m) => m.id)).toEqual(["first", "second"]);
  });
  it("uses id as a stable final cursor tie-breaker", () => {
    const out = sortTimeline([
      { id: "b", occurred_date: "2024-01-01", created_at: "2024-05-01T00:00:00Z" },
      { id: "a", occurred_date: "2024-01-01", created_at: "2024-05-01T00:00:00Z" },
    ]);
    expect(out.map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("latestTimelinePage", () => {
  it("keeps the latest bounded window in ascending display order", () => {
    const rows = [1, 2, 3, 4, 5].map((id) => ({ id }));
    expect(latestTimelinePage(rows, 2)).toEqual({ items: [{ id: 4 }, { id: 5 }], hiddenCount: 3 });
  });
  it("returns the whole list when it fits", () => {
    const rows = [{ id: 1 }, { id: 2 }];
    expect(latestTimelinePage(rows, 10)).toEqual({ items: rows, hiddenCount: 0 });
  });
});

describe("database timeline pages", () => {
  const row = (id, date) => ({ id, occurred_date: date, created_at: `${date}T00:00:00Z` });

  it("uses a lookahead row without exposing it and restores ascending display order", () => {
    const out = timelinePageFromDescending([
      row("new", "2024-03-01"), row("middle", "2024-02-01"), row("lookahead", "2024-01-01"),
    ], 2);
    expect(out.items.map((item) => item.id)).toEqual(["middle", "new"]);
    expect(out.cursor.id).toBe("middle");
    expect(out.hasEarlier).toBe(true);
  });

  it("deduplicates rows seen across mutable cursor pages", () => {
    const out = mergeTimelineRows(
      [row("same", "2024-02-01"), row("new", "2024-03-01")],
      [{ ...row("same", "2024-02-01"), title: "fresh" }, row("old", "2024-01-01")],
    );
    expect(out.map((item) => item.id)).toEqual(["old", "same", "new"]);
    expect(out.find((item) => item.id === "same").title).toBe("fresh");
  });
});

describe("onThisDay", () => {
  const rows = [
    { id: "match",     occurred_date: "2019-03-17", date_precision: "day" },
    { id: "today",     occurred_date: "2024-03-17", date_precision: "day" },
    { id: "other-day", occurred_date: "2019-03-18", date_precision: "day" },
    { id: "vague",     occurred_date: "2019-01-01", date_precision: "year" },
  ];

  it("matches the same month and day in an earlier year", () => {
    expect(onThisDay(rows, "2024-03-17").map((m) => m.id)).toEqual(["match"]);
  });
  it("excludes today's own entry", () => {
    expect(onThisDay(rows, "2024-03-17").some((m) => m.id === "today")).toBe(false);
  });
  it("excludes a future milestone on the same month and day", () => {
    const future = { id: "future", occurred_date: "2025-03-17", date_precision: "day" };
    expect(onThisDay([...rows, future], "2024-03-17").some((m) => m.id === "future")).toBe(false);
  });
  it("never surfaces year-precision rows on January 1st", () => {
    // The whole reason the glance filters date_precision = 'day': year
    // precision anchors to Jan 1, so without the filter every vague milestone
    // the household ever recorded would light up every New Year's Day.
    expect(onThisDay(rows, "2024-01-01")).toEqual([]);
  });
});

describe("searchableFields", () => {
  it("includes the title, note and subject name", () => {
    const f = searchableFields({ title: "First steps", note: "in the hallway" }, "Rowan");
    expect(f).toEqual(["First steps", "in the hallway", "Rowan"]);
  });
});

describe("categoryIcon", () => {
  it("resolves a known category", () => expect(categoryIcon("school")).toBe("🎒"));
  it("falls back for an unknown one", () => expect(categoryIcon("nope")).toBe("🌱"));
});
