package app.hao.bridge

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import org.jsoup.Jsoup
import java.io.BufferedReader
import java.io.BufferedWriter
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.FileTime
import java.security.MessageDigest
import java.time.Instant
import java.util.Base64
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit

data class NarrationVoice(val id: String, val name: String, val language: String)
data class NarrationManifest(val id: String, val fingerprint: String, val title: String, val passages: List<String>)
@kotlinx.serialization.Serializable data class NarrationAudioRequest(val manifestId: String, val index: Int, val voice: String)
class NarrationUnavailable(message: String, val status: Int = 503) : RuntimeException(message)

/** No arbitrary text or URLs are accepted by the public API: only fetched novel chapters. */
class NarrationService(private val worker: KokoroWorker = KokoroWorker.default()) : AutoCloseable {
    private val gate = Semaphore(1)
    private val manifests = LinkedHashMap<String, Pair<Long, NarrationManifest>>()
    private var windowStart = 0L
    private var manifestRequests = 0

    fun status(): Map<String, Any> = mapOf("engine" to "kokoro", "available" to worker.installed(), "voices" to voices,
        "message" to if (worker.installed()) "Kokoro runs locally on this Bridge. English voices only." else "The Bridge owner needs to install the Kokoro narrator. See docs/kokoro-narration.md.")

    @Synchronized fun manifest(chapter: () -> NovelChapterContent): NarrationManifest {
        if (!worker.installed()) throw NarrationUnavailable("Kokoro is not installed on this Bridge yet.")
        val now = System.currentTimeMillis()
        if (now - windowStart > 60_000) { windowStart = now; manifestRequests = 0 }
        if (++manifestRequests > 30) throw NarrationUnavailable("Too many listening requests. Try again in a minute.", 429)
        val content = chapter()
        val passages = narrationPassages(content.html)
        require(passages.isNotEmpty()) { "This chapter has no readable text" }
        val fingerprint = digest(passages.joinToString("\n"))
        manifests.entries.removeIf { now - it.value.first > 2 * 60 * 60_000L }
        val existing = manifests.values.firstOrNull { it.second.fingerprint == fingerprint }?.second
        if (existing != null) { manifests[existing.id] = now to existing; return existing }
        while (manifests.size >= 32) manifests.remove(manifests.keys.first())
        return NarrationManifest(UUID.randomUUID().toString(), fingerprint, content.title, passages).also { manifests[it.id] = now to it }
    }

    fun audio(request: NarrationAudioRequest): ByteArray {
        require(voices.any { it.id == request.voice }) { "Choose a built-in Kokoro voice" }
        val manifest = synchronized(this) {
            val entry = manifests[request.manifestId]
            if (entry == null || System.currentTimeMillis() - entry.first > 2 * 60 * 60_000L)
                throw NarrationUnavailable("This listening session expired. Close and reopen Listen.", 410)
            entry.second
        }
        val text = manifest.passages.getOrNull(request.index) ?: throw IllegalArgumentException("Invalid passage")
        val key = digest("kokoro-v1-q8-pcm16-v1\n${request.voice}\n$text")
        worker.cached(key)?.let { return it }
        // No unbounded queue. Readers retry busy requests without holding more workers.
        if (!gate.tryAcquire()) throw NarrationUnavailable("Kokoro is preparing another passage. Please wait a moment.", 429)
        try { return worker.cached(key) ?: worker.generate(key, text, request.voice) } finally { gate.release() }
    }

    override fun close() = worker.close()

    companion object {
        val voices = listOf(
            NarrationVoice("af_heart", "Heart", "American English"), NarrationVoice("af_bella", "Bella", "American English"),
            NarrationVoice("af_nicole", "Nicole", "American English"), NarrationVoice("am_michael", "Michael", "American English"),
            NarrationVoice("am_fenrir", "Fenrir", "American English"), NarrationVoice("bf_emma", "Emma", "British English"),
            NarrationVoice("bm_george", "George", "British English"),
        )
    }
}

internal fun narrationPassages(html: String): List<String> {
    require(html.length <= 2_000_000) { "This chapter is too large to narrate" }
    val body = Jsoup.parseBodyFragment(html).body()
    body.select("script,style,nav,button,iframe,noscript").remove()
    body.select("br,p,div,h1,h2,h3,h4,h5,h6,li,blockquote").forEach { it.appendText("\n") }
    val text = body.wholeText().replace(Regex("[\\p{Cc}&&[^\\n\\t]]"), "")
    require(text.length <= 200_000) { "This chapter is too long to narrate in one session" }
    val result = mutableListOf<String>()
    for (paragraph in text.split('\n')) {
        var remaining = paragraph.replace(Regex("\\s+"), " ").trim()
        while (remaining.length > 320) {
            val sentence = Regex("[.!?][\"'’”]? ").findAll(remaining.take(321)).lastOrNull()?.range?.last
            var boundary = sentence?.takeIf { it >= 100 } ?: remaining.lastIndexOf(' ', 320).takeIf { it > 0 } ?: 320
            if (boundary < remaining.length && Character.isLowSurrogate(remaining[boundary])) boundary--
            result.add(remaining.take(boundary).trim())
            remaining = remaining.drop(boundary).trim()
        }
        if (remaining.isNotEmpty()) {
            // Combine short neighboring paragraphs to keep narration natural.
            if (result.isNotEmpty() && result.last().length + remaining.length < 280) result[result.lastIndex] += "\n" + remaining
            else result.add(remaining)
        }
    }
    require(result.size <= 1500) { "This chapter has too many passages" }
    return result
}

internal fun digest(text: String): String = MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }

class KokoroWorker(private val script: Path, private val node: String, private val data: Path) : AutoCloseable {
    private val mapper = jacksonObjectMapper()
    private var process: Process? = null
    private var input: BufferedWriter? = null
    private var output: BufferedReader? = null
    private var job: WindowsJobObject? = null
    private val cache = data.resolve("audio")
    fun installed(): Boolean = Files.isRegularFile(script) && Files.isDirectory(script.parent.resolve("node_modules/kokoro-js"))

    fun cached(key: String): ByteArray? {
        val path = cache.resolve("$key.wav")
        if (!Files.isRegularFile(path)) return null
        return runCatching {
            if (Files.size(path) !in 45..6_000_000L) return null
            Files.setLastModifiedTime(path, FileTime.from(Instant.now()))
            Files.readAllBytes(path).takeIf { it.take(4).toByteArray().decodeToString() == "RIFF" }
        }.getOrNull()
    }

    @Synchronized fun generate(key: String, text: String, voice: String): ByteArray {
        if (process?.isAlive != true) start()
        val id = UUID.randomUUID().toString()
        try {
            input!!.write(mapper.writeValueAsString(mapOf("id" to id, "text" to text, "voice" to voice)) + "\n")
            input!!.flush()
            val reader = output!!
            val result = CompletableFuture.supplyAsync { reader.readLine() }.get(180, TimeUnit.SECONDS)
                ?: throw NarrationUnavailable("Kokoro stopped. Retry to restart it.")
            require(result.length < 8_100_000) { "Invalid Kokoro response" }
            val response = mapper.readTree(result)
            if (response.path("id").asText() != id || response.has("error")) throw NarrationUnavailable("Kokoro could not prepare this passage. Check the narrator log and retry.")
            val bytes = Base64.getDecoder().decode(response.path("audio").asText())
            require(bytes.size in 45..6_000_000 && bytes.take(4).toByteArray().decodeToString() == "RIFF") { "Invalid narration audio" }
            Files.createDirectories(cache)
            Files.write(cache.resolve("$key.wav"), bytes)
            trimCache()
            return bytes
        } catch (error: Exception) {
            close()
            if (error is NarrationUnavailable) throw error
            throw NarrationUnavailable("Kokoro could not start or timed out. The first model download can take a few minutes; retry after checking the Bridge narrator log.")
        }
    }

    private fun start() {
        if (!installed()) throw NarrationUnavailable("Install the Kokoro narrator on the Bridge first.")
        close() // Release an exited/idle worker's Windows Job Object before replacing it.
        Files.createDirectories(data)
        val builder = ProcessBuilder(node, "--max-old-space-size=512", script.toString()).directory(script.parent.toFile())
            .redirectError(ProcessBuilder.Redirect.appendTo(data.resolve("narrator.log").toFile()))
        val retained = listOf("SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "PATH").mapNotNull { name -> System.getenv(name)?.let { name to it } }.toMap()
        builder.environment().clear(); builder.environment().putAll(retained)
        builder.environment()["HAO_NARRATION_DATA"] = data.toString()
        builder.environment()["HAO_NARRATION_PARENT_PID"] = ProcessHandle.current().pid().toString()
        val child = builder.start()
        process = child
        try {
            if (System.getProperty("os.name").lowercase().contains("win")) {
                job = WindowsJobObject.create(1536L * 1024 * 1024).also { it.assign(child.pid()) }
            }
            input = child.outputStream.bufferedWriter(Charsets.UTF_8)
            output = child.inputStream.bufferedReader(Charsets.UTF_8)
        } catch (error: Exception) { close(); throw error }
    }

    private fun trimCache() {
        Files.list(cache).use { paths ->
            val files = paths.filter { it.fileName.toString().matches(Regex("[a-f0-9]{64}\\.wav")) }.toList().sortedBy { Files.getLastModifiedTime(it).toMillis() }
            var total = files.sumOf { Files.size(it) }
            for (file in files) {
                if (total <= 256L * 1024 * 1024) break
                val size = Files.size(file)
                if (Files.deleteIfExists(file)) total -= size
            }
        }
    }

    @Synchronized override fun close() {
        process?.destroy()
        if (process?.waitFor(2, TimeUnit.SECONDS) == false) process?.destroyForcibly()
        job?.close(); job = null; process = null; input = null; output = null
    }

    companion object {
        fun default(): KokoroWorker {
            val devScript = Path.of("apps/bridge/narrator/worker.mjs").toAbsolutePath().normalize()
            val installedScript = runCatching { Path.of(KokoroWorker::class.java.protectionDomain.codeSource.location.toURI()).parent.parent.resolve("narrator/worker.mjs") }.getOrDefault(devScript)
            return KokoroWorker(
                System.getenv("HAO_KOKORO_SCRIPT")?.let { Path.of(it).toAbsolutePath().normalize() } ?: if (Files.isRegularFile(devScript)) devScript else installedScript,
                System.getenv("HAO_NODE_PATH") ?: if (System.getProperty("os.name").lowercase().contains("win") && Files.isRegularFile(Path.of("C:/Program Files/nodejs/node.exe"))) "C:/Program Files/nodejs/node.exe" else "node",
                Path.of(System.getenv("HAO_NARRATION_DATA") ?: Path.of(System.getProperty("user.home"), ".hao/bridge/narration").toString()).toAbsolutePath().normalize(),
            )
        }
    }
}
