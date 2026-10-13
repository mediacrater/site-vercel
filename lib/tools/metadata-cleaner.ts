//lib/tools/metadata-cleaner.ts
/**
 * Full metadata viewer & remover, powered by ExifTool (by Phil Harvey) compiled to
 * WebAssembly. Everything runs in the visitor's browser: files are never uploaded.
 *
 * The engine (~8 MB compressed) is only downloaded when someone actually picks a
 * file, so it doesn't slow down the page itself.
 */

export interface MetaField {
  group: string // ExifTool group, e.g. "GPS", "IFD0", "Track1"
  tag: string // ExifTool tag name, e.g. "GPSLatitude"
  label: string // readable version, e.g. "GPS Latitude"
  value: string
  sensitive: boolean // could identify a person, place, device or workflow
}

export interface MetadataReport {
  fileType: string // ExifTool's file type, e.g. "JPEG", "MP4", "MOV"
  details: { label: string; value: string }[] // summary: type, size, dimensions, codec...
  fields: MetaField[] // every metadata field ExifTool found
  warnings: string[]
}

export const MAX_FILE_BYTES = 1024 ** 3 // 1 GB: the cleaned copy is built in memory
export const ACCEPT =
  ".jpg,.jpeg,.png,.webp,.heic,.heif,.gif,.tif,.tiff,.mp4,.mov,.m4v," +
  "image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif,image/tiff,video/mp4,video/quicktime"

const WASM_URL = "/vendor/zeroperl.wasm" // copied there by scripts/copy-exiftool-wasm.mjs
const VIDEO_TYPES = new Set(["MOV", "MP4", "M4V", "3GP", "3G2"])
const ZERO_DATE = "0000:00:00 00:00:00"

// ---------------------------------------------------------------------------
// Engine loading
// ---------------------------------------------------------------------------

type ExifToolModule = typeof import("@uswriting/exiftool")
let engine: Promise<ExifToolModule> | null = null

/** Loads ExifTool once, on first use. */
function loadEngine(): Promise<ExifToolModule> {
  engine ??= import("@uswriting/exiftool")
  return engine
}

/** The library would otherwise fetch the engine relative to the current page URL. */
const wasmFetch = () => fetch(WASM_URL)

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Reads every metadata field in the file. */
export async function inspectFile(file: File): Promise<MetadataReport> {
  if (file.size > MAX_FILE_BYTES) throw new Error("Files larger than 1 GB aren't supported.")
  const { parseMetadata } = await loadEngine()
  const result = await parseMetadata<Record<string, unknown>>(file, {
    args: ["-json", "-G1", "-a", "-s"],
    fetch: wasmFetch,
    transform: (out) => JSON.parse(out)[0] ?? {},
  })
  if (!result.success) {
    throw new Error("Couldn't read this file. It may be damaged or in a format that isn't supported.")
  }
  return buildReport(result.data, file)
}

/** Removes all removable metadata and returns the clean file plus a fresh report of it. */
export async function cleanFile(file: File, fileType: string): Promise<{ file: File; report: MetadataReport }> {
  const { writeMetadata } = await loadEngine()
  const isVideo = VIDEO_TYPES.has(fileType)

  // "-all=" deletes every tag ExifTool can write.
  const tags: Record<string, string> = { all: "" }

  // Video header dates can't be deleted (players need the fields to exist),
  // so they're blanked out instead.
  if (isVideo) {
    for (const t of ["CreateDate", "ModifyDate", "TrackCreateDate", "TrackModifyDate", "MediaCreateDate", "MediaModifyDate"]) {
      tags[`QuickTime:${t}`] = ZERO_DATE
    }
  }

  // -m: tolerate minor file errors. -q -q: keep harmless warnings out of the error stream.
  const args = ["-m", "-q", "-q"]
  // Photos: put back the two display instructions so the picture doesn't turn
  // sideways or change colour. Neither identifies anyone.
  if (!isVideo) args.push("-tagsFromFile", "@", "-Orientation", "-ICC_Profile")

  const result = await writeMetadata(file, tags, { args, fetch: wasmFetch })
  if (!result.success) {
    throw new Error("Couldn't clean this file. The format may not support metadata removal, or the file is damaged.")
  }

  const bytes = new Uint8Array(result.data)
  if (isVideo) blankEncoderFields(bytes)

  const cleaned = new File([bytes], cleanName(file.name), { type: file.type || "application/octet-stream" })
  return { file: cleaned, report: await inspectFile(cleaned) }
}

// ---------------------------------------------------------------------------
// Report building
// ---------------------------------------------------------------------------

const HIDDEN_GROUPS = new Set(["System", "ExifTool"]) // virtual file-system values, engine version

const SENSITIVE_GROUPS =
  /^(GPS|XMP|IPTC|Photoshop|Keys|ItemList|UserData|MakerNotes|Apple|Canon|Nikon|Sony|Samsung|Panasonic|Olympus|FujiFilm|Google|DJI|GoPro)/
const SENSITIVE_TAGS =
  /GPS|Location|Latitude|Longitude|Altitude|Serial|Owner|Artist|Author|Creator|Copyright|Software|Encoder|Encoded|Writer|Producer|Comment|Title|Keywords|Subject|Lens|History|DocumentID|InstanceID|CompressorName|VendorID|City|Country|Person|Region|Rating|Label|Caption|Headline|Credit|ImageDescription|Make$|Model$|Date|Time$/
const NOT_SENSITIVE = new Set([
  "HandlerDescription", "HandlerType", "HandlerClass", "HandlerVendorID", "ExposureTime",
  "PreviewTime", "PosterTime", "SelectionTime", "CurrentTime",
])

function isSensitive(group: string, tag: string, value: string): boolean {
  if (!value || value.startsWith("0000:00:00")) return false // empty or blanked-out
  if (NOT_SENSITIVE.has(tag)) return false
  return SENSITIVE_GROUPS.test(group) || SENSITIVE_TAGS.test(tag)
}

function formatValue(v: unknown): string {
  const s = Array.isArray(v) ? v.map(String).join(", ") : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)
  return s.length > 300 ? `${s.slice(0, 297)}…` : s
}

/** "GPSLatitude" → "GPS Latitude", "CompressorID" → "Compressor ID" */
function humanize(tag: string): string {
  return tag.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

function buildReport(raw: Record<string, unknown>, file: File): MetadataReport {
  const fields: MetaField[] = []
  const warnings: string[] = []

  for (const [key, rawValue] of Object.entries(raw)) {
    const split = key.indexOf(":")
    if (split < 0) continue // "SourceFile"
    const group = key.slice(0, split)
    const tag = key.slice(split + 1)
    const value = formatValue(rawValue)
    if (group === "ExifTool") {
      if (tag === "Warning" || tag === "Error") warnings.push(value)
      continue
    }
    if (HIDDEN_GROUPS.has(group)) continue
    fields.push({ group, tag, label: humanize(tag), value, sensitive: isSensitive(group, tag, value) })
  }

  const get = (key: string | undefined) => {
    const v = key ? raw[key] : undefined
    return v === undefined || v === "" ? undefined : formatValue(v)
  }
  // Find which numbered track holds the video and which holds the audio.
  const trackFor = (handler: string) =>
    Object.keys(raw).find((k) => /^Track\d+:HandlerType$/.test(k) && raw[k] === handler)?.split(":")[0]
  const video = trackFor("Video Track")
  const audio = trackFor("Audio Track")

  const details: [string, string | undefined][] = [
    ["File name", file.name],
    ["File size", formatBytes(file.size)],
    ["Type", get("File:FileType") ?? get("File:MIMEType")],
    ["Dimensions", get("Composite:ImageSize")],
    ["Duration", get("QuickTime:Duration") ?? get("Composite:Duration")],
    ["Video codec", get(video && `${video}:CompressorID`)],
    ["Frame rate", get(video && `${video}:VideoFrameRate`)],
    ["Average bitrate", get("Composite:AvgBitrate")],
    ["Audio", get(audio && `${audio}:AudioFormat`)],
    ["Audio sample rate", get(audio && `${audio}:AudioSampleRate`)],
    ["Audio channels", get(audio && `${audio}:AudioChannels`)],
    ["Megapixels", get("Composite:Megapixels")],
  ]

  return {
    fileType: String(raw["File:FileType"] ?? ""),
    details: details.filter((d): d is [string, string] => Boolean(d[1])).map(([label, value]) => ({ label, value })),
    fields,
    warnings,
  }
}

function cleanName(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot > 0 ? `${name.slice(0, dot)}-clean${name.slice(dot)}` : `${name}-clean`
}

// ---------------------------------------------------------------------------
// Video: blank the encoder name and vendor code
//
// ExifTool can't remove these because they sit inside the codec description that
// players need. They're fixed-size fields, though, so they can be zeroed in place
// without moving anything else in the file.
// ---------------------------------------------------------------------------

interface Box {
  type: string
  start: number
  body: number
  end: number
}

const latin1 = new TextDecoder("latin1")
const fourcc = (b: Uint8Array, at: number) => latin1.decode(b.subarray(at, at + 4))

/** Lists the boxes between start and end. Stops at anything malformed instead of guessing. */
function boxes(b: Uint8Array, start: number, end: number): Box[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const out: Box[] = []
  let i = start
  while (i + 8 <= end) {
    let size = v.getUint32(i)
    let header = 8
    if (size === 1) {
      if (i + 16 > end) break
      size = Number(v.getBigUint64(i + 8))
      header = 16
    } else if (size === 0) {
      size = end - i
    }
    if (size < header || i + size > end) break
    out.push({ type: fourcc(b, i + 4), start: i, body: i + header, end: i + size })
    i += size
  }
  return out
}

const child = (b: Uint8Array, parent: Box | undefined, type: string) =>
  parent ? boxes(b, parent.body, parent.end).find((x) => x.type === type) : undefined

function blankEncoderFields(b: Uint8Array) {
  for (const moov of boxes(b, 0, b.length).filter((x) => x.type === "moov")) {
    for (const trak of boxes(b, moov.body, moov.end).filter((x) => x.type === "trak")) {
      const mdia = child(b, trak, "mdia")
      const hdlr = child(b, mdia, "hdlr")
      const handler = hdlr && hdlr.end - hdlr.body >= 12 ? fourcc(b, hdlr.body + 8) : ""
      if (handler !== "vide" && handler !== "soun") continue

      const stsd = child(b, child(b, child(b, mdia, "minf"), "stbl"), "stsd")
      if (!stsd) continue
      // stsd: 4 bytes version/flags + 4 bytes entry count, then one entry per codec
      for (const entry of boxes(b, stsd.body + 8, stsd.end)) {
        const e = entry.start // offsets below count from the start of the entry
        if (entry.end - e >= 24) b.fill(0, e + 20, e + 24) // vendor code, e.g. "FFmpeg", "appl"
        if (handler === "vide" && entry.end - e >= 82) b.fill(0, e + 50, e + 82) // encoder name
      }
    }
  }
}
