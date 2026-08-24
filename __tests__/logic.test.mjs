import { describe, it, expect } from "vitest";
import {
  canonicalDate, formatOccurred, ageAt, canEdit, canDelete,
  activePeople, archivedPeople, normalizeSelectedPersonId,
  linksByMilestone, personIdsFor, isVisibleMilestone, visibleMilestonesFor,
  filterByPerson, attachmentDelta, blockedRemovals, attachablePeople,
  chunk, attachmentBatchPlan,
  peopleOnMilestone, describePeople, unsavedFileIds,
  resolvePerson, sortTimeline, latestTimelinePage,
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

describe("activePeople", () => {
  it("drops archived people and sorts by name", () => {
    const out = activePeople([
      { id: "2", name: "Rowan" },
      { id: "3", name: "Gone", archived_at: "2024-01-01T00:00:00Z" },
      { id: "1", name: "Avery" },
    ]);
    expect(out.map((s) => s.name)).toEqual(["Avery", "Rowan"]);
  });
  it("does not mutate its input", () => {
    const input = [{ id: "2", name: "Rowan" }, { id: "1", name: "Avery" }];
    activePeople(input);
    expect(input[0].name).toBe("Rowan");
  });
});

describe("archived people state", () => {
  const people = [
    { id: "b", name: "Bea" },
    { id: "z", name: "Zoe", archived_at: "2024-01-01T00:00:00Z" },
    { id: "a", name: "Ari", archived_at: "2024-01-02T00:00:00Z" },
  ];

  it("lists archived people in name order", () => {
    expect(archivedPeople(people).map((s) => s.id)).toEqual(["a", "z"]);
  });

  it("preserves a valid selection", () => {
    expect(normalizeSelectedPersonId("b", people)).toBe("b");
  });

  it("keeps the two selections that are not people", () => {
    // "household" is a filter, not a person, so nothing can archive it away.
    expect(normalizeSelectedPersonId("all", people)).toBe("all");
    expect(normalizeSelectedPersonId("household", [])).toBe("household");
  });

  it("falls back from a stale selection to everything", () => {
    expect(normalizeSelectedPersonId("z", people)).toBe("all");
    expect(normalizeSelectedPersonId("missing", people)).toBe("all");
  });
});

describe("attachments", () => {
  const people = [
    { id: "live", name: "Rowan" },
    { id: "also", name: "Avery" },
    { id: "gone", name: "Old", archived_at: "2024-01-01T00:00:00Z" },
  ];
  const links = [
    { id: "l1", milestone_id: "shared", person_id: "live", written_by: "a1" },
    { id: "l2", milestone_id: "shared", person_id: "also", written_by: "a1" },
    { id: "l3", milestone_id: "archived-only", person_id: "gone", written_by: "a1" },
    { id: "l4", milestone_id: "one", person_id: "live", written_by: "c1" },
  ];
  const index = linksByMilestone(links);
  const rows = [
    { id: "household" },        // no attachments at all
    { id: "shared" },
    { id: "archived-only" },
    { id: "one" },
  ];

  it("groups person ids by milestone", () => {
    expect(personIdsFor(index, "shared")).toEqual(["live", "also"]);
    expect(personIdsFor(index, "household")).toEqual([]);
  });

  it("does not double a person seen on two cursor pages", () => {
    const dup = linksByMilestone([...links, { id: "l1b", milestone_id: "shared", person_id: "live" }]);
    expect(personIdsFor(dup, "shared")).toEqual(["live", "also"]);
  });

  it("always shows a milestone that is about nobody in particular", () => {
    // The whole reason the join table exists: "we got the keys" is not a
    // person's timeline entry and must not need a person to stay visible.
    expect(isVisibleMilestone({ id: "household" }, index, people)).toBe(true);
  });

  it("hides a milestone once every person it names is archived", () => {
    expect(isVisibleMilestone({ id: "archived-only" }, index, people)).toBe(false);
  });

  it("keeps a milestone that still names someone active", () => {
    const half = linksByMilestone([
      { id: "x", milestone_id: "m", person_id: "live" },
      { id: "y", milestone_id: "m", person_id: "gone" },
    ]);
    expect(isVisibleMilestone({ id: "m" }, half, people)).toBe(true);
  });

  it("filters the timeline to one chip", () => {
    const shown = visibleMilestonesFor(rows, index, people);
    expect(shown.map((m) => m.id)).toEqual(["household", "shared", "one"]);
    expect(filterByPerson(shown, index, "all").map((m) => m.id)).toEqual(["household", "shared", "one"]);
    expect(filterByPerson(shown, index, "household").map((m) => m.id)).toEqual(["household"]);
    expect(filterByPerson(shown, index, "also").map((m) => m.id)).toEqual(["shared"]);
  });
});

describe("attachmentDelta", () => {
  const current = [
    { id: "l1", person_id: "a", written_by: "a1" },
    { id: "l2", person_id: "b", written_by: "a1" },
  ];

  it("adds only what is new and removes only what is gone", () => {
    const out = attachmentDelta(current, ["b", "c"]);
    expect(out.add).toEqual(["c"]);
    expect(out.remove.map((l) => l.id)).toEqual(["l1"]);
  });

  it("removes everything when a milestone becomes a household one", () => {
    expect(attachmentDelta(current, []).remove.map((l) => l.id)).toEqual(["l1", "l2"]);
  });

  it("is a no-op when nothing changed", () => {
    expect(attachmentDelta(current, ["a", "b"])).toEqual({ add: [], remove: [] });
  });

  it("returns rows, not ids, so the caller can read written_by", () => {
    expect(attachmentDelta(current, []).remove[0].written_by).toBe("a1");
  });
});

describe("attachablePeople", () => {
  const people = [
    { id: "live", name: "Rowan" },
    { id: "also", name: "Avery" },
    { id: "gone", name: "Old", archived_at: "2024-01-01T00:00:00Z" },
    { id: "other-gone", name: "Older", archived_at: "2024-01-01T00:00:00Z" },
  ];

  it("offers the active people, name-ordered", () => {
    expect(attachablePeople(people, []).map((e) => e.person.id)).toEqual(["also", "live"]);
  });

  it("also offers an archived person this milestone already names", () => {
    // Without this the archived attachment would have no checkbox, submitting
    // would read it as unticked, and the association would be lost for good —
    // restoring the person would not bring it back.
    const out = attachablePeople(people, ["gone"]);
    expect(out.map((e) => e.person.id)).toEqual(["also", "gone", "live"]);
    expect(out.find((e) => e.person.id === "gone").archived).toBe(true);
    expect(out.find((e) => e.person.id === "live").archived).toBe(false);
  });

  it("does not offer an archived person this milestone does not name", () => {
    expect(attachablePeople(people, ["gone"]).some((e) => e.person.id === "other-gone")).toBe(false);
  });

  it("keeps an archived attachment through an unrelated edit", () => {
    // The form pre-ticks every attached id, so a save that changed only the
    // title submits the same set back and the delta is empty.
    const attached = ["live", "gone"];
    const ticked = attachablePeople(people, attached)
      .filter((e) => attached.includes(e.person.id))
      .map((e) => e.person.id);
    const current = attached.map((id) => ({ id: `l-${id}`, person_id: id, written_by: "a1" }));
    expect(attachmentDelta(current, ticked)).toEqual({ add: [], remove: [] });
  });

  it("still lets an archived attachment be removed on purpose", () => {
    const current = [
      { id: "l-live", person_id: "live", written_by: "a1" },
      { id: "l-gone", person_id: "gone", written_by: "a1" },
    ];
    expect(attachmentDelta(current, ["live"]).remove.map((l) => l.id)).toEqual(["l-gone"]);
  });
});

describe("attachmentBatchPlan", () => {
  // The numbers the app actually uses: D1 rejects a statement carrying more
  // than ~100 bound parameters, and an attachment row costs five of them.
  const MAX = 90;
  const COLS = 5;
  const ids = (n, prefix) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

  it("splits a list into consecutive groups", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });

  it("leaves an ordinary milestone as a single group of each", () => {
    const plan = attachmentBatchPlan(ids(3, "a"), ids(2, "r"), MAX, COLS);
    expect(plan.insertGroups).toHaveLength(1);
    expect(plan.removalGroups).toHaveLength(1);
  });

  it("never builds an insert past the parameter budget", () => {
    // 21 additions is 105 bound parameters in one statement — over the limit,
    // and the app allows up to 200 people on one milestone.
    const plan = attachmentBatchPlan(ids(200, "a"), [], MAX, COLS);
    for (const group of plan.insertGroups) {
      expect(group.length * COLS).toBeLessThanOrEqual(MAX);
    }
    expect(plan.insertGroups.flat()).toEqual(ids(200, "a"));
  });

  it("never builds a removal past the parameter budget", () => {
    const plan = attachmentBatchPlan([], ids(200, "r"), MAX, COLS);
    for (const group of plan.removalGroups) {
      expect(group.length).toBeLessThanOrEqual(MAX);
    }
    expect(plan.removalGroups.flat()).toEqual(ids(200, "r"));
  });

  it("loses nothing and reorders nothing when it splits", () => {
    const plan = attachmentBatchPlan(ids(47, "a"), ids(131, "r"), MAX, COLS);
    expect(plan.insertGroups.flat()).toEqual(ids(47, "a"));
    expect(plan.removalGroups.flat()).toEqual(ids(131, "r"));
  });
});

describe("blockedRemovals", () => {
  const mine   = { id: "l1", person_id: "a", written_by: "c1" };
  const theirs = { id: "l2", person_id: "b", written_by: "a1" };

  it("lets an adult remove anyone's attachment", () => {
    expect(blockedRemovals([mine, theirs], ADULT)).toEqual([]);
  });

  it("lets a child remove the ones they wrote", () => {
    expect(blockedRemovals([mine], CHILD)).toEqual([]);
  });

  it("catches the row policy a child's DELETE would silently miss", () => {
    // canEdit lets the author of a milestone edit it; inherit_visibility lets a
    // non-adult delete only rows they wrote. Where the two disagree the DELETE
    // matches nothing instead of failing, so this is pre-flighted.
    expect(blockedRemovals([mine, theirs], CHILD).map((l) => l.id)).toEqual(["l2"]);
  });
});

describe("peopleOnMilestone / describePeople", () => {
  const members = [{ id: "m1", name: "Rowan Reyes" }];
  const people = [
    { id: "p1", member_id: "m1", name: "Rowan", birth_date: "2019-04-02" },
    { id: "p2", member_id: "", name: "Avery", birth_date: "2016-01-10" },
    { id: "p3", member_id: "", name: "Gone", birth_date: "", archived_at: "2024-01-01T00:00:00Z" },
  ];
  const milestone = { id: "m", occurred_date: "2024-09-03", date_precision: "day" };
  const index = linksByMilestone([
    { id: "l1", milestone_id: "m", person_id: "p1" },
    { id: "l2", milestone_id: "m", person_id: "p2" },
    { id: "l3", milestone_id: "m", person_id: "p3" },
  ]);

  it("ages each person separately", () => {
    // The point of attaching more than one: siblings share a first day of
    // school and were not the same age on it.
    expect(peopleOnMilestone(milestone, index, people, members)).toEqual([
      { id: "p2", name: "Avery", age: "8 years old" },
      { id: "p1", name: "Rowan Reyes", age: "5 years old" },
    ]);
  });

  it("drops archived people from the entry", () => {
    expect(peopleOnMilestone(milestone, index, people, members).some((e) => e.id === "p3")).toBe(false);
  });

  it("reads as a list, and as nothing at all for a household milestone", () => {
    expect(describePeople(peopleOnMilestone(milestone, index, people, members)))
      .toBe("Avery, 8 years old · Rowan Reyes, 5 years old");
    expect(describePeople([])).toBe("");
  });

  it("names someone with no birthday without inventing an age", () => {
    expect(describePeople([{ id: "x", name: "Rowan", age: "" }])).toBe("Rowan");
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

describe("resolvePerson", () => {
  const members = [{ id: "m1", name: "Rowan Reyes", birthdate: "2019-04-02" }];

  it("prefers the roster name so a rename propagates", () => {
    const s = { member_id: "m1", name: "Rowan", birth_date: "" };
    expect(resolvePerson(s, members).name).toBe("Rowan Reyes");
  });
  it("falls back to the stored name for someone with no account", () => {
    const s = { member_id: "", name: "Baby", birth_date: "2024-01-05" };
    expect(resolvePerson(s, members).name).toBe("Baby");
  });
  it("prefers the locally stored birth date, which survives the guest strip", () => {
    const s = { member_id: "m1", name: "Rowan", birth_date: "2019-04-02" };
    expect(resolvePerson(s, members).birthDate).toBe("2019-04-02");
  });
  it("falls back to the roster birthdate when there is no local one", () => {
    const s = { member_id: "m1", name: "Rowan", birth_date: "" };
    expect(resolvePerson(s, members).birthDate).toBe("2019-04-02");
  });
  it("yields no birth date when the roster stripped it and none is stored", () => {
    const s = { member_id: "m1", name: "Rowan", birth_date: "" };
    expect(resolvePerson(s, [{ id: "m1", name: "Rowan Reyes" }]).birthDate).toBe("");
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
  it("includes the title, note and every attached name", () => {
    const f = searchableFields({ title: "First steps", note: "in the hallway" }, ["Rowan", "Avery"]);
    expect(f).toEqual(["First steps", "in the hallway", "Rowan", "Avery"]);
  });
  it("matches on the title alone for a household milestone", () => {
    expect(searchableFields({ title: "We got the keys", note: "" })).toEqual(["We got the keys", ""]);
  });
});

describe("categoryIcon", () => {
  it("resolves a known category", () => expect(categoryIcon("school")).toBe("🎒"));
  it("falls back for an unknown one", () => expect(categoryIcon("nope")).toBe("🌱"));
});
