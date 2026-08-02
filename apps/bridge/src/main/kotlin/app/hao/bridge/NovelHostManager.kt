package app.hao.bridge

import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.security.SecureRandom
import java.time.Duration
import java.time.Instant
import java.util.Base64
import java.util.concurrent.TimeUnit

class NovelHostManager(
    private val port: Int,
    private val dataRoot: Path,
    private val javaExecutable: Path,
    private val classpath: String,
    private val extensionRoot: Path,
) {
    private val lifecycleLock = Any()
    private val token = ByteArray(32).also(SecureRandom()::nextBytes).let { Base64.getUrlEncoder().withoutPadding().encodeToString(it) }
    private val client = NovelHostClient(port, token)
    @Volatile private var process: Process? = null
    @Volatile private var windowsJob: WindowsJobObject? = null

    fun status(): RuntimeStatus = if (client.isHealthy()) {
        val count = runCatching { client.sources().size }.getOrDefault(0)
        val containment = if (System.getProperty("os.name").lowercase().contains("win")) {
            if (windowsJob != null) "; Windows Job Object active" else "; Windows containment unavailable"
        } else ""
        RuntimeStatus("mangayomi-novel", MediaKind.NOVEL, true, "Isolated JavaScript novel host is running with $count source(s)$containment")
    } else RuntimeStatus("mangayomi-novel", MediaKind.NOVEL, false, if (Files.isRegularFile(javaExecutable)) "Isolated JavaScript novel host is stopped" else "Java runtime is unavailable")

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

    fun sources(): List<NovelSource> = withHost { client.sources() }
    fun catalog(sourceId: String, mode: String, query: String?, page: Int): NovelSearchResponse = withHost { client.catalog(sourceId, mode, query, page) }
    fun detail(novelId: String): NovelSummary = withHost { client.detail(novelId) }
    fun chapters(novelId: String): List<NovelChapter> = withHost { client.chapters(novelId) }
    fun chapter(chapterId: String): NovelChapterContent = withHost { client.chapter(chapterId) }

    fun restart() {
        close()
        ensureStarted()
    }

    fun close() {
        synchronized(lifecycleLock) {
            process?.destroy()
            if (process?.waitFor(2, TimeUnit.SECONDS) == false) process?.destroyForcibly()
            windowsJob?.close()
            windowsJob = null
            process = null
        }
    }

    private fun <T> withHost(operation: () -> T): T {
        require(ensureStarted().available) { "Isolated novel host could not start" }
        return try {
            operation()
        } catch (first: Exception) {
            if (first is NovelHostRequestException && first.status in 400..499 && first.status != 401) throw first
            close()
            require(ensureStarted().available) { "Isolated novel host could not recover" }
            operation()
        }
    }

    private fun startProcess(): Process {
        Files.createDirectories(dataRoot)
        val startGate = dataRoot.resolve(".start-${java.util.UUID.randomUUID()}.gate").toAbsolutePath().normalize()
        require(startGate.parent == dataRoot.toAbsolutePath().normalize()) { "Invalid novel host startup gate" }
        Files.deleteIfExists(startGate)
        val logs = dataRoot.resolve("logs")
        val temporary = dataRoot.resolve("tmp")
        Files.createDirectories(logs)
        Files.createDirectories(temporary)
        val command = listOf(
            javaExecutable.toString(),
            "-Xms32m",
            "-Xmx192m",
            "-XX:+ExitOnOutOfMemoryError",
            "-Djava.io.tmpdir=$temporary",
            "-cp",
            classpath,
            "app.hao.bridge.NovelHostMainKt",
        )
        val builder = ProcessBuilder(command)
            .directory(dataRoot.toFile())
            .redirectOutput(ProcessBuilder.Redirect.appendTo(logs.resolve("host.stdout.log").toFile()))
            .redirectError(ProcessBuilder.Redirect.appendTo(logs.resolve("host.stderr.log").toFile()))
        val environment = builder.environment()
        val retained = listOf("SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE").mapNotNull { key -> System.getenv(key)?.let { key to it } }.toMap()
        environment.clear()
        environment.putAll(retained)
        environment["HAO_NOVEL_HOST_TOKEN"] = token
        environment["HAO_NOVEL_HOST_PORT"] = port.toString()
        environment["HAO_NOVEL_HOST_DATA"] = dataRoot.toString()
        environment["HAO_NOVEL_HOST_PARENT_PID"] = ProcessHandle.current().pid().toString()
        environment["HAO_NOVEL_EXTENSION_ROOT"] = extensionRoot.toString()
        environment["HAO_NOVEL_HOST_START_GATE"] = startGate.toString()
        val child = builder.start()
        if (System.getProperty("os.name").lowercase().contains("win")) {
            try {
                windowsJob?.close()
                windowsJob = WindowsJobObject.create().also { it.assign(child.pid()) }
            } catch (error: Throwable) {
                child.destroyForcibly()
                throw IllegalStateException("Windows Job Object containment failed", error)
            }
        }
        Files.writeString(startGate, token, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)
        return child
    }

    companion object {
        fun default(): NovelHostManager {
            val home = Path.of(System.getProperty("user.home"))
            val javaHome = Path.of(System.getenv("HAO_JAVA_HOME") ?: System.getProperty("java.home"))
            val executableName = if (System.getProperty("os.name").lowercase().contains("win")) "java.exe" else "java"
            return NovelHostManager(
                System.getenv("HAO_NOVEL_HOST_PORT")?.toIntOrNull() ?: 4571,
                Path.of(System.getenv("HAO_NOVEL_HOST_DATA") ?: home.resolve(".hao/bridge/novel-host").toString()).toAbsolutePath().normalize(),
                javaHome.resolve("bin").resolve(executableName).toAbsolutePath().normalize(),
                System.getProperty("java.class.path"),
                Path.of(System.getenv("HAO_BRIDGE_DATA") ?: home.resolve(".hao/bridge/extensions").toString()).toAbsolutePath().normalize(),
            )
        }
    }
}
