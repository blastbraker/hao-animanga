package app.hao.bridge

import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration
import java.time.Instant

fun main() {
    val token = System.getenv("HAO_NOVEL_HOST_TOKEN") ?: error("HAO_NOVEL_HOST_TOKEN is required")
    val port = System.getenv("HAO_NOVEL_HOST_PORT")?.toIntOrNull() ?: error("HAO_NOVEL_HOST_PORT is required")
    require(port in 1024..65535) { "Novel host port is invalid" }
    val dataRoot = Path.of(System.getenv("HAO_NOVEL_HOST_DATA") ?: error("HAO_NOVEL_HOST_DATA is required")).toAbsolutePath().normalize()
    val extensionRoot = Path.of(System.getenv("HAO_NOVEL_EXTENSION_ROOT") ?: error("HAO_NOVEL_EXTENSION_ROOT is required")).toAbsolutePath().normalize()
    val parentPid = System.getenv("HAO_NOVEL_HOST_PARENT_PID")?.toLongOrNull() ?: error("HAO_NOVEL_HOST_PARENT_PID is required")
    val gate = Path.of(System.getenv("HAO_NOVEL_HOST_START_GATE") ?: error("HAO_NOVEL_HOST_START_GATE is required")).toAbsolutePath().normalize()
    require(gate.parent == dataRoot) { "Novel host startup gate escapes its data directory" }
    val gateDeadline = Instant.now().plus(Duration.ofSeconds(15))
    while (Instant.now().isBefore(gateDeadline)) {
        if (Files.isRegularFile(gate) && Files.readString(gate) == token) break
        Thread.sleep(25)
    }
    require(Files.isRegularFile(gate) && Files.readString(gate) == token) { "Novel host startup gate was not released" }
    Files.deleteIfExists(gate)
    val app = NovelHostServer.create(token, dataRoot, extensionRoot).start("127.0.0.1", port)
    Thread.ofVirtual().name("hao-novel-parent-watch").start {
        while (ProcessHandle.of(parentPid).map { it.isAlive }.orElse(false)) Thread.sleep(500)
        app.stop()
        kotlin.system.exitProcess(0)
    }
}
