'use client';

import { useEffect, useRef, useState } from 'react';
import { Upload, Loader2, Trash2, Users, FileText, X, Send, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * LinkedIn Connections.csv import panel for Settings.
 *
 * The user exports their connections from LinkedIn → Settings &
 * Privacy → Get a copy of your data → Connections, drops the file
 * here, and the listings page surfaces "N contacts at <Company>"
 * on every matching card via /api/network?company=...
 *
 * Sequential-pick flow
 * ────────────────────
 * macOS native file pickers can't multi-select across folders. To
 * upload Connections.csv files from two different LinkedIn export
 * folders, the user clicks "Add a file" once per folder; each click
 * opens a fresh picker and appends to a staging queue. When they're
 * done staging, "Upload N files" submits the batch.
 *
 * We never call LinkedIn's API or store any auth — purely static
 * CSV parsing on the server. The user owns the data; the Clear
 * button wipes it from the DB.
 */
export function NetworkImportPanel() {
  const [count, setCount] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Last-upload stats — surfaced inline so the user can confirm a
  // multi-file import actually merged (vs replaced) the existing set.
  const [lastUploadInfo, setLastUploadInfo] = useState<{
    added: number;
    parsed: number;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Drag-state — flips the dropzone border highlight while a drag is
  // hovering. Using a counter so nested `dragleave` events on child
  // elements don't prematurely flip it off.
  const [dragDepth, setDragDepth] = useState(0);
  const isDragging = dragDepth > 0;
  // Staged files — additive across multiple picker clicks so the
  // user can navigate to a different folder each time and queue up
  // one (or more) Connections.csv per click. Submission only happens
  // when they hit "Upload N files". Drag-and-drop also feeds this
  // queue, so the same staging UI handles both flows.
  //
  // Each entry carries a queue-local `id` (just a monotonic counter)
  // so React keys never collide. Critically, this means two files
  // with identical `name + size + lastModified` (e.g. two
  // Connections.csv files exported from the same LinkedIn snapshot
  // into two split folders) BOTH get staged. Earlier we fingerprinted
  // on metadata and silently dropped the second; the server-side
  // contact-dedup handles real duplicates after parsing, so client-
  // side metadata dedup just causes data loss when fingerprints
  // happen to collide.
  const [staged, setStaged] = useState<{ id: number; file: File }[]>([]);
  const stageIdRef = useRef(0);

  useEffect(() => {
    fetch('/api/network')
      .then((r) => r.json())
      .then((d) => {
        setCount(d.total ?? 0);
        setUpdatedAt(d.updatedAt ?? null);
      })
      .catch(() => {});
  }, []);

  /** Append files to the staging queue. No metadata-based dedup —
   *  every pick produces a fresh row with a unique queue id, even
   *  if the picked file matches an already-queued one byte-for-byte.
   *  The server merges connections by LinkedIn profile URL after
   *  parsing, so an accidental double-pick is harmless. Used by
   *  every entry point: file picker + drag-and-drop. */
  function addToStage(rawFiles: FileList | File[]) {
    const incoming = Array.from(rawFiles);
    if (incoming.length === 0) return;
    setError(null);
    setStaged((prev) => {
      const next = [...prev];
      for (const f of incoming) {
        stageIdRef.current += 1;
        next.push({ id: stageIdRef.current, file: f });
      }
      return next;
    });
  }

  function removeStaged(id: number) {
    setStaged((prev) => prev.filter((entry) => entry.id !== id));
  }

  async function uploadStaged() {
    if (staged.length === 0) return;
    setBusy(true);
    setError(null);
    setLastUploadInfo(null);
    try {
      const fd = new FormData();
      for (const { file } of staged) {
        // Server accepts both .csv and LinkedIn data-export .zip
        // (which embed Connections.csv). Both go in under `files`.
        fd.append('files', file);
      }
      // Default to merge so a follow-up upload of part-2 of a split
      // LinkedIn export doesn't blow away part-1.
      fd.append('mode', 'merge');
      const res = await fetch('/api/network', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      setCount(data.total ?? 0);
      setUpdatedAt(new Date().toISOString());
      if (
        typeof data.addedThisUpload === 'number' &&
        typeof data.parsedThisUpload === 'number'
      ) {
        setLastUploadInfo({
          added: data.addedThisUpload,
          parsed: data.parsedThisUpload,
        });
      }
      // Clear queue on success so the user can stage another batch
      // (e.g. month-2 of a rolling LinkedIn export).
      setStaged([]);
    } finally {
      setBusy(false);
    }
  }

  async function clearAll() {
    if (!confirm('Clear your imported LinkedIn connections from this app?')) return;
    await fetch('/api/network', { method: 'DELETE' });
    setCount(0);
    setUpdatedAt(null);
  }

  return (
    <section className="mb-6 bg-white rounded-xl border border-slate-200 p-6">
      <div className="flex items-center gap-3 mb-3">
        <Users className="w-5 h-5 text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-800">Network (LinkedIn import)</h2>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Import your <code>Connections.csv</code> from LinkedIn — or the raw <code>.zip</code> archive
        LinkedIn emails you (we&apos;ll unzip it server-side). To combine files from <em>different
        folders</em>, click <strong>Add a file</strong> once per folder; each click opens a fresh
        picker and appends to the queue below. Then click <strong>Upload</strong> to submit them all
        together. Every listing card will then show a small badge if you have 1st-degree contacts
        at that company.
      </p>
      {count > 0 && (
        <div className="text-xs text-slate-700 mb-3">
          <strong>{count.toLocaleString()}</strong> connections imported
          {updatedAt && (
            <span className="text-slate-400"> · updated {new Date(updatedAt).toLocaleDateString()}</span>
          )}
          {lastUploadInfo && (
            <span className="text-emerald-700">
              {' '}· last upload added <strong>{lastUploadInfo.added.toLocaleString()}</strong> new
              {lastUploadInfo.parsed !== lastUploadInfo.added && (
                <> (out of {lastUploadInfo.parsed.toLocaleString()} parsed; rest were duplicates)</>
              )}
            </span>
          )}
        </div>
      )}
      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">
          {error}
        </div>
      )}
      {/* Drop zone — accepts files dragged from one or more Finder
          windows; each drop appends to the queue. The Add-a-file
          button is the manual sequential alternative for users who'd
          rather click than drag. */}
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          if (e.dataTransfer.types.includes('Files')) {
            setDragDepth((d) => d + 1);
          }
        }}
        onDragOver={(e) => {
          // Required for drop to fire.
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragDepth((d) => Math.max(0, d - 1));
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragDepth(0);
          const dropped = e.dataTransfer.files;
          if (dropped && dropped.length > 0) addToStage(dropped);
        }}
        className={`rounded-lg border-2 border-dashed transition-colors p-4 mb-3 ${
          isDragging
            ? 'border-blue-400 bg-indigo-50'
            : 'border-slate-200 bg-slate-50'
        }`}
      >
        <div className="text-xs text-slate-500 mb-2">
          <strong>Drag &amp; drop</strong> files here, or click <strong>Add a file</strong> below.
          Each click opens the picker for one folder at a time — click again to add from a
          different folder. When you&apos;re done, hit <strong>Upload</strong>.
        </div>

        {/* Staged queue. Visible only when at least one file is
            staged. Each row has an X to remove that one entry. The
            Upload button below the queue is the actual submit.
            Multiple Connections.csv files share the same name, so we
            also display size + lastModified to make each row
            distinguishable, plus a "#N of M" suffix when filenames collide. */}
        {staged.length > 0 && (() => {
          // Pre-index by filename so we can suffix "#1 of 2" labels
          // when multiple files share a name — that's exactly what
          // happens with LinkedIn's split exports (both parts ship a
          // file literally named Connections.csv). The ord/name maps
          // walk in queue order so the first-picked is "#1 of N".
          const nameCounts = new Map<string, number>();
          for (const { file } of staged) {
            nameCounts.set(file.name, (nameCounts.get(file.name) ?? 0) + 1);
          }
          const nameSeen = new Map<string, number>();
          return (
            <div className="mb-3 bg-white rounded-lg border border-slate-200 divide-y divide-gray-100">
              {staged.map(({ id, file }) => {
                const totalForName = nameCounts.get(file.name) ?? 1;
                const ord = (nameSeen.get(file.name) ?? 0) + 1;
                nameSeen.set(file.name, ord);
                const mtime = new Date(file.lastModified);
                return (
                  <div
                    key={id}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs"
                  >
                    <FileText className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="text-slate-700 font-medium truncate">
                          {file.name}
                        </span>
                        {totalForName > 1 && (
                          <span
                            className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-200"
                            title="Same filename as another staged file — both will be uploaded; the server merges connections after parsing."
                          >
                            #{ord} of {totalForName}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {(file.size / 1024).toFixed(1)} KB
                        {' · '}
                        modified {mtime.toLocaleDateString()} {mtime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeStaged(id)}
                      className="ml-auto p-0.5 rounded text-slate-400 hover:bg-red-50 hover:text-red-600 shrink-0"
                      title="Remove from queue"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })()}

        <div className="flex items-center gap-2 flex-wrap">
          {/* No `accept` filter: macOS file-picker dialogs sometimes
              grey out FOLDERS when the accept list is set (so you
              can't navigate into Downloads/XYZ/ to grab the file).
              The picker stays maximally navigable; the server
              validates whatever lands in the queue. */}
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const fs = e.target.files;
              if (fs && fs.length > 0) addToStage(fs);
              // Reset so re-picking the SAME file re-fires onChange.
              if (fileRef.current) fileRef.current.value = '';
            }}
          />
          {/* Primary CTA — Upload — appears once the queue has
              anything in it. Sits first so it's the leftmost,
              most-prominent button. */}
          {staged.length > 0 && (
            <Button
              size="sm"
              onClick={uploadStaged}
              isLoading={busy}
              leftIcon={<Send className="w-3.5 h-3.5" />}
            >
              {busy ? 'Parsing…' : `Upload ${staged.length} file${staged.length === 1 ? '' : 's'}`}
            </Button>
          )}
          {/* The pick action. Label changes to make sequential
              behavior obvious: first click says "Add a file" (no
              queue yet), subsequent clicks say "Add another file". */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-2 px-3 py-1.5 border border-blue-600 text-indigo-700 text-xs font-medium rounded-lg hover:bg-indigo-50 disabled:opacity-50"
            title="Opens the file picker for one folder. Pick the Connections.csv (or the .zip) you want and confirm — it lands in the queue below. Click again to add from another folder."
          >
            {staged.length === 0 ? (
              <><Upload className="w-3.5 h-3.5" /> Add a file</>
            ) : (
              <><Plus className="w-3.5 h-3.5" /> Add another file</>
            )}
          </button>
          {staged.length > 0 && (
            <button
              type="button"
              onClick={() => setStaged([])}
              disabled={busy}
              className="inline-flex items-center gap-2 px-3 py-1.5 border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50"
              title="Clear the queue without uploading."
            >
              <X className="w-3.5 h-3.5" /> Clear queue
            </button>
          )}
          {count > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex items-center gap-2 px-3 py-1.5 border border-slate-200 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear all
            </button>
          )}
        </div>
      </div>
      <p className="text-[11px] text-slate-400 mt-3">
        Get the CSV from LinkedIn → Me → Settings → Data privacy → Get a copy of your data → Connections.
        Stored only on this machine; never sent to any third party.
      </p>
    </section>
  );
}
