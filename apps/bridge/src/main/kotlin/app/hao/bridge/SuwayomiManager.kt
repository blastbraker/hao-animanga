package app.hao.bridge

import java.net.InetAddress
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration
import java.time.Instant

class SuwayomiManager(
    private val client: SuwayomiClient,
    private val jarPath: Path,
    private val dataRoot: Path,
    private val javaExecutable: Path,
    private val expectedJarSha256: String,
) {
    private val lifecycleLock = Any()
    @Volatile private var managedProcess: Process? = null
    private val jarTrusted: Boolean by lazy {
        runCatching { Files.isRegularFile(jarPath) && expectedJarSha256.matches(Regex("[a-fA-F0-9]{64}")) && Security.sha256(jarPath).equals(expectedJarSha256, ignoreCase = true) }.getOrDefault(false)
    }

    val managed: Boolean
        get() = client.baseUri.scheme == "http" &&
            runCatching { InetAddress.getByName(client.baseUri.host).isLoopbackAddress }.getOrDefault(false) &&
            jarTrusted && Files.isRegularFile(javaExecutable)

    fun status(): MangaRuntimeStatus {
        if (!client.isHealthy()) {
            val detail = when {
                client.baseUri.scheme != "http" || !runCatching { InetAddress.getByName(client.baseUri.host).isLoopbackAddress }.getOrDefault(false) -> "Remote Suwayomi is externally managed and unavailable"
                !Files.isRegularFile(jarPath) -> "Suwayomi Server JAR is not installed at $jarPath"
                !jarTrusted -> "Suwayomi Server JAR checksum does not match the trusted release"
                !Files.isRegularFile(javaExecutable) -> "Java runtime is missing at $javaExecutable"
                else -> "Suwayomi is stopped"
            }
            return MangaRuntimeStatus(false, managed, detail)
        }
        val sources = runCatching { client.sources().size }.getOrDefault(0)
        val extensions = runCatching { client.installedExtensions().size }.getOrDefault(0)
        return MangaRuntimeStatus(true, managed, "Suwayomi is running", sources, extensions)
    }

    fun ensureStarted(timeout: Duration = Duration.ofSeconds(45)): MangaRuntimeStatus {
        if (client.isHealthy()) return status()
        if (!managed) return status()
        synchronized(lifecycleLock) {
            if (client.isHealthy()) return status()
            if (managedProcess?.isAlive != true) managedProcess = startProcess()
        }
        val deadline = Instant.now().plus(timeout)
        while (Instant.now().isBefore(deadline)) {
            if (client.isHealthy()) return status()
            if (managedProcess?.isAlive == false) break
            Thread.sleep(300)
        }
        return status()
    }

    fun sync(installedPackages: List<InstalledPackage>): ExtensionSyncResult {
        val runtimeStatus = ensureStarted()
        if (!runtimeStatus.running) return ExtensionSyncResult(errors = listOf(runtimeStatus.message))
        val runtime = client.installedExtensions().associateBy { it.packageName }.toMutableMap()
        val installed = mutableListOf<String>()
        val removed = mutableListOf<String>()
        val unchanged = mutableListOf<String>()
        val errors = mutableListOf<String>()
        val mangaPackages = installedPackages.filter { it.mediaKind == MediaKind.MANGA }

        mangaPackages.filter { it.enabled }.forEach { item ->
            runCatching {
                val apk = Path.of(item.localPath).toAbsolutePath().normalize()
                require(Files.isRegularFile(apk)) { "reviewed APK is missing" }
                require(Security.sha256(apk) == item.sha256) { "reviewed APK hash changed" }
                val current = runtime[item.packageName]
                if (current?.version == item.version) {
                    unchanged += item.packageName
                } else {
                    client.installExtension(apk, item.packageName)
                    installed += item.packageName
                    runtime[item.packageName] = SuwayomiExtension(item.packageName, item.version)
                }
            }.onFailure { error -> errors += "${item.packageName}: ${error.message ?: "synchronization failed"}" }
        }

        mangaPackages.filterNot { it.enabled }.forEach { item ->
            if (runtime[item.packageName] == null) return@forEach
            runCatching { client.uninstallExtension(item.packageName); removed += item.packageName; runtime.remove(item.packageName) }
                .onFailure { error -> errors += "${item.packageName}: ${error.message ?: "removal failed"}" }
        }
        return ExtensionSyncResult(installed, removed, unchanged, errors)
    }

    fun uninstall(packageName: String) {
        if (!client.isHealthy()) return
        if (client.installedExtensions().none { it.packageName == packageName }) return
        client.uninstallExtension(packageName)
    }

    private fun startProcess(): Process {
        require(jarTrusted) { "Suwayomi Server JAR checksum does not match the trusted release" }
        Files.createDirectories(dataRoot)
        val logRoot = dataRoot.resolve("logs")
        Files.createDirectories(logRoot)
        val host = client.baseUri.host
        val port = if (client.baseUri.port == -1) 4567 else client.baseUri.port
        val command = listOf(
            javaExecutable.toString(),
            "-Dsuwayomi.tachidesk.config.server.rootDir=$dataRoot",
            "-Dsuwayomi.tachidesk.config.server.ip=$host",
            "-Dsuwayomi.tachidesk.config.server.port=$port",
            "-Dsuwayomi.tachidesk.config.server.initialOpenInBrowserEnabled=false",
            "-Dsuwayomi.tachidesk.config.server.webUIEnabled=false",
            "-Dsuwayomi.tachidesk.config.server.systemTrayEnabled=false",
            "-jar",
            jarPath.toString(),
        )
        return ProcessBuilder(command)
            .directory(dataRoot.toFile())
            .redirectOutput(ProcessBuilder.Redirect.appendTo(logRoot.resolve("server.stdout.log").toFile()))
            .redirectError(ProcessBuilder.Redirect.appendTo(logRoot.resolve("server.stderr.log").toFile()))
            .start()
    }

    companion object {
        fun default(client: SuwayomiClient): SuwayomiManager {
            val home = Path.of(System.getProperty("user.home"))
            val javaHome = Path.of(System.getenv("HAO_JAVA_HOME") ?: System.getProperty("java.home"))
            val executableName = if (System.getProperty("os.name").lowercase().contains("win")) "java.exe" else "java"
            return SuwayomiManager(
                client,
                Path.of(System.getenv("HAO_SUWAYOMI_JAR") ?: home.resolve(".hao/suwayomi/Suwayomi-Server-v2.3.2238.jar").toString()).toAbsolutePath().normalize(),
                Path.of(System.getenv("HAO_SUWAYOMI_DATA") ?: home.resolve(".hao/suwayomi/data").toString()).toAbsolutePath().normalize(),
                javaHome.resolve("bin").resolve(executableName).toAbsolutePath().normalize(),
                System.getenv("HAO_SUWAYOMI_SHA256") ?: "9ee45c37dac659a284e4a1885dcddec54a7018ead2f18620bcb1fd29751c9786",
            )
        }
    }
}
