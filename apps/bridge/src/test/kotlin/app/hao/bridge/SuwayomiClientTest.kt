package app.hao.bridge

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class SuwayomiClientTest {
    @Test
    fun `accepts loopback http and normalizes trailing slash`() {
        assertEquals("http://127.0.0.1:4567/", SuwayomiClient.validateEndpoint("http://127.0.0.1:4567").toString())
    }

    @Test
    fun `rejects non-loopback plain http`() {
        assertFailsWith<IllegalArgumentException> { SuwayomiClient.validateEndpoint("http://example.com") }
    }

    @Test
    fun `rejects embedded credentials`() {
        assertFailsWith<IllegalArgumentException> { SuwayomiClient.validateEndpoint("https://user:secret@example.com") }
    }

    @Test
    fun `upstream exception retains status without exposing response body`() {
        val error = SuwayomiUpstreamException(500)
        assertEquals(500, error.status)
        assertEquals("Suwayomi returned HTTP 500", error.message)
    }

    @Test
    fun `rejects unsupported browse modes before making a request`() {
        val client = SuwayomiClient("http://127.0.0.1:4567")
        assertFailsWith<IllegalArgumentException> { client.browse("123", "trending", 1) }
    }
}
