/** Plain text only: provider markup is never rendered as HTML in library cards. */
export function librarySynopsis(value: string | null | undefined): string {
  const entities: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    nbsp: " ",
    lt: "<",
    gt: ">",
    ndash: "–",
    mdash: "—",
    hellip: "…",
    rsquo: "’",
    lsquo: "‘",
    rdquo: "”",
    ldquo: "“",
  };
  const text = (value ?? "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (original, entity: string) => {
      if (!entity.startsWith("#"))
        return entities[entity.toLowerCase()] ?? original;
      const hex = entity.toLowerCase().startsWith("#x");
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : "";
    })
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "No synopsis available yet.";
  const characters = Array.from(text);
  if (characters.length <= 280) return text;
  const excerpt = characters.slice(0, 279).join("");
  const boundary = excerpt.lastIndexOf(" ");
  return `${(boundary > 200 ? excerpt.slice(0, boundary) : excerpt).trimEnd()}…`;
}
