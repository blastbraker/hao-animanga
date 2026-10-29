import { describe, expect, it } from "vitest";
import { librarySynopsis } from "./library-synopsis";

describe("library synopsis", () => {
  it("shows readable plain text from provider descriptions", () => {
    expect(
      librarySynopsis(
        "<p>A hero &amp; a friend.</p><br> A new &#x77;orld &#8212; together.",
      ),
    ).toBe("A hero & a friend. A new world — together.");
    expect(
      librarySynopsis(
        "<script>alert(1)</script><style>p{color:red}</style>Safe text",
      ),
    ).toBe("Safe text");
  });
  it("caps long descriptions at a word boundary", () => {
    const result = librarySynopsis(
      "A young adventurer explores a magical world. ".repeat(20),
    );
    expect(result.length).toBeLessThanOrEqual(280);
    expect(result.endsWith("…")).toBe(true);
    expect(librarySynopsis("A short synopsis.")).toBe("A short synopsis.");
  });
  it("handles missing descriptions and malformed entities", () => {
    expect(librarySynopsis(" <br> \n ")).toBe("No synopsis available yet.");
    expect(librarySynopsis(undefined)).toBe("No synopsis available yet.");
    expect(librarySynopsis("Hello &#99999999;world")).toBe("Hello world");
  });
});
