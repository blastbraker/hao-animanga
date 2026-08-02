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

    @Test
    fun `parses Mangayomi novel sources without treating scripts as APKs`() {
        val body = """[{"name":"Novel Fixture","id":"42","baseUrl":"https://novels.example","lang":"en","sourceCodeUrl":"https://raw.example/novel.js","version":"1","sourceCodeLanguage":1,"itemType":2,"isNsfw":0},{"name":"Manga Fixture","id":"43","baseUrl":"https://manga.example","sourceCodeUrl":"https://raw.example/manga.js","sourceCodeLanguage":1,"itemType":0}]""".encodeToByteArray()
        val preview = service.parseIndex(body, RepositoryRequest("https://example.com/novel_index.json", MediaKind.NOVEL, true))
        assertEquals(1, preview.packages.size)
        assertEquals("MANGAYOMI_JAVASCRIPT", preview.packages.single().runtime)
        assertEquals("", preview.packages.single().apk)
        assertEquals(true, preview.packages.single().runtimeAvailable)
        assertTrue(preview.warnings.last().contains("isolated novel host"))
    }

    @Test
    fun `drops novel sources with unsafe code URLs`() {
        val body = """[{"name":"Unsafe","id":"1","baseUrl":"https://novels.example","sourceCodeUrl":"http://example.com/novel.js","sourceCodeLanguage":1,"itemType":2}]""".encodeToByteArray()
        assertFailsWith<IllegalArgumentException> {
            service.parseIndex(body, RepositoryRequest("https://example.com/novel_index.json", MediaKind.NOVEL, true))
        }
    }

    @Test
    fun `repairs the known RoyalRoad JavaScript source URL`() {
        val body = """[{"name":"RoyalRoad","id":"626511881","baseUrl":"https://www.royalroad.com","lang":"en","sourceCodeUrl":"https://raw.githubusercontent.com/m2k3a/mangayomi-extensions/main/javascript/","version":"0.0.1","sourceCodeLanguage":1,"itemType":2,"isNsfw":0}]""".encodeToByteArray()
        val preview = service.parseIndex(body, RepositoryRequest("https://example.com/novel_index.json", MediaKind.NOVEL, true))

        assertEquals(
            "https://raw.githubusercontent.com/m2k3a/mangayomi-extensions/main/javascript/novel/src/en/RoyalRoad.js",
            preview.packages.single().sourceCodeUrl,
        )
    }
}
