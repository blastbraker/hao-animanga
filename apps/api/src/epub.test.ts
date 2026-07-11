import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { inspectEpub } from "./epub";

describe("EPUB inspection", () => {
  it("extracts safe metadata and chapters", () => {
    const archive = zipSync({
      "mimetype": strToU8("application/epub+zip"),
      "META-INF/container.xml": strToU8(`<container><rootfile full-path="OEBPS/book.opf"/></container>`),
      "OEBPS/book.opf": strToU8(`<package><metadata><dc:title>Fixture Book</dc:title><dc:creator>HAO</dc:creator></metadata><manifest><item id="c1" href="one.xhtml" media-type="application/xhtml+xml"/></manifest></package>`),
      "OEBPS/one.xhtml": strToU8("<html><body>Safe fixture</body></html>"),
    });
    expect(inspectEpub(archive)).toMatchObject({ title: "Fixture Book", creator: "HAO", chapters: [{ id: "c1", href: "one.xhtml" }] });
  });
  it("rejects non-archives", () => expect(() => inspectEpub(strToU8("not a book"))).toThrow("Invalid EPUB"));
});
