import { isAdult, searchMatch } from "./shared.js";
export { isAdult, searchMatch };

// The three precisions a milestone date can carry. `occurred_date` is always a
// full yyyy-mm-dd so SQL can sort and substr it; this says how much of it is
// actually known. See the comments in migrations/001_init.sql.
export const PRECISIONS = ["day", "month", "year"];

export const CATEGORIES = [
  { id: "first",  label: "A first",  icon: "✨" },
  { id: "school", label: "School",   icon: "🎒" },
  { id: "health", label: "Health",   icon: "🩺" },
  { id: "home",   label: "Home",     icon: "🏡" },
  { id: "pet",    label: "Pet",      icon: "🐾" },
  { id: "travel", label: "Travel",   icon: "✈️" },
  { id: "other",  label: "Other",    icon: "🌱" },
];

export function categoryIcon(id) {
  return CATEGORIES.find((c) => c.id === id)?.icon ?? "🌱";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Today as yyyy-mm-dd in the household timezone (or device-local demo time).
 *
 * Never `new Date().toISOString().slice(0, 10)` — that is UTC, and west of
 * Greenwich it is tomorrow's date for most of the evening. Supplying the
 * household's IANA timezone keeps this aligned with the hub's `:today` token,
 * even when the member's device is traveling.
 */
export function todayStr(now = new Date(), timeZone = "") {
  if (!timeZone) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Normalizes a partial date to the canonical full yyyy-mm-dd the DB stores.
 *
 * Month precision anchors to the 1st, year precision to Jan 1. Storing a
 * canonical full date is what keeps ORDER BY, substr() and the glance working
 * on a row whose real date is only known to the month.
 */
export function canonicalDate(year, month = 1, day = 1, precision = "day") {
  if (!PRECISIONS.includes(precision)) throw new Error("Choose how precisely the date is known.");
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    throw new Error("Enter a year from 1900 through 2200.");
  }

  const y = String(year).padStart(4, "0");
  if (precision === "year")  return `${y}-01-01`;

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Choose a valid month.");
  }
  if (precision === "month") return `${y}-${String(month).padStart(2, "0")}-01`;

  if (!Number.isInteger(day) || day < 1) throw new Error("Choose a valid day.");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > lastDay) throw new Error("That day does not exist in the selected month.");
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Renders a stored date at the precision that is actually known. */
export function formatOccurred(dateStr, precision = "day") {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (precision === "year")  return String(y);
  if (precision === "month") return `${MONTHS[m - 1]} ${y}`;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/**
 * Age of the subject when the milestone happened, as a human phrase.
 *
 * Returns "" when the birth date is unknown (a subject with no roster account
 * and no birthday entered) or when the milestone predates the birth — a
 * milestone recorded before someone was born is a typo, not a negative age.
 *
 * Under a month reads in days, under two years in months, then in years. A
 * milestone known only to the year gets a deliberately vague phrase, because
 * "1 year old" computed from a Jan-1 anchor would be a fact the data does not
 * actually contain.
 */
export function ageAt(birthDate, occurredDate, precision = "day") {
  if (!birthDate || !occurredDate) return "";
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [oy, om, od] = occurredDate.split("-").map(Number);
  if (!by || !oy) return "";

  const birth = Date.UTC(by, bm - 1, bd);
  const when  = Date.UTC(oy, om - 1, od);

  if (precision === "year") {
    const years = oy - by;
    if (years <= 0) return "";
    return `around ${years}`;
  }

  // A month-only milestone is anchored to the first for storage and sorting,
  // but that anchor is not an observed day. Never turn it into an exact age.
  // If birth and milestone share a month, all we can safely say is that the
  // subject was under a month old; later months get deliberately approximate
  // wording for the same reason.
  if (precision === "month") {
    const monthEnd = Date.UTC(oy, om, 0);
    if (monthEnd < birth) return "";
    const months = (oy - by) * 12 + (om - bm);
    if (months <= 0) return "under a month old";
    if (months < 24) return `around ${months} ${months === 1 ? "month" : "months"} old`;
    const years = Math.floor(months / 12);
    return `around ${years} ${years === 1 ? "year" : "years"} old`;
  }

  if (when < birth) return "";

  const days = Math.floor((when - birth) / 86400000);
  if (days < 31) return days === 1 ? "1 day old" : `${days} days old`;

  let months = (oy - by) * 12 + (om - bm);
  if (precision === "day" && od < bd) months -= 1;
  if (months < 24) return months === 1 ? "1 month old" : `${months} months old`;

  const years = Math.floor(months / 12);
  return years === 1 ? "1 year old" : `${years} years old`;
}

/**
 * Whether the current member may edit this milestone.
 *
 * Mirrors the `milestones` row policy exactly (owner_or_visibility, with
 * neither write_owner_only nor write_visibility_scoped set): the author may
 * edit their own, and adults may correct anyone's. A client gate that is more
 * generous than this just renders buttons the hub answers with a 403.
 */
export function canEdit(row, me) {
  if (!row || !me) return false;
  return isAdult(me) || row.created_by === me.id;
}

/**
 * Whether the current member may delete this milestone.
 *
 * Deliberately narrower than `canEdit`: the row policy sets
 * `delete_adult_only: true`, because a milestone is meant to outlive the
 * impulse to remove it. A child fixing their own mistaken entry edits it.
 */
export function canDelete(_row, me) {
  return isAdult(me);
}

/** Subjects the picker should offer: never the archived ones, name-ordered. */
export function activeSubjects(subjects) {
  return (subjects ?? [])
    .filter((s) => !s.archived_at)
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** Archived subjects, name-ordered for the adult restore control. */
export function archivedSubjects(subjects) {
  return (subjects ?? [])
    .filter((s) => Boolean(s.archived_at))
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** Keeps a selection valid when another session archives its subject. */
export function normalizeSelectedSubjectId(selectedId, subjects) {
  if (selectedId === "all") return "all";
  const active = activeSubjects(subjects);
  if (active.some((s) => s.id === selectedId)) return selectedId;
  return active.length === 1 ? active[0].id : "all";
}

/** Milestones whose subject still belongs on user-visible surfaces. */
export function milestonesForActiveSubjects(milestones, subjects) {
  const activeIds = new Set(activeSubjects(subjects).map((s) => s.id));
  return (milestones ?? []).filter((m) => activeIds.has(m.subject_id));
}

/** Newly uploaded files that are not durable until their form saves. */
export function unsavedFileIds(files) {
  return (files ?? []).filter((f) => f.isNew).map((f) => f.id).filter(Boolean);
}

/**
 * Resolves a subject's display name and birth date, preferring the live roster
 * when the subject is linked to a member.
 *
 * The roster is authoritative for members who are on it — a rename should not
 * leave a stale name on the timeline. But `birthdate` is stripped from
 * `family.members` for guests and inside shared spaces, so the locally stored
 * `birth_date` is the fallback that keeps ages working there.
 */
export function resolveSubject(subject, members = []) {
  if (!subject) return { name: "", birthDate: "" };
  const member = subject.member_id ? members.find((m) => m.id === subject.member_id) : null;
  return {
    name: member?.name || subject.name || "",
    birthDate: subject.birth_date || member?.birthdate || "",
  };
}

/** Timeline order: oldest first, so a life reads top to bottom. */
export function sortTimeline(milestones) {
  return (milestones ?? []).slice().sort((a, b) => {
    if (a.occurred_date !== b.occurred_date) return a.occurred_date < b.occurred_date ? -1 : 1;
    const created = String(a.created_at).localeCompare(String(b.created_at));
    return created || String(a.id).localeCompare(String(b.id));
  });
}

/** Latest bounded window of an ascending timeline, kept ascending for display. */
export function latestTimelinePage(milestones, limit) {
  const list = milestones ?? [];
  const size = Number.isInteger(limit) && limit > 0 ? limit : 1;
  const hiddenCount = Math.max(0, list.length - size);
  return { items: list.slice(hiddenCount), hiddenCount };
}

/** Turns a DESC database page (+1 lookahead row) into ascending UI state. */
export function timelinePageFromDescending(rows, limit) {
  const size = Number.isInteger(limit) && limit > 0 ? limit : 1;
  const visible = (rows ?? []).slice(0, size);
  return {
    items: visible.slice().reverse(),
    cursor: visible[visible.length - 1] ?? null,
    hasEarlier: (rows ?? []).length > size,
  };
}

/** Merges independently fetched pages without rendering a row twice. */
export function mergeTimelineRows(existing, incoming) {
  const byId = new Map((existing ?? []).map((row) => [row.id, row]));
  for (const row of incoming ?? []) byId.set(row.id, row);
  return sortTimeline([...byId.values()]);
}

/**
 * "On this day" — milestones sharing today's month and day from an earlier year.
 *
 * Mirrors the manifest's glance query, including the `date_precision === "day"`
 * filter. Without that filter every January 1st would surface every
 * year-precision milestone the household has ever recorded, because year
 * precision anchors to Jan 1.
 */
export function onThisDay(milestones, today) {
  const md = today.slice(5, 10);
  return (milestones ?? []).filter(
    (m) => m.date_precision === "day" && m.occurred_date.slice(5, 10) === md && m.occurred_date < today,
  );
}

/** Fields in-app search matches against (see hub-sdk `searchMatch`). */
export function searchableFields(milestone, subjectName = "") {
  return [milestone.title, milestone.note, subjectName];
}
