import { strFromU8, unzipSync } from "fflate";

export interface EpubManifest {
  title: string;
  creator: string | null;
  language: string | null;
  chapters: Array<{ id: string; href: string; mediaType: string }>;
}

const text = (xml: string, tag: string): string | null => {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.replace(/<[^>]+>/g, "").trim() ?? null;
};
const attr = (source: string, name: string): string | null => source.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1] ?? null;

export function inspectEpub(buffer: Uint8Array): EpubManifest {
  if (buffer.length < 4 || strFromU8(buffer.subarray(0, 2)) !== "PK") throw new Error("Invalid EPUB archive");
  const files = unzipSync(buffer, { filter: (file) => !file.name.endsWith("/") });
  const entries = Object.entries(files);
  if (entries.length > 2_000) throw new Error("EPUB contains too many files");
  const expandedBytes = entries.reduce((sum, [, bytes]) => sum + bytes.length, 0);
  if (expandedBytes > 200 * 1024 * 1024 || expandedBytes > buffer.length * 100) throw new Error("EPUB expanded size is unsafe");
  const containerBytes = files["META-INF/container.xml"];
  if (!containerBytes) throw new Error("EPUB container is missing");
  const opfPath = attr(strFromU8(containerBytes), "full-path");
  if (!opfPath || opfPath.includes("..")) throw new Error("EPUB package path is invalid");
  const opfBytes = files[opfPath];
  if (!opfBytes) throw new Error("EPUB package document is missing");
  const opf = strFromU8(opfBytes);
  const chapters = [...opf.matchAll(/<item\s+([^>]+)>?/gi)].map((match) => ({ id: attr(match[1] ?? "", "id"), href: attr(match[1] ?? "", "href"), mediaType: attr(match[1] ?? "", "media-type") })).filter((item): item is { id: string; href: string; mediaType: string } => Boolean(item.id && item.href && item.mediaType?.includes("xhtml")));
  return { title: text(opf, "dc:title") ?? "Untitled EPUB", creator: text(opf, "dc:creator"), language: text(opf, "dc:language"), chapters };
}
