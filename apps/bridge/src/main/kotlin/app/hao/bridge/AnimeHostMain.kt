package app.hao.bridge

import java.nio.file.Path

fun main() {
    val token = System.getenv("HAO_ANIME_HOST_TOKEN") ?: error("HAO_ANIME_HOST_TOKEN is required")
    val port = System.getenv("HAO_ANIME_HOST_PORT")?.toIntOrNull() ?: error("HAO_ANIME_HOST_PORT is required")
    require(port in 1024..65535) { "Anime host port is invalid" }
    val dataRoot = Path.of(System.getenv("HAO_ANIME_HOST_DATA") ?: error("HAO_ANIME_HOST_DATA is required")).toAbsolutePath().normalize()
    val extensionRoot = Path.of(System.getenv("HAO_EXTENSION_ROOT") ?: error("HAO_EXTENSION_ROOT is required")).toAbsolutePath().normalize()
    val parentPid = System.getenv("HAO_ANIME_HOST_PARENT_PID")?.toLongOrNull() ?: error("HAO_ANIME_HOST_PARENT_PID is required")
    val app = AnimeHostServer.create(token, dataRoot, extensionRoot).start("127.0.0.1", port)
    Thread.ofVirtual().name("hao-anime-parent-watch").start {
        while (ProcessHandle.of(parentPid).map { it.isAlive }.orElse(false)) Thread.sleep(500)
        app.stop()
        kotlin.system.exitProcess(0)
    }
}
