package app.hao.bridge

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

class RepositoryService {
    private val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).followRedirects(HttpClient.Redirect.NEVER).build()
    private val json = Json { ignoreUnknownKeys = true }

    fun preview(request: RepositoryRequest): RepositoryPreview {
        require(request.acknowledged) { "The third-party repository disclaimer must be acknowledged" }
        val uri = Security.validateRemoteHttps(request.url)
        val response = client.send(HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(15)).header("Accept", "application/json").GET().build(), HttpResponse.BodyHandlers.ofByteArray())
        require(response.statusCode() == 200) { "Repository returned HTTP ${response.statusCode()}" }
        require(response.body().size <= 5 * 1024 * 1024) { "Repository index exceeds 5 MiB" }
        return parseIndex(response.body(), request)
    }

    internal fun parseIndex(body: ByteArray, request: RepositoryRequest): RepositoryPreview {
        require(body.size <= 5 * 1024 * 1024) { "Repository index exceeds 5 MiB" }
        val root = json.parseToJsonElement(body.decodeToString())
        val packages = if (request.mediaKind == MediaKind.NOVEL) parseNovelPackages(root) else parseApkPackages(root)
        require(packages.isNotEmpty()) { "No compatible extension packages were found" }
        val host = java.net.URI(request.url).host ?: "Extension repository"
        val warnings = if (request.mediaKind == MediaKind.NOVEL) listOf(
            DISCLAIMER,
            "Mangayomi JavaScript sources run in HAO's isolated novel host. Dart sources remain unavailable in this Bridge build."
        ) else listOf(DISCLAIMER)
        return RepositoryPreview(host, request.url, request.mediaKind, packages, warnings)
    }

    private fun parseApkPackages(root: JsonElement): List<ExtensionPackage> = collectPackageObjects(root).take(2_000).mapNotNull { item ->
        val pkg = item.text("pkg") ?: return@mapNotNull null
        val apk = item.text("apk") ?: return@mapNotNull null
        ExtensionPackage(item.text("name") ?: pkg, pkg, apk, item.text("version") ?: "unknown", item.text("lang"), item["nsfw"]?.jsonPrimitive?.intOrNull)
    }

    private fun parseNovelPackages(root: JsonElement): List<ExtensionPackage> = collectNovelObjects(root).take(2_000).mapNotNull { item ->
        if (item["itemType"]?.jsonPrimitive?.intOrNull != 2) return@mapNotNull null
        val id = item.text("id") ?: return@mapNotNull null
        val name = item.text("name") ?: return@mapNotNull null
        val declaredSourceCodeUrl = item.text("sourceCodeUrl") ?: return@mapNotNull null
        val sourceCodeUrl = KNOWN_NOVEL_SOURCE_URL_FIXES[id] ?: declaredSourceCodeUrl
        val baseUrl = item.text("baseUrl") ?: return@mapNotNull null
        if (!isPublicHttpsReference(sourceCodeUrl) || !isPublicHttpsReference(baseUrl)) return@mapNotNull null
        val language = item["sourceCodeLanguage"]?.jsonPrimitive?.intOrNull
        val runtime = when (language) {
            1 -> "MANGAYOMI_JAVASCRIPT"
            0 -> "MANGAYOMI_DART"
            else -> "MANGAYOMI_UNKNOWN"
        }
        ExtensionPackage(
            name = name,
            pkg = "mangayomi.novel.$id",
            apk = "",
            version = item.text("version") ?: "unknown",
            language = item.text("lang"),
            nsfw = item["isNsfw"]?.jsonPrimitive?.intOrNull ?: if (item["isNsfw"]?.jsonPrimitive?.booleanOrNull == true) 2 else 0,
            runtime = runtime,
            runtimeAvailable = runtime == "MANGAYOMI_JAVASCRIPT",
            compatibilityMessage = when (runtime) {
                "MANGAYOMI_JAVASCRIPT" -> "Ready for review and isolated JavaScript execution."
                "MANGAYOMI_DART" -> "Dart sources are not supported by this Bridge build."
                else -> "Unknown Mangayomi source language."
            },
            sourceCodeUrl = sourceCodeUrl,
            baseUrl = baseUrl,
        )
    }

    private fun collectPackageObjects(element: JsonElement): List<JsonObject> = when (element) {
        is JsonArray -> element.flatMap(::collectPackageObjects)
        is JsonObject -> if (element.containsKey("pkg") && element.containsKey("apk")) listOf(element) else element.values.flatMap(::collectPackageObjects)
        else -> emptyList()
    }

    private fun collectNovelObjects(element: JsonElement): List<JsonObject> = when (element) {
        is JsonArray -> element.flatMap(::collectNovelObjects)
        is JsonObject -> if (element.containsKey("sourceCodeUrl") && element.containsKey("itemType")) listOf(element) else element.values.flatMap(::collectNovelObjects)
        else -> emptyList()
    }

    private fun isPublicHttpsReference(raw: String): Boolean = try {
        val uri = java.net.URI(raw)
        uri.scheme == "https" && uri.host != null && uri.userInfo == null
    } catch (_: Exception) {
        false
    }

    private fun JsonObject.text(key: String): String? = this[key]?.jsonPrimitive?.content?.trim()?.takeIf(String::isNotEmpty)

    companion object {
        // The upstream index currently points this JavaScript RoyalRoad entry at
        // the repository's javascript/ directory instead of its actual source file.
        private val KNOWN_NOVEL_SOURCE_URL_FIXES = mapOf(
            "626511881" to "https://raw.githubusercontent.com/m2k3a/mangayomi-extensions/main/javascript/novel/src/en/RoyalRoad.js",
        )
    }
}
