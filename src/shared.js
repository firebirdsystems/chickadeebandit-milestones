/**
 * Mirrors of the `/hub-sdk.js` helpers that `logic.js` needs. The SDK is
 * browser-only (it is fetched from the hub at runtime), so tests import these
 * instead. Keep the behaviour identical to the SDK's — see "Extracting
 * testable logic" in the app-template CLAUDE.md.
 */

/** True when the member's role is "adult". */
export function isAdult(member) {
  return member?.role === "adult";
}

/** Case-insensitive substring match across a set of fields (hub-sdk `searchMatch`). */
export function searchMatch(query, fields) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => String(f ?? "").toLowerCase().includes(q));
}
