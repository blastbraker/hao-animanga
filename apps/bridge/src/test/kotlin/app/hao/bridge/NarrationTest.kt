package app.hao.bridge

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class NarrationTest {
    @Test fun `optional real Kokoro worker smoke test with Windows containment and cache`() {
        if (System.getenv("HAO_TEST_KOKORO") != "1") return
        val root = java.nio.file.Path.of("../..").toAbsolutePath().normalize()
        val worker = KokoroWorker(java.nio.file.Path.of("narrator/worker.mjs").toAbsolutePath(), "C:/Program Files/nodejs/node.exe", root.resolve(".run/kokoro"))
        NarrationService(worker).use { service ->
            val manifest = service.manifest { NovelChapterContent("test", "test", "Test chapter", "<p>The rain stopped at dawn. A new story was waiting in the library.</p>") }
            val request = NarrationAudioRequest(manifest.id, 0, "af_heart")
            val audio = service.audio(request)
            assertTrue(audio.size > 1000)
            assertEquals(audio.toList(), service.audio(request).toList())
        }
    }
    @Test fun `readable text includes headings and inline content without duplicating it`() {
        val passages = narrationPassages("<h1>Chapter one</h1><p>Hello <b>world</b>.</p><script>bad()</script><p>Next &amp; last.</p>")
        assertEquals("Chapter one Hello world. Next & last.", passages.joinToString(" ").replace(Regex("\\s+"), " "))
    }

    @Test fun `long passages preserve all text and fit the inference limit`() {
        val text = (1..1000).joinToString(" ") { "Word$it." }
        val passages = narrationPassages("<p>$text</p>")
        assertTrue(passages.all { it.length in 1..320 })
        assertEquals(text, passages.joinToString(" ").replace(Regex("\\s+"), " "))
    }

    @Test fun `a long unbroken string is not truncated`() {
        val text = "a".repeat(1200)
        assertEquals(text, narrationPassages(text).joinToString(""))
    }

    @Test fun `empty and abusive chapter markup is bounded`() {
        assertTrue(narrationPassages("<script>ignore me</script>").isEmpty())
        assertFailsWith<IllegalArgumentException> { narrationPassages("x".repeat(200_001)) }
    }

    @Test fun `custom voice and file paths cannot be passed as a built in voice`() {
        assertFalse(NarrationService.voices.any { it.id.contains('/') })
        assertFailsWith<IllegalArgumentException> { NarrationService().audio(NarrationAudioRequest("missing", 0, "../voice")) }
        assertFailsWith<NarrationUnavailable> { NarrationService().audio(NarrationAudioRequest("missing", 0, "af_heart")) }
    }
}
