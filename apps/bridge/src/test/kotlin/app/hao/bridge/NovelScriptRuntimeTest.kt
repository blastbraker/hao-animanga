package app.hao.bridge

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class NovelScriptRuntimeTest {
    @TempDir lateinit var temporary: Path

    @Test
    fun `executes installed JavaScript source and sanitizes chapter markup`() {
        val runtime = fixtureRuntime()
        val source = runtime.sources().single()
        assertEquals("Fixture Novels", source.name)
        assertTrue(source.supportsLatest)

        val catalog = runtime.catalog(source.id, "popular", null, 1)
        assertEquals("Fixture Story", catalog.items.single().title)
        val novel = runtime.detail(catalog.items.single().id)
        assertEquals("Fixture Author", novel.author)
        val chapter = runtime.chapters(novel.id).single()
        val content = runtime.chapter(chapter.id)
        assertTrue(content.html.contains("<strong>world</strong>"))
        assertFalse(content.html.contains("script", ignoreCase = true))
        assertFalse(content.html.contains("<img", ignoreCase = true))
    }

    @Test
    fun `rejects tampered opaque novel references`() {
        val runtime = fixtureRuntime()
        val id = runtime.catalog("mangayomi.novel.fixture", "popular", null, 1).items.single().id
        assertFailsWith<IllegalArgumentException> { runtime.detail(id.dropLast(1) + if (id.last() == 'a') 'b' else 'a') }
    }

    private fun fixtureRuntime(): NovelScriptRuntime {
        val root = temporary.resolve("extensions")
        val directory = root.resolve("novel/mangayomi.novel.fixture")
        Files.createDirectories(directory)
        val script = directory.resolve("extension.js")
        Files.writeString(script, SCRIPT, StandardOpenOption.CREATE_NEW)
        val installed = InstalledPackage(
            packageName = "mangayomi.novel.fixture",
            displayName = "Mangayomi: Fixture Novels",
            mediaKind = MediaKind.NOVEL,
            version = "1.0.0",
            sha256 = Security.sha256(script),
            signerFingerprint = "fixture",
            permissions = listOf("network:example.com"),
            byteSize = Files.size(script),
            maturity = "GENERAL",
            localPath = script.toAbsolutePath().toString(),
            installedAt = Instant.now().toString(),
            enabled = true,
            runtime = "MANGAYOMI_JAVASCRIPT",
            sourceCodeUrl = "https://example.com/fixture.js",
            baseUrl = "https://example.com",
            language = "en",
        )
        Files.writeString(directory.resolve("metadata.json"), Json { encodeDefaults = true }.encodeToString(installed), StandardOpenOption.CREATE_NEW)
        return NovelScriptRuntime(root, temporary.resolve("runtime"), "fixture-secret-that-is-at-least-thirty-two-characters")
    }

    companion object {
        private const val SCRIPT = """
            const mangayomiSources = [{name: "Fixture Novels", baseUrl: "https://example.com"}];
            class DefaultExtension extends MProvider {
              get supportsLatest() { return true; }
              getPopular(page) { return {list: [{name: "Fixture Story", link: "/story", imageUrl: "/cover.jpg"}], hasNextPage: false}; }
              getLatestUpdates(page) { return this.getPopular(page); }
              search(query, page, filters) { return this.getPopular(page); }
              getDetail(url) { return {name: "Fixture Story", author: "Fixture Author", description: "Safe fixture", genre: ["Fantasy"], status: "Ongoing", chapters: [{name: "Chapter 1", url: "/story/chapter-1"}]}; }
              getHtmlContent(name, url) { return '<script>alert(1)</script><p>Hello <strong>world</strong></p><img src="https://tracker.example/pixel">'; }
            }
        """
    }
}
