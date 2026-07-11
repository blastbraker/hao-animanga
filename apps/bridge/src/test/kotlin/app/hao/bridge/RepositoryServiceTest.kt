package app.hao.bridge

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class RepositoryServiceTest {
    private val service = RepositoryService()

    @Test
    fun `parses Aniyomi repository index format`() {
        val body = """[{"name":"Aniyomi: Fixture","pkg":"eu.kanade.fixture","apk":"fixture-v1.2.apk","lang":"all","version":"1.2","nsfw":0,"sources":[{"name":"Fixture"}]}]""".encodeToByteArray()
        val preview = service.parseIndex(body, RepositoryRequest("https://example.com/repo/index.min.json", MediaKind.ANIME, true))
        assertEquals("example.com", preview.name)
        assertEquals(1, preview.packages.size)
        assertEquals("eu.kanade.fixture", preview.packages.single().pkg)
        assertEquals("fixture-v1.2.apk", preview.packages.single().apk)
        assertTrue(preview.warnings.single().contains("not created"))
    }

    @Test
    fun `rejects indexes without compatible packages`() {
        assertFailsWith<IllegalArgumentException> {
            service.parseIndex("[]".encodeToByteArray(), RepositoryRequest("https://example.com/index.json", MediaKind.MANGA, true))
        }
    }
}
