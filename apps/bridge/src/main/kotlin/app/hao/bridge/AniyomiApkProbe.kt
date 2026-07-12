package app.hao.bridge

import com.android.apksig.ApkVerifier
import kotlinx.serialization.json.Json
import net.dongliu.apk.parser.ApkFile
import org.w3c.dom.Element
import java.io.File
import java.net.URLClassLoader
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.util.zip.ZipFile
import javax.xml.parsers.DocumentBuilderFactory

class AniyomiApkProbe(
    private val extensionRoot: Path,
    private val dataRoot: Path,
) {
    private val json = Json { ignoreUnknownKeys = true }

    fun probeInstalled(): List<AniyomiApkProbeResult> {
        val animeRoot = extensionRoot.resolve("anime")
        if (!Files.isDirectory(animeRoot)) return emptyList()
        return Files.list(animeRoot).use { directories ->
            directories.filter(Files::isDirectory).map(::probeDirectory).toList()
        }.sortedBy { it.displayName.lowercase() }
    }

    private fun probeDirectory(directory: Path): AniyomiApkProbeResult {
        val metadataPath = directory.resolve("metadata.json")
        var installed: InstalledPackage? = null
        return try {
            require(Files.isRegularFile(metadataPath)) { "Installation metadata is missing" }
            installed = json.decodeFromString<InstalledPackage>(Files.readString(metadataPath))
            require(installed.mediaKind == MediaKind.ANIME) { "Package is not an anime extension" }
            require(installed.enabled) { "Extension is disabled" }
            val apk = Path.of(installed.localPath).toAbsolutePath().normalize()
            require(apk.parent == directory.toAbsolutePath().normalize()) { "APK path escapes its package directory" }
            require(Files.isRegularFile(apk)) { "Installed APK is missing" }
            require(Security.sha256(apk) == installed.sha256) { "Installed APK hash changed" }
            require(ApkVerifier.Builder(apk.toFile()).build().verify().isVerified) { "Installed APK signature is invalid" }

            val manifest = parseManifest(apk)
            require(manifest.packageName == installed.packageName) { "APK manifest identity changed" }
            require(manifest.sourceClasses.isNotEmpty()) { "Aniyomi source class metadata is missing" }
            val translated = translateDex(apk, installed.sha256)
            val apiJar = extractApiJar()
            URLClassLoader(arrayOf(translated.toUri().toURL(), apiJar.toUri().toURL()), javaClass.classLoader).use { loader ->
                manifest.sourceClasses.forEach { Class.forName(it, false, loader) }
            }
            AniyomiApkProbeResult(installed.packageName, installed.displayName, installed.version, true, manifest.sourceClasses, "Signature, manifest, API v14, and Dex class linkage passed")
        } catch (error: Throwable) {
            val packageName = installed?.packageName ?: directory.fileName.toString()
            AniyomiApkProbeResult(packageName, installed?.displayName ?: packageName, installed?.version ?: "unknown", false, message = error.message ?: error.javaClass.simpleName)
        }
    }

    private fun translateDex(apk: Path, sha256: String): Path {
        val output = dataRoot.resolve("translated").resolve("$sha256.jar")
        if (Files.isRegularFile(output)) return output
        Files.createDirectories(output.parent)
        val temporary = output.resolveSibling("${output.fileName}.tmp")
        Files.deleteIfExists(temporary)
        val dex2jar = Class.forName("com.googlecode.d2j.dex.Dex2jar")
        val translator = dex2jar.getMethod("from", File::class.java).invoke(null, apk.toFile())
        dex2jar.getMethod("to", Path::class.java).invoke(translator, temporary)
        require(Files.size(temporary) > 0) { "Dex translation produced an empty archive" }
        Files.move(temporary, output, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        return output
    }

    private fun extractApiJar(): Path {
        val aar = System.getProperty("java.class.path").split(File.pathSeparator)
            .map(Path::of)
            .firstOrNull { it.fileName.toString().startsWith("extensions-lib-14") && it.fileName.toString().endsWith(".aar") }
            ?: error("Aniyomi API v14 archive is unavailable")
        val output = dataRoot.resolve("runtime").resolve("aniyomi-api-v14.jar")
        if (Files.isRegularFile(output) && Files.getLastModifiedTime(output) >= Files.getLastModifiedTime(aar)) return output
        Files.createDirectories(output.parent)
        ZipFile(aar.toFile()).use { archive ->
            val entry = archive.getEntry("classes.jar") ?: error("Aniyomi API archive has no classes.jar")
            archive.getInputStream(entry).use { input -> Files.copy(input, output, StandardCopyOption.REPLACE_EXISTING) }
        }
        return output
    }

    private fun parseManifest(apk: Path): ManifestInfo {
        val xml = ApkFile(apk.toFile()).use { it.manifestXml }
        val document = DocumentBuilderFactory.newInstance().apply {
            setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
            isExpandEntityReferences = false
        }.newDocumentBuilder().parse(xml.byteInputStream())
        val packageName = document.documentElement.getAttribute("package")
        val application = document.getElementsByTagName("application").item(0) ?: error("APK manifest has no application")
        val rawClasses = (0 until application.childNodes.length).asSequence()
            .map { application.childNodes.item(it) }
            .filterIsInstance<Element>()
            .firstOrNull { it.tagName == "meta-data" && it.getAttribute("android:name") == SOURCE_CLASS_METADATA }
            ?.getAttribute("android:value")
            .orEmpty()
        val classes = rawClasses.split(';').map(String::trim).filter(String::isNotEmpty).map {
            if (it.startsWith('.')) packageName + it else it
        }
        return ManifestInfo(packageName, classes)
    }

    private data class ManifestInfo(val packageName: String, val sourceClasses: List<String>)

    companion object {
        private const val SOURCE_CLASS_METADATA = "tachiyomi.animeextension.class"
    }
}
