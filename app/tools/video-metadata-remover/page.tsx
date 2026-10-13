//app/tools/video-metadata-remover/page.tsx
import type { Metadata } from "next"
import { getTool } from "@/lib/tools/registry"
import { ToolPageShell } from "@/components/tools/tool-page-shell"
import { MetadataCleaner } from "./tool"

const tool = getTool("video-metadata-remover")

export const metadata: Metadata = {
  title: tool.title,
  description: tool.description,
  alternates: { canonical: `/tools/${tool.slug}` },
  openGraph: {
    title: tool.title,
    description: tool.description,
    url: `/tools/${tool.slug}`,
    type: "website",
  },
}

export default function Page() {
  return (
    <ToolPageShell
      tool={tool}
      intro="See every metadata field in your video or photo (GPS location, device, editing software, dates, encoder and more), then download a copy with all of it removed. Works with MP4, MOV, JPG, PNG, WebP and HEIC, entirely on your device."
      method={
        <>
          <p>
            Phones record the location, device model and date in every video and photo. Editing apps add their
            own name and version, and Adobe apps can add a full editing history. When you send a raw file to a
            client, hire a UGC creator, or share a creative outside your team, all of it travels with the file,
            including GPS coordinates that can point to someone's home.
          </p>
          <p>
            This tool runs <strong>ExifTool</strong>, the open-source standard for reading and writing metadata
            created by Phil Harvey, directly in your browser. It lists every field it finds, grouped by where it's
            stored, and highlights the ones that could identify a person, place, device or workflow.
          </p>
          <p>
            <strong>Removing</strong> deletes every field ExifTool can write, blanks the recording dates in video
            headers, and clears the encoder name stored with the video codec. The picture and sound aren't
            re-encoded, so quality is identical. Afterwards the cleaned file is scanned again, so you can see exactly
            what's left.
          </p>
          <p>
            <strong>What stays on purpose:</strong> technical fields the file needs to open and play (dimensions,
            codec, duration, frame rate), and for photos, the rotation and colour profile, so the picture doesn't
            turn sideways or change colour. None of these identify you.
          </p>
          <p>
            <strong>What this doesn't do:</strong> removing metadata doesn't change how Meta, TikTok or Google review
            your ad, and it doesn't hide an ad or account from their enforcement. Platforms review ads by what's in
            them, not by file tags. Use this for privacy.
          </p>
        </>
      }
      limits={[
        "Some encoders also write their settings inside the compressed video stream itself. Removing that requires re-encoding, which this tool doesn't do.",
        "Timed metadata tracks (used by some drones, dashcams and action cameras for GPS paths) live inside the video stream and can't be removed without re-encoding.",
        "Supports MP4, MOV, JPG, PNG, WebP and HEIC up to 1 GB. Very large videos may run out of memory on phones.",
        "The metadata engine (about 8 MB) downloads the first time you pick a file.",
      ]}
      faqs={[
        {
          q: "Does removing metadata reduce quality?",
          a: "No. The picture and sound data aren't touched or re-encoded. Only the metadata around them is removed.",
        },
        {
          q: "Why are some fields still shown after cleaning?",
          a: "Every video and photo needs some technical information to open at all, like its dimensions, codec and duration. Those fields describe the file, not you. The cleaned report highlights anything privacy-sensitive, and for supported files that should be zero.",
        },
        {
          q: "Don't Facebook and Instagram remove metadata anyway?",
          a: "Independent tests show Meta strips location data from the public copy of uploaded photos, but it receives your original file first. Cleaning the file yourself is the only way to control what leaves your device, including files you send to clients or creators.",
        },
        {
          q: "Will this stop my ads from being rejected or linked to other accounts?",
          a: "No. Ad review looks at what your ad shows and says, and platforms match content by what's in it, not by file metadata. This tool is for privacy, not for getting around platform rules.",
        },
        {
          q: "Is my file uploaded anywhere?",
          a: "No. Everything happens in your browser. You can check: load this page, pick one file so the engine loads, then turn off your internet connection. The tool keeps working.",
        },
      ]}
    >
      <MetadataCleaner />
    </ToolPageShell>
  )
}
