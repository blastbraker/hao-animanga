package app.hao.bridge

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertContains
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

    @Test
    fun `uses the package name as the uploaded apk filename`() {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        var requestBody = ""
        server.createContext("/api/v1/extension/install") { exchange ->
            requestBody = exchange.requestBody.readAllBytes().toString(StandardCharsets.ISO_8859_1)
            exchange.sendResponseHeaders(204, -1)
            exchange.close()
        }
        server.start()
        val apk = Files.createTempFile("hao-extension-", ".apk")
        try {
            Files.writeString(apk, "fixture")
            SuwayomiClient("http://127.0.0.1:${server.address.port}")
                .installExtension(apk, "eu.kanade.tachiyomi.extension.en.fixture")
            assertContains(requestBody, "filename=\"eu.kanade.tachiyomi.extension.en.fixture.apk\"")
        } finally {
            Files.deleteIfExists(apk)
            server.stop(0)
        }
    }
}
