package app.hao.bridge

import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.util.Comparator
import kotlin.io.path.createTempDirectory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AnimeHostServerTest {
    @Test
    fun `host protocol requires its private bearer token and serves normalized fixture data`() {
        val root = createTempDirectory("hao-anime-host-test")
        val token = "T".repeat(48)
        val app = AnimeHostServer.create(token, root).start("127.0.0.1", 0)
        try {
            val client = HttpClient.newHttpClient()
            val endpoint = URI("http://127.0.0.1:${app.port()}/v1/catalog")
            val unauthorized = client.send(HttpRequest.newBuilder(endpoint).GET().build(), HttpResponse.BodyHandlers.ofString())
            assertEquals(401, unauthorized.statusCode())
            val authorized = client.send(HttpRequest.newBuilder(endpoint).header("Authorization", "Bearer $token").GET().build(), HttpResponse.BodyHandlers.ofString())
            assertEquals(200, authorized.statusCode())
            assertTrue(authorized.body().contains("hao-anime-fixture"))
            val probes = client.send(
                HttpRequest.newBuilder(URI("http://127.0.0.1:${app.port()}/v1/extensions/probe"))
                    .header("Authorization", "Bearer $token").GET().build(),
                HttpResponse.BodyHandlers.ofString(),
            )
            assertEquals(200, probes.statusCode())
            assertEquals("[]", probes.body())
        } finally {
            app.stop()
            Files.walk(root).use { paths -> paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) } }
        }
    }

    @Test
    fun `host protocol maps invalid fixture identities without crashing`() {
        val root = createTempDirectory("hao-anime-host-test")
        val token = "T".repeat(48)
        val app = AnimeHostServer.create(token, root).start("127.0.0.1", 0)
        try {
            val request = HttpRequest.newBuilder(URI("http://127.0.0.1:${app.port()}/v1/anime/missing/episodes"))
                .header("Authorization", "Bearer $token").GET().build()
            val response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString())
            assertEquals(400, response.statusCode())
        } finally {
            app.stop()
            Files.walk(root).use { paths -> paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) } }
        }
    }
}
