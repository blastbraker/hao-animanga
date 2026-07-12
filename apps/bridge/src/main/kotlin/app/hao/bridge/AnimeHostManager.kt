package app.hao.bridge

import java.nio.file.Files
import java.nio.file.Path
import java.security.SecureRandom
import java.time.Duration
import java.time.Instant
import java.util.Base64
import java.util.concurrent.TimeUnit

class AnimeHostManager(
    private val port: Int,
    private val dataRoot: Path,
    private val javaExecutable: Path,
    private val classpath: String,
    private val extensionRoot: Path,
    private val compatibilityJar: Path,
    private val compatibilityJarSha256: String,
) {
    private val lifecycleLock = Any()
    private val token = ByteArray(32).also(SecureRandom()::nextBytes).let { Base64.getUrlEncoder().withoutPadding().encodeToString(it) }
    private val client = AnimeHostClient(port, token)
    @Volatile private var process: Process? = null

    fun status(): RuntimeStatus = if (client.isHealthy()) {
        RuntimeStatus("aniyomi-fixture-host", MediaKind.ANIME, true, "Isolated fixture host is running")
    } else {
        RuntimeStatus("aniyomi-fixture-host", MediaKind.ANIME, false, if (Files.isRegularFile(javaExecutable)) "Isolated fixture host is stopped" else "Java runtime is unavailable")
    }

    fun ensureStarted(timeout: Duration = Duration.ofSeconds(15)): RuntimeStatus {
        if (client.isHealthy()) return status()
        require(Files.isRegularFile(javaExecutable)) { "Java runtime is unavailable" }
        synchronized(lifecycleLock) {
            if (client.isHealthy()) return status()
            if (process?.isAlive != true) process = startProcess()
        }
        val deadline = Instant.now().plus(timeout)
        while (Instant.now().isBefore(deadline)) {
            if (client.isHealthy()) return status()
            if (process?.isAlive == false) break
            Thread.sleep(150)
        }
        return status()
    }

    fun catalog(): List<AnimeCatalogItem> = withHost { client.catalog() }
    fun probes(): List<AniyomiApkProbeResult> = withHost { client.probes() }
    fun episodes(animeId: String): List<AnimeEpisode> = withHost { client.episodes(animeId) }
    fun servers(episodeId: String): List<AnimeServer> = withHost { client.servers(episodeId) }
    fun streams(episodeId: String, serverId: String): List<AnimeStream> = withHost { client.streams(episodeId, serverId) }
    fun media(streamId: String, range: String?): AnimeMediaResponse = withHost { client.media(streamId, range) }

    fun close() {
        synchronized(lifecycleLock) {
            process?.destroy()
            if (process?.waitFor(2, TimeUnit.SECONDS) == false) process?.destroyForcibly()
            process = null
        }
    }

    private fun <T> withHost(operation: () -> T): T {
        require(ensureStarted().available) { "Isolated anime fixture host could not start" }
        return try {
            operation()
        } catch (first: Exception) {
            if (first is AnimeHostRequestException && first.status in 400..499 && first.status != 401) throw first
            synchronized(lifecycleLock) {
                process?.destroyForcibly()
                process = null
            }
            require(ensureStarted().available) { "Isolated anime fixture host could not recover" }
            operation()
        }
    }

    private fun startProcess(): Process {
        Files.createDirectories(dataRoot)
        val logs = dataRoot.resolve("logs")
        Files.createDirectories(logs)
        val childClasspath = if (Files.isRegularFile(compatibilityJar) && Security.sha256(compatibilityJar) == compatibilityJarSha256) {
            classpath + java.io.File.pathSeparator + compatibilityJar
        } else classpath
        val command = listOf(
            javaExecutable.toString(),
            "-Xms32m",
            "-Xmx256m",
            "-XX:+ExitOnOutOfMemoryError",
            "-cp",
            childClasspath,
            "app.hao.bridge.AnimeHostMainKt",
        )
        val builder = ProcessBuilder(command)
            .directory(dataRoot.toFile())
            .redirectOutput(ProcessBuilder.Redirect.appendTo(logs.resolve("host.stdout.log").toFile()))
            .redirectError(ProcessBuilder.Redirect.appendTo(logs.resolve("host.stderr.log").toFile()))
        val environment = builder.environment()
        val retained = listOf("SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE").mapNotNull { key -> System.getenv(key)?.let { key to it } }.toMap()
        environment.clear()
        environment.putAll(retained)
        environment["HAO_ANIME_HOST_TOKEN"] = token
        environment["HAO_ANIME_HOST_PORT"] = port.toString()
        environment["HAO_ANIME_HOST_DATA"] = dataRoot.toString()
        environment["HAO_ANIME_HOST_PARENT_PID"] = ProcessHandle.current().pid().toString()
        environment["HAO_EXTENSION_ROOT"] = extensionRoot.toString()
        return builder.start()
    }

    companion object {
        fun default(): AnimeHostManager {
            val home = Path.of(System.getProperty("user.home"))
            val javaHome = Path.of(System.getenv("HAO_JAVA_HOME") ?: System.getProperty("java.home"))
            val executableName = if (System.getProperty("os.name").lowercase().contains("win")) "java.exe" else "java"
            return AnimeHostManager(
                System.getenv("HAO_ANIME_HOST_PORT")?.toIntOrNull() ?: 4570,
                Path.of(System.getenv("HAO_ANIME_HOST_DATA") ?: home.resolve(".hao/bridge/anime-host").toString()).toAbsolutePath().normalize(),
                javaHome.resolve("bin").resolve(executableName).toAbsolutePath().normalize(),
                System.getProperty("java.class.path"),
                Path.of(System.getenv("HAO_BRIDGE_DATA") ?: home.resolve(".hao/bridge/extensions").toString()).toAbsolutePath().normalize(),
                Path.of(System.getenv("HAO_SUWAYOMI_JAR") ?: home.resolve(".hao/suwayomi/Suwayomi-Server-v2.3.2238.jar").toString()).toAbsolutePath().normalize(),
                System.getenv("HAO_SUWAYOMI_SHA256") ?: "9ee45c37dac659a284e4a1885dcddec54a7018ead2f18620bcb1fd29751c9786",
            )
        }
    }
}
