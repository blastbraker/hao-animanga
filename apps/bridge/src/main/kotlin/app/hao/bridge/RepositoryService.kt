package app.hao.bridge

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.nio.file.Files
import java.nio.file.Path

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
        val entries = collectPackageObjects(root)
        val packages = entries.take(2_000).mapNotNull { element ->
            val item = element.jsonObject
            val pkg = item.text("pkg") ?: return@mapNotNull null
            val apk = item.text("apk") ?: return@mapNotNull null
            ExtensionPackage(item.text("name") ?: pkg, pkg, apk, item.text("version") ?: "unknown", item.text("lang"), item["nsfw"]?.jsonPrimitive?.intOrNull)
        }
        require(packages.isNotEmpty()) { "No compatible extension packages were found" }
        val host = java.net.URI(request.url).host ?: "Extension repository"
        return RepositoryPreview(host, request.url, request.mediaKind, packages, listOf(DISCLAIMER))
    }

    fun install(request: InstallRequest, storageRoot: Path): InstalledPackage {
        require(request.acknowledged) { "The third-party repository disclaimer must be acknowledged" }
        val repository = Security.validateRemoteHttps(request.repositoryUrl)
        val resolved = Security.validateRemoteHttps(repository.resolve(request.packageInfo.apk).toString())
        val response = client.send(HttpRequest.newBuilder(resolved).timeout(Duration.ofSeconds(30)).GET().build(), HttpResponse.BodyHandlers.ofByteArray())
        require(response.statusCode() == 200) { "Extension download returned HTTP ${response.statusCode()}" }
        require(response.body().size in 1..(50 * 1024 * 1024)) { "Extension package exceeds the 50 MiB limit" }
        val safeName = request.packageInfo.pkg.replace(Regex("[^A-Za-z0-9._-]"), "_")
        val directory = storageRoot.resolve(request.mediaKind.name.lowercase()).normalize()
        require(directory.startsWith(storageRoot.normalize())) { "Invalid extension storage path" }
        Files.createDirectories(directory)
        val target = directory.resolve("$safeName-${request.packageInfo.version}.apk")
        Files.write(target, response.body())
        val sha = Security.sha256(response.body())
        val signer = Security.signerFingerprint(target.toFile())
        return InstalledPackage(request.packageInfo.pkg, request.packageInfo.version, sha, signer, target.toAbsolutePath().toString())
    }

    private fun collectPackageObjects(element: JsonElement): List<JsonObject> = when (element) {
        is JsonArray -> element.flatMap(::collectPackageObjects)
        is JsonObject -> if (element.containsKey("pkg") && element.containsKey("apk")) listOf(element) else element.values.flatMap(::collectPackageObjects)
        else -> emptyList()
    }

    private fun JsonObject.text(key: String): String? = this[key]?.jsonPrimitive?.content
}
