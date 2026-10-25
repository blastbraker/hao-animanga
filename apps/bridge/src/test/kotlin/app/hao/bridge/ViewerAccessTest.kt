package app.hao.bridge

import java.security.KeyPairGenerator
import java.security.Signature
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertTrue
import kotlin.test.assertFalse
import kotlin.test.assertEquals

class ViewerAccessTest {
    private val keys = KeyPairGenerator.getInstance("Ed25519").generateKeyPair()
    private val rawKey = keys.public.encoded.takeLast(32).toByteArray()
    private val encoder = Base64.getUrlEncoder().withoutPadding()
    private fun token(aud: String = "fixture-bridge", exp: Long = 2000, scope: String = "bridge:read", alg: String = "EdDSA"): String {
        val head = encoder.encodeToString("""{"alg":"$alg","kid":"hao-viewer-v1"}""".toByteArray())
        val body = encoder.encodeToString("""{"iss":"https://hao.example/bridge-viewer","aud":"$aud","sub":"tester","iat":1000,"exp":$exp,"scope":"$scope"}""".toByteArray())
        val signature = Signature.getInstance("Ed25519")
        signature.initSign(keys.private); signature.update("$head.$body".toByteArray())
        return "$head.$body.${encoder.encodeToString(signature.sign())}"
    }
    private fun verify(token: String) = verifyViewerToken(token, rawKey, "https://hao.example/bridge-viewer", "fixture-bridge", 1500)

    @Test fun `valid signed account pass works`() { assertTrue(verify(token())) }
    @Test fun `wrong bridge expired pass and admin scope are rejected`() {
        assertFalse(verify(token(aud = "other-bridge")))
        assertFalse(verify(token(exp = 1400)))
        assertFalse(verify(token(exp = 30_000)))
        assertFalse(verify(token(scope = "bridge:admin")))
        assertFalse(verify(token(alg = "none")))
        assertFalse(verify(token().dropLast(5) + "AAAAA"))
        assertFalse(verify(""))
    }
    @Test fun `protects streams readers and narration but not thumbnails or management`() {
        for (path in listOf("/v1/anime/sources", "/v1/anime/streams/a/media", "/v1/manga/1/chapter/2/page/3", "/v1/novel/chapters/a", "/v1/narration/audio")) assertTrue(viewerProtectedPath(path))
        for (path in listOf("/health", "/v1/anime/a/thumbnail", "/v1/manga/1/thumbnail", "/v1/manga/runtime", "/v1/extensions/install")) assertFalse(viewerProtectedPath(path))
    }
    @Test fun `native HLS propagates media pass only to normalized local resources`() {
        val manifest = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"/v1/anime/streams/key-1/media\"\n/v1/anime/streams/video_2/media\n"
        assertEquals("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"/v1/anime/streams/key-1/media?hao_access=test.pass\"\n/v1/anime/streams/video_2/media?hao_access=test.pass\n", authorizeHlsManifest(manifest, "test.pass"))
        val external = "#EXT-X-KEY:URI=\"https://external.example/v1/anime/streams/a/media\"\nhttps://external.example/v1/anime/streams/b/media\n"
        assertEquals(external, authorizeHlsManifest(external, "test.pass"))
    }
}
