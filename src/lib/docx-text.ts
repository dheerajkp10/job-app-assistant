/**
 * Shared docx → plain text extraction.
 *
 * Used by:
 *   - `/api/resume` on upload (to populate settings.baseResumeText)
 *   - `/api/tailor-resume` and `/api/tailor-resume/multi` for in-pipeline
 *     scoring of the modified docx buffer
 *
 * Historically the upload path used `mammoth.extractRawText` while the
 * tailor route had its own regex-based XML strip. Same .docx file
 * extracted through both produced subtly different text — different
 * whitespace, different handling of run boundaries, different entity
 * decoding. That meant the "tailored score" the app showed the user
 * immediately after generation was computed on different text than the
 * score recomputed after the user re-uploaded that same docx, causing
 * unexplained ±1-2% drift between the two readings.
 *
 * Centralizing here on mammoth (same lib the upload uses) eliminates
 * that source of noise. The function signature takes a Buffer so both
 * callers (raw file bytes from upload, modified buffer from tailor)
 * can use it identically.
 */

import mammoth from 'mammoth';

/**
 * Extract plain text from a .docx buffer. Returns the raw text mammoth
 * produces, which is what we feed to the ATS scorer everywhere else in
 * the app. Errors propagate to the caller — the upload + tailor routes
 * already have their own error handling.
 */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}
