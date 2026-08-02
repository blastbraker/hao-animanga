package app.hao.bridge

import com.android.apksig.ApkVerifier
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.time.Duration
import java.time.Instant
import java.util.Comparator
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.zip.ZipFile

class ExtensionManager {
    private data class PendingInspection(val inspection: ExtensionInspection, val path: Path, val expiresAt: Instant, val packageInfo: ExtensionPackage? = null)
    private data class AnalyzedApk(val packageName: String, val versionName: String, val signerFingerprint: String, val permissions: List<String>)

    private val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).followRedirects(HttpClient.Redirect.NEVER).build()
    private val json = Json { ignoreUnknownKeys = false; encodeDefaults = true; prettyPrint = true }
    private val pending = ConcurrentHashMap<String, PendingInspection>()

    fun inspect(request: InspectExtensionRequest, storageRoot: Path): ExtensionInspection {
        require(request.acknowledged) { "The third-party extension disclaimer must be acknowledged" }
        if (request.mediaKind == MediaKind.NOVEL) return inspectNovelScript(request, storageRoot)
        require(request.packageInfo.runtime == "ANDROID_APK" && request.packageInfo.runtimeAvailable) {
            request.packageInfo.compatibilityMessage ?: "This extension runtime is not available"
        }
        validatePackageName(request.packageInfo.pkg)
        require(request.packageInfo.apk.endsWith(".apk", ignoreCase = true)) { "Repository package must reference an APK" }

        val repository = Security.validateRemoteHttps(request.repositoryUrl)
        val reference = URI(request.packageInfo.apk)
        require(!reference.isAbsolute && reference.rawAuthority == null) { "APK references must be relative to the repository" }
        val downloadUris = resolveApkReferences(repository, reference).map { Security.validateRemoteHttps(it.toString()) }
        require(downloadUris.all { it.host.equals(repository.host, ignoreCase = true) }) { "APK downloads must remain on the repository host" }

        cleanupExpired(storageRoot)
        val inspectionId = UUID.randomUUID().toString()
        val stagingRoot = storageRoot.resolve(".staging").normalize()
        require(stagingRoot.startsWith(storageRoot.normalize())) { "Invalid staging path" }
        Files.createDirectories(stagingRoot)
        val stagedApk = stagingRoot.resolve("$inspectionId.apk")

        try {
            val byteSize = download(downloadUris, stagedApk)
            validateApkArchive(stagedApk)
            val analyzed = analyzeApk(stagedApk)
            require(analyzed.packageName == request.packageInfo.pkg) {
                "Repository package identity does not match the APK manifest"
            }
            val previous = readInstalled(storageRoot, request.mediaKind, request.packageInfo.pkg)
            val expiresAt = Instant.now().plus(INSPECTION_TTL)
            val inspection = ExtensionInspection(
                id = inspectionId,
                packageName = analyzed.packageName,
                displayName = request.packageInfo.name,
                mediaKind = request.mediaKind,
                version = request.packageInfo.version,
                sha256 = Security.sha256(stagedApk),
                signerFingerprint = analyzed.signerFingerprint,
                previousSignerFingerprint = previous?.signerFingerprint,
                signerChanged = previous != null && previous.signerFingerprint != analyzed.signerFingerprint,
                permissions = analyzed.permissions,
                previousPermissions = previous?.permissions ?: emptyList(),
                permissionsChanged = previous != null && previous.permissions != analyzed.permissions,
                byteSize = byteSize,
                maturity = maturity(request.packageInfo.nsfw),
                expiresAt = expiresAt.toString(),
            )
            pending[inspectionId] = PendingInspection(inspection, stagedApk, expiresAt, request.packageInfo)
            return inspection
        } catch (error: Exception) {
            Files.deleteIfExists(stagedApk)
            if (error is IllegalArgumentException) throw error
            throw IllegalArgumentException("Extension inspection failed: ${error.message ?: "invalid APK"}", error)
        }
    }

    fun install(request: ConfirmInstallRequest, storageRoot: Path): InstalledPackage {
        require(request.acknowledged) { "The third-party extension disclaimer must be acknowledged" }
        require(request.acceptPermissions) { "Review and accept the declared permissions before installation" }
        val staged = pending[request.inspectionId] ?: throw IllegalArgumentException("Extension inspection is missing or expired")
        if (staged.expiresAt <= Instant.now()) {
            pending.remove(request.inspectionId)
            Files.deleteIfExists(staged.path)
            throw IllegalArgumentException("Extension inspection expired; inspect the package again")
        }
        require(!staged.inspection.signerChanged || request.acceptSignerChange) {
            "The signing identity changed; renewed acknowledgement is required"
        }

        val directory = packageDirectory(storageRoot, staged.inspection.mediaKind, staged.inspection.packageName)
        Files.createDirectories(directory)
        val target = directory.resolve(if (staged.inspection.mediaKind == MediaKind.NOVEL) SCRIPT_FILE else APK_FILE)
        try {
            Files.move(staged.path, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        } catch (_: AtomicMoveNotSupportedException) {
            Files.move(staged.path, target, StandardCopyOption.REPLACE_EXISTING)
        }

        val installed = InstalledPackage(
            packageName = staged.inspection.packageName,
            displayName = staged.inspection.displayName,
            mediaKind = staged.inspection.mediaKind,
            version = staged.inspection.version,
            sha256 = staged.inspection.sha256,
            signerFingerprint = staged.inspection.signerFingerprint,
            permissions = staged.inspection.permissions,
            byteSize = staged.inspection.byteSize,
            maturity = staged.inspection.maturity,
            localPath = target.toAbsolutePath().toString(),
            installedAt = Instant.now().toString(),
            enabled = true,
            runtime = staged.packageInfo?.runtime ?: "ANDROID_APK",
            sourceCodeUrl = staged.packageInfo?.sourceCodeUrl,
            baseUrl = staged.packageInfo?.baseUrl,
            language = staged.packageInfo?.language,
        )
        writeInstalled(directory, installed)
        pending.remove(request.inspectionId)
        return installed
    }

    fun installLocalFixture(apk: Path, storageRoot: Path): InstalledPackage {
        val source = apk.toAbsolutePath().normalize()
        require(Files.isRegularFile(source)) { "Fixture APK is missing" }
        validateApkArchive(source)
        val analyzed = analyzeApk(source)
        require(analyzed.packageName == AniyomiFixtureRuntime.FIXTURE_PACKAGE) { "Only the HAO fixture package is allowed" }
        require(analyzed.permissions.isEmpty()) { "The HAO fixture APK must not request Android permissions" }
        val previous = readInstalled(storageRoot, MediaKind.ANIME, analyzed.packageName)
        require(previous == null || previous.signerFingerprint == analyzed.signerFingerprint) { "Fixture signing identity changed" }
        val directory = packageDirectory(storageRoot, MediaKind.ANIME, analyzed.packageName)
        Files.createDirectories(directory)
        val target = directory.resolve(APK_FILE)
        Files.copy(source, target, StandardCopyOption.REPLACE_EXISTING)
        val installed = InstalledPackage(
            packageName = analyzed.packageName,
            displayName = "Aniyomi: HAO Signed Fixture",
            mediaKind = MediaKind.ANIME,
            version = analyzed.versionName,
            sha256 = Security.sha256(target),
            signerFingerprint = analyzed.signerFingerprint,
            permissions = analyzed.permissions,
            byteSize = Files.size(target),
            maturity = "GENERAL",
            localPath = target.toAbsolutePath().toString(),
            installedAt = Instant.now().toString(),
            enabled = true,
        )
        writeInstalled(directory, installed)
        return installed
    }

    fun listInstalled(storageRoot: Path): List<InstalledPackage> {
        if (!Files.exists(storageRoot)) return emptyList()
        val installed = mutableListOf<InstalledPackage>()
        Files.walk(storageRoot, 4).use { paths ->
            paths.filter { Files.isRegularFile(it) && it.fileName.toString() == METADATA_FILE }.forEach { metadata ->
                runCatching { json.decodeFromString<InstalledPackage>(Files.readString(metadata)) }.getOrNull()?.let(installed::add)
            }
        }
        return installed.sortedWith(compareBy<InstalledPackage> { it.mediaKind.name }.thenBy { it.displayName.lowercase() })
    }

    fun setEnabled(request: ExtensionStateRequest, storageRoot: Path): InstalledPackage {
        val installed = readInstalled(storageRoot, request.mediaKind, request.packageName)
            ?: throw IllegalArgumentException("Installed extension was not found")
        val updated = installed.copy(enabled = request.enabled)
        writeInstalled(packageDirectory(storageRoot, request.mediaKind, request.packageName), updated)
        return updated
    }

    fun remove(request: RemoveExtensionRequest, storageRoot: Path): ExtensionRemovalResponse {
        val directory = packageDirectory(storageRoot, request.mediaKind, request.packageName)
        if (!Files.exists(directory)) return ExtensionRemovalResponse(request.packageName, false)
        Files.walk(directory).use { paths ->
            paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
        }
        return ExtensionRemovalResponse(request.packageName, true)
    }

    private fun download(candidates: List<URI>, target: Path): Long {
        val response = candidates.firstNotNullOfOrNull { uri ->
            val candidate = client.send(
                HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(30)).header("Accept", "application/vnd.android.package-archive, application/octet-stream").GET().build(),
                HttpResponse.BodyHandlers.ofInputStream(),
            )
            if (candidate.statusCode() == 404) {
                candidate.body().close()
                null
            } else candidate
        } ?: throw IllegalArgumentException("Extension package was not found in the repository")
        require(response.statusCode() == 200) { "Extension download returned HTTP ${response.statusCode()}" }
        val declaredLength = response.headers().firstValueAsLong("Content-Length").orElse(-1)
        require(declaredLength <= MAX_APK_BYTES) { "Extension package exceeds the 50 MiB limit" }

        var total = 0L
        response.body().use { input ->
            Files.newOutputStream(target, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE).use { output ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val read = input.read(buffer)
                    if (read == -1) break
                    total += read
                    require(total <= MAX_APK_BYTES) { "Extension package exceeds the 50 MiB limit" }
                    output.write(buffer, 0, read)
                }
            }
        }
        require(total > 0) { "Extension package is empty" }
        return total
    }

    private fun inspectNovelScript(request: InspectExtensionRequest, storageRoot: Path): ExtensionInspection {
        val info = request.packageInfo
        require(info.runtime == "MANGAYOMI_JAVASCRIPT" && info.runtimeAvailable) {
            info.compatibilityMessage ?: "This novel extension runtime is not available"
        }
        validatePackageName(info.pkg)
        val sourceUri = Security.validateRemoteHttps(info.sourceCodeUrl?.trim() ?: throw IllegalArgumentException("Novel source code URL is missing"))
        val baseUri = Security.validateRemoteHttps(info.baseUrl?.trim() ?: throw IllegalArgumentException("Novel base URL is missing"))
        cleanupExpired(storageRoot)
        val inspectionId = UUID.randomUUID().toString()
        val stagingRoot = storageRoot.resolve(".staging").normalize()
        require(stagingRoot.startsWith(storageRoot.normalize())) { "Invalid staging path" }
        Files.createDirectories(stagingRoot)
        val stagedScript = stagingRoot.resolve("$inspectionId.js")
        try {
            val byteSize = downloadScript(sourceUri, stagedScript)
            val source = Files.readString(stagedScript)
            require(source.contains("class DefaultExtension") && source.contains("mangayomiSources")) { "The JavaScript file is not a compatible Mangayomi source" }
            require(!source.contains("Java.type") && !source.contains("Polyglot.")) { "The JavaScript source requests forbidden host access" }
            val previous = readInstalled(storageRoot, MediaKind.NOVEL, info.pkg)
            val publisherIdentity = "${sourceUri.scheme}://${sourceUri.host}${sourceUri.path.substringBeforeLast('/', "")}".encodeToByteArray()
            val fingerprint = Security.sha256(publisherIdentity)
            val permissions = listOf("network:${baseUri.host.lowercase()}", "source:${sourceUri.host.lowercase()}").distinct().sorted()
            val expiresAt = Instant.now().plus(INSPECTION_TTL)
            val inspection = ExtensionInspection(
                id = inspectionId,
                packageName = info.pkg,
                displayName = "Mangayomi: ${info.name}",
                mediaKind = MediaKind.NOVEL,
                version = info.version,
                sha256 = Security.sha256(stagedScript),
                signerFingerprint = fingerprint,
                previousSignerFingerprint = previous?.signerFingerprint,
                signerChanged = previous != null && previous.signerFingerprint != fingerprint,
                permissions = permissions,
                previousPermissions = previous?.permissions ?: emptyList(),
                permissionsChanged = previous != null && previous.permissions != permissions,
                byteSize = byteSize,
                maturity = maturity(info.nsfw),
                expiresAt = expiresAt.toString(),
            )
            pending[inspectionId] = PendingInspection(inspection, stagedScript, expiresAt, info)
            return inspection
        } catch (error: Exception) {
            Files.deleteIfExists(stagedScript)
            if (error is IllegalArgumentException) throw error
            throw IllegalArgumentException("Novel extension inspection failed: ${error.message ?: "invalid JavaScript"}", error)
        }
    }

    private fun downloadScript(uri: URI, target: Path): Long {
        val response = client.send(
            HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(20)).header("Accept", "text/javascript, application/javascript, text/plain").GET().build(),
            HttpResponse.BodyHandlers.ofByteArray(),
        )
        require(response.statusCode() == 200) { "Novel source download returned HTTP ${response.statusCode()}" }
        require(response.body().isNotEmpty()) { "Novel source is empty" }
        require(response.body().size <= MAX_SCRIPT_BYTES) { "Novel source exceeds the 1 MiB limit" }
        Files.write(target, response.body(), StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)
        return response.body().size.toLong()
    }

    private fun validateApkArchive(path: Path) {
        ZipFile(path.toFile()).use { apk ->
            require(apk.getEntry("AndroidManifest.xml") != null) { "APK is missing AndroidManifest.xml" }
            require(apk.getEntry("classes.dex") != null) { "APK is missing classes.dex" }
        }
    }

    private fun analyzeApk(path: Path): AnalyzedApk {
        val verification = ApkVerifier.Builder(path.toFile()).build().verify()
        require(verification.isVerified) {
            val errors = verification.errors.take(3).joinToString("; ")
            "APK signature verification failed${if (errors.isBlank()) "" else ": $errors"}"
        }
        val fingerprints = verification.signerCertificates.map { Security.sha256(it.encoded) }.distinct().sorted()
        require(fingerprints.isNotEmpty()) { "APK has no verified signing certificate" }

        val manifest = ApkManifestReader.read(path)
        return AnalyzedApk(manifest.packageName, manifest.versionName, fingerprints.joinToString(","), manifest.permissions)
    }

    private fun readInstalled(storageRoot: Path, mediaKind: MediaKind, packageName: String): InstalledPackage? {
        val metadata = packageDirectory(storageRoot, mediaKind, packageName).resolve(METADATA_FILE)
        if (!Files.isRegularFile(metadata)) return null
        return json.decodeFromString(Files.readString(metadata))
    }

    private fun writeInstalled(directory: Path, installed: InstalledPackage) {
        Files.createDirectories(directory)
        Files.writeString(
            directory.resolve(METADATA_FILE),
            json.encodeToString(installed),
            StandardOpenOption.CREATE,
            StandardOpenOption.TRUNCATE_EXISTING,
            StandardOpenOption.WRITE,
        )
    }

    private fun packageDirectory(storageRoot: Path, mediaKind: MediaKind, packageName: String): Path {
        validatePackageName(packageName)
        val root = storageRoot.normalize()
        val kindRoot = root.resolve(mediaKind.name.lowercase()).normalize()
        val directory = kindRoot.resolve(packageName).normalize()
        require(directory.startsWith(kindRoot) && directory.parent == kindRoot) { "Invalid extension storage path" }
        return directory
    }

    private fun cleanupExpired(storageRoot: Path) {
        val now = Instant.now()
        pending.entries.toList().forEach { (id, staged) ->
            if (staged.expiresAt <= now && pending.remove(id, staged)) Files.deleteIfExists(staged.path)
        }
        val stagingRoot = storageRoot.resolve(".staging").normalize()
        if (!Files.isDirectory(stagingRoot)) return
        val cutoff = now.minus(INSPECTION_TTL)
        Files.list(stagingRoot).use { files ->
            files.filter { file ->
                Files.isRegularFile(file) &&
                    Files.getLastModifiedTime(file).toInstant() < cutoff &&
                    pending.values.none { it.path == file }
            }.forEach { Files.deleteIfExists(it) }
        }
    }

    private fun validatePackageName(packageName: String) {
        require(PACKAGE_NAME.matches(packageName)) { "Invalid Android package name" }
    }

    internal fun maturity(nsfw: Int?): String = when (nsfw ?: 0) {
        0 -> "GENERAL"
        1 -> "MATURE"
        else -> "ADULT"
    }

    internal fun resolveApkReferences(repository: URI, reference: URI): List<URI> =
        listOf(repository.resolve(reference), repository.resolve("apk/${reference.path}")).distinct()

    companion object {
        private val PACKAGE_NAME = Regex("[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)+")
        private val INSPECTION_TTL = Duration.ofMinutes(10)
        private const val MAX_APK_BYTES = 50L * 1024L * 1024L
        private const val MAX_SCRIPT_BYTES = 1024 * 1024
        private const val APK_FILE = "extension.apk"
        private const val SCRIPT_FILE = "extension.js"
        private const val METADATA_FILE = "metadata.json"
    }
}
