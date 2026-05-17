/**
 * Short stable fingerprint of a resume's text. Used to tag every
 * cached ATS score so the cache layer can detect "this entry was
 * scored against a different resume than is currently active"
 * without the upload / set-active endpoints having to remember to
 * wipe the cache.
 *
 * Why a hash rather than just the activeResumeId: id stays the same
 * when the user replaces the file under the same id (settings page
 * uploads with replaceId), but the text content changes — the
 * scores against the old text are no longer valid. Hashing the
 * text catches both the id-changed AND text-changed cases.
 *
 * Truncated SHA-256 to 16 hex chars. Collisions on a single user's
 * resume corpus are vanishingly unlikely; cheap to compute server-
 * side; small enough not to bloat cache entries.
 */
import { createHash } from 'crypto';

export function resumeStamp(text: string | null | undefined): string {
  if (!text) return '';
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}
