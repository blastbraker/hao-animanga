package app.hao.bridge

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class FixtureAnimeRuntimeTest {
    private val runtime = FixtureAnimeRuntime()

    @Test
    fun `normalizes catalog episodes servers and streams`() {
        val title = runtime.catalog().single()
        val episode = runtime.episodes(title.id).single()
        val server = runtime.servers(episode.id).single()
        val stream = runtime.streams(episode.id, server.id).single()
        assertTrue(stream.url.startsWith("/v1/anime/streams/"))
        assertEquals("MP4", stream.kind)
        assertEquals("HD", stream.quality)
    }

    @Test
    fun `rejects unknown fixture identities`() {
        assertFailsWith<IllegalArgumentException> { runtime.episodes("missing") }
        assertFailsWith<IllegalArgumentException> { runtime.streams("missing", "missing") }
    }
}
