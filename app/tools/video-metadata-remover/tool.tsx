//app/tools/video-metadata-remover/tool.tsx
"use client"

import { useEffect, useRef, useState } from "react"
import {
  ACCEPT,
  cleanFile,
  formatBytes,
  inspectFile,
  type MetaField,
  type MetadataReport,
} from "@/lib/tools/metadata-cleaner"

// ---------------------------------------------------------------------------
// Report display
// ---------------------------------------------------------------------------

const GROUP_NAMES: Record<string, string> = {
  File: "File",
  Composite: "Calculated by ExifTool (not stored in the file)",
  QuickTime: "Video container",
  Keys: "QuickTime keys",
  ItemList: "Item list tags",
  UserData: "User data",
  IFD0: "EXIF: main image",
  IFD1: "EXIF: thumbnail",
  ExifIFD: "EXIF: camera settings",
  GPS: "GPS",
  JFIF: "JFIF",
  PNG: "PNG",
  RIFF: "WebP",
  IPTC: "IPTC",
  Photoshop: "Photoshop",
}

function groupName(group: string): string {
  if (GROUP_NAMES[group]) return GROUP_NAMES[group]
  const track = group.match(/^Track(\d+)$/)
  if (track) return `Track ${track[1]}`
  if (group.startsWith("XMP-")) return `XMP: ${group.slice(4)}`
  if (group.startsWith("ICC")) return "Colour profile"
  return group
}

function groupFields(fields: MetaField[]): [string, MetaField[]][] {
  const map = new Map<string, MetaField[]>()
  for (const f of fields) map.set(f.group, [...(map.get(f.group) ?? []), f])
  return [...map.entries()]
}

function Report({ report, openGroups = false }: { report: MetadataReport; openGroups?: boolean }) {
  const sensitive = report.fields.filter((f) => f.sensitive)

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg border border-border bg-background p-4 sm:grid-cols-2">
        {report.details.map((d) => (
          <div key={d.label} className="flex justify-between gap-3 text-sm">
            <dt className="text-muted-foreground">{d.label}</dt>
            <dd className="min-w-0 break-all text-right font-medium">{d.value}</dd>
          </div>
        ))}
      </dl>

      <div>
        <p className="text-sm font-semibold">
          {sensitive.length === 0
            ? "No privacy-sensitive fields found"
            : `${sensitive.length} privacy-sensitive ${sensitive.length === 1 ? "field" : "fields"}`}
        </p>
        {sensitive.length > 0 && (
          <ul className="mt-2 divide-y divide-amber-500/20 rounded-lg border border-amber-500/40 bg-amber-500/10">
            {sensitive.map((f) => (
              <li key={`${f.group}:${f.tag}`} className="flex flex-col gap-0.5 p-3 sm:flex-row sm:justify-between sm:gap-4">
                <span className="text-sm font-medium">
                  {f.label} <span className="text-xs font-normal text-muted-foreground">· {groupName(f.group)}</span>
                </span>
                <span className="break-all font-mono text-xs sm:text-right">{f.value}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="text-sm font-semibold">All metadata ({report.fields.length} fields)</p>
        <div className="mt-2 space-y-2">
          {groupFields(report.fields).map(([group, fields]) => (
            <details key={group} open={openGroups} className="rounded-lg border border-border bg-background">
              <summary className="cursor-pointer select-none px-3 py-2.5 text-sm font-medium">
                {groupName(group)} <span className="text-muted-foreground">({fields.length})</span>
              </summary>
              <table className="w-full table-fixed border-t border-border text-xs">
                <tbody>
                  {fields.map((f) => (
                    <tr key={f.tag} className="border-b border-border last:border-0 align-top">
                      <td className="w-2/5 px-3 py-2 text-muted-foreground">
                        {f.sensitive && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-amber-500" aria-label="Sensitive" />}
                        {f.label}
                      </td>
                      <td className="break-all px-3 py-2 font-mono">{f.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))}
        </div>
      </div>

      {report.warnings.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <p className="font-medium">Notes from ExifTool</p>
          <ul className="mt-1 list-disc pl-5">
            {report.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

type Busy = "reading" | "cleaning" | null

export function MetadataCleaner() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [report, setReport] = useState<MetadataReport | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [result, setResult] = useState<{ url: string; name: string; report: MetadataReport } | null>(null)

  // Free the download link's memory when it's replaced or the page closes.
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url) }, [result])

  async function handleFile(f: File) {
    if (busy) return
    setError(null)
    setResult(null)
    setReport(null)
    setFile(f)
    setBusy("reading")
    try {
      setReport(await inspectFile(f))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read this file.")
      setFile(null)
    } finally {
      setBusy(null)
    }
  }

  async function handleClean() {
    if (!file || !report || busy) return
    setError(null)
    setBusy("cleaning")
    try {
      const cleaned = await cleanFile(file, report.fileType)
      setResult({ url: URL.createObjectURL(cleaned.file), name: cleaned.file.name, report: cleaned.report })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't clean this file.")
    } finally {
      setBusy(null)
    }
  }

  function reset() {
    setFile(null)
    setReport(null)
    setResult(null)
    setError(null)
    if (inputRef.current) inputRef.current.value = ""
  }

  const sensitiveBefore = report?.fields.filter((f) => f.sensitive).length ?? 0
  const sensitiveAfter = result?.report.fields.filter((f) => f.sensitive).length ?? 0

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
      {!file && (
        <label
          htmlFor="metadata-file"
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const f = e.dataTransfer.files[0]
            if (f) handleFile(f)
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
            dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary"
          }`}
        >
          <span className="font-semibold">Choose a video or photo</span>
          <span className="mt-1 text-sm text-muted-foreground">or drop it here · MP4, MOV, JPG, PNG, WebP, HEIC · up to 1 GB</span>
          <input
            ref={inputRef}
            id="metadata-file"
            type="file"
            accept={ACCEPT}
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
            }}
          />
        </label>
      )}

      {busy === "reading" && (
        <p className="mt-4 text-sm text-muted-foreground">
          Reading metadata… The first file takes a few extra seconds while the engine loads.
        </p>
      )}

      {error && <p className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">{error}</p>}

      {file && report && (
        <div aria-live="polite">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold">{file.name}</p>
              <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
            </div>
            <button
              type="button"
              onClick={reset}
              disabled={busy !== null}
              className="shrink-0 text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50"
            >
              Choose another file
            </button>
          </div>

          {!result && (
            <>
              <Report report={report} />
              <button
                type="button"
                onClick={handleClean}
                disabled={busy !== null}
                className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60 sm:w-auto"
              >
                {busy === "cleaning" ? "Removing metadata…" : "Remove all metadata"}
              </button>
            </>
          )}

          {result && (
            <div className="space-y-5">
              <div className="rounded-lg border border-border bg-background p-4">
                <p className="text-sm font-semibold">
                  Removed {Math.max(0, report.fields.length - result.report.fields.length)} fields ·{" "}
                  {sensitiveBefore} → {sensitiveAfter} privacy-sensitive
                </p>
                <a
                  href={result.url}
                  download={result.name}
                  className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90 sm:w-auto"
                >
                  Download clean file
                </a>
                <p className="mt-3 text-xs text-muted-foreground">
                  The picture and sound weren't re-encoded. What's left below is technical information the file
                  needs to open and play correctly (dimensions, codec, duration), plus rotation and colour profile
                  for photos.
                </p>
              </div>
              <p className="text-sm font-semibold">Metadata in the cleaned file</p>
              <Report report={result.report} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
