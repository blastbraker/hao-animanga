package app.hao.bridge

import kotlinx.serialization.json.*
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.time.Duration
import java.util.Base64

/** Verifies media-only HAO passes, never Supabase or administrator credentials. */
internal class ViewerAccess(private val origin: String, private val deviceId: () -> String?) {
    private val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build()
    @Volatile private var key: Pair<ByteArray, Long>? = null

    fun permits(token: String?): Boolean = runCatching {
        val device = deviceId() ?: return false
        verifyViewerToken(token ?: return false, publicKey(), "$origin/bridge-viewer", device)
    }.getOrDefault(false)

    @Synchronized private fun publicKey(): ByteArray {
        key?.takeIf { it.second > System.currentTimeMillis() }?.let { return it.first }
        val request = HttpRequest.newBuilder(URI("$origin/api/v1/bridge-viewer-keys"))
            .timeout(Duration.ofSeconds(8)).GET().build()
        val response = http.send(request, HttpResponse.BodyHandlers.ofString())
        require(response.statusCode() == 200 && response.body().length < 8192)
        val jwk = Json.parseToJsonElement(response.body()).jsonObject["keys"]!!.jsonArray
            .map { it.jsonObject }.first { it["kid"]?.jsonPrimitive?.content == "hao-viewer-v1" }
        require(jwk["kty"]?.jsonPrimitive?.content == "OKP" && jwk["crv"]?.jsonPrimitive?.content == "Ed25519")
        val bytes = Base64.getUrlDecoder().decode(jwk["x"]!!.jsonPrimitive.content)
        require(bytes.size == 32)
        key = bytes to (System.currentTimeMillis() + 30 * 60_000)
        return bytes
    }
}

internal fun verifyViewerToken(token: String, rawKey: ByteArray, issuer: String, deviceId: String, now: Long = System.currentTimeMillis() / 1000): Boolean = runCatching {
    require(token.length in 1..4096)
    val parts = token.split('.')
    require(parts.size == 3)
    val decode = Base64.getUrlDecoder()
    val header = Json.parseToJsonElement(String(decode.decode(parts[0]), Charsets.UTF_8)).jsonObject
    require(header["alg"]?.jsonPrimitive?.content == "EdDSA" && header["kid"]?.jsonPrimitive?.content == "hao-viewer-v1")
    require(header["crit"] == null)
    val prefix = byteArrayOf(0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00)
    val publicKey = KeyFactory.getInstance("Ed25519").generatePublic(X509EncodedKeySpec(prefix + rawKey))
    val signature = Signature.getInstance("Ed25519")
    signature.initVerify(publicKey); signature.update("${parts[0]}.${parts[1]}".toByteArray(Charsets.US_ASCII))
    require(signature.verify(decode.decode(parts[2])))
    val claims = Json.parseToJsonElement(String(decode.decode(parts[1]), Charsets.UTF_8)).jsonObject
    require(claims["iss"]?.jsonPrimitive?.content == issuer)
    require(claims["aud"]?.jsonPrimitive?.content == deviceId)
    require(claims["scope"]?.jsonPrimitive?.content == "bridge:read")
    require(!claims["sub"]?.jsonPrimitive?.content.isNullOrBlank())
    val exp = claims["exp"]!!.jsonPrimitive.long
    val iat = claims["iat"]!!.jsonPrimitive.long
    require(exp > now && iat <= now + 30 && exp - iat <= 6 * 60 * 60)
    true
}.getOrDefault(false)

internal fun viewerProtectedPath(path: String): Boolean =
    listOf("/v1/anime/", "/v1/manga/", "/v1/novel/", "/v1/narration/").any(path::startsWith) &&
        !path.endsWith("/thumbnail") && !path.startsWith("/v1/manga/runtime") && path != "/v1/anime/extensions/probe"

// Every HLS resource is already normalized to this local path by the isolated
// host. Never forward a pass to an external media origin.
internal fun authorizeHlsManifest(manifest: String, token: String): String =
    Regex("(?m)(^|URI=\")(/v1/anime/streams/[A-Za-z0-9_-]+/(?:media|subtitles))(?=\"|\\s|$)")
        .replace(manifest) { "${it.groupValues[1]}${it.groupValues[2]}?hao_access=$token" }
