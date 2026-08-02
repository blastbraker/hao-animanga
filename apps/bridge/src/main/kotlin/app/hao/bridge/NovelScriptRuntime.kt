package app.hao.bridge

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.graalvm.polyglot.Context
import org.graalvm.polyglot.HostAccess
import org.graalvm.polyglot.Value
import org.graalvm.polyglot.io.IOAccess
import org.graalvm.polyglot.proxy.ProxyArray
import org.graalvm.polyglot.proxy.ProxyExecutable
import org.graalvm.polyglot.proxy.ProxyInstantiable
import org.graalvm.polyglot.proxy.ProxyObject
import org.jsoup.Jsoup
import org.jsoup.nodes.Element
import org.jsoup.safety.Safelist
import java.net.URI
import java.net.URLEncoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.security.MessageDigest
import java.time.Duration
import java.time.Instant
import java.util.Base64
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicReference
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class NovelScriptRuntime(
    private val extensionRoot: Path,
    private val dataRoot: Path,
    private val secret: String,
) {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val extensions = ExtensionManager()
    private val codec = NovelPointerCodec(secret)

    fun sources(): List<NovelSource> = installedSources().map { installed ->
        NovelSource(
            id = installed.packageName,
            name = installed.displayName.removePrefix("Mangayomi: "),
            language = installed.language ?: "unknown",
            supportsLatest = runCatching { withEngine(installed) { it.supportsLatest() } }.getOrDefault(false),
            mature = installed.maturity != "GENERAL",
        )
    }

    fun catalog(sourceId: String, mode: String, query: String?, page: Int): NovelSearchResponse {
        require(page in 1..500) { "Novel page is invalid" }
        val installed = source(sourceId)
        val result = withEngine(installed) { engine ->
            when (mode.lowercase()) {
                "popular" -> engine.invokeObject("getPopular", listOf(page))
                "latest" -> engine.invokeObject("getLatestUpdates", listOf(page))
                "search" -> {
                    require(!query.isNullOrBlank()) { "A novel search query is required" }
                    engine.invokeObject("search", listOf(query.take(160), page, emptyList<Any>()))
                }
                else -> throw IllegalArgumentException("Novel browse mode is invalid")
            }
        }
        val list = result["list"]?.jsonArray ?: JsonArray(emptyList())
        val items = list.take(MAX_CATALOG_ITEMS).mapNotNull { item ->
            val record = item as? JsonObject ?: return@mapNotNull null
            val title = record.text("name") ?: return@mapNotNull null
            val url = resolveRemote(installed.baseUrl!!, record.text("link") ?: return@mapNotNull null)
            NovelSummary(
                id = codec.encode(NovelPointer(sourceId, url, title = title)),
                sourceId = sourceId,
                title = title.take(300),
                imageUrl = record.text("imageUrl")?.let { runCatching { resolveRemote(installed.baseUrl, it) }.getOrNull() },
            )
        }
        return NovelSearchResponse(items, result["hasNextPage"]?.jsonPrimitive?.contentOrNull?.toBooleanStrictOrNull() ?: false)
    }

    fun detail(novelId: String): NovelSummary {
        val pointer = codec.decode(novelId)
        val installed = source(pointer.sourceId)
        val detail = withEngine(installed) { it.invokeObject("getDetail", listOf(pointer.url)) }
        return NovelSummary(
            id = novelId,
            sourceId = pointer.sourceId,
            title = detail.text("name") ?: pointer.title ?: "Untitled novel",
            imageUrl = detail.text("imageUrl")?.let { runCatching { resolveRemote(installed.baseUrl!!, it) }.getOrNull() },
            author = detail.text("author"),
            description = detail.text("description")?.take(MAX_DESCRIPTION_CHARS),
            status = detail.text("status"),
            genres = detail.stringList("genre").take(40),
        )
    }

    fun chapters(novelId: String): List<NovelChapter> {
        val pointer = codec.decode(novelId)
        val installed = source(pointer.sourceId)
        val detail = withEngine(installed) { it.invokeObject("getDetail", listOf(pointer.url)) }
        val chapters = detail["chapters"]?.jsonArray ?: JsonArray(emptyList())
        return chapters.take(MAX_CHAPTERS).mapIndexedNotNull { index, item ->
            val record = item as? JsonObject ?: return@mapIndexedNotNull null
            val chapterUrl = resolveRemote(installed.baseUrl!!, record.text("url") ?: return@mapIndexedNotNull null)
            val title = record.text("name") ?: "Chapter ${index + 1}"
            NovelChapter(
                id = codec.encode(NovelPointer(pointer.sourceId, chapterUrl, novelId, title)),
                index = index,
                title = title.take(400),
                sourceId = pointer.sourceId,
                novelId = novelId,
                uploadDate = record.text("dateUpload")?.toLongOrNull(),
            )
        }
    }

    fun chapter(chapterId: String): NovelChapterContent {
        val pointer = codec.decode(chapterId)
        val novelId = pointer.parentId ?: throw IllegalArgumentException("Novel chapter reference is invalid")
        val installed = source(pointer.sourceId)
        val raw = withEngine(installed) { it.invokeString("getHtmlContent", listOf(pointer.title ?: "Chapter", pointer.url)) }
        require(raw.length <= MAX_HTML_CHARS) { "Novel chapter exceeds the reader limit" }
        return NovelChapterContent(
            chapterId = chapterId,
            novelId = novelId,
            title = pointer.title ?: "Chapter",
            html = sanitizeChapter(raw, installed.baseUrl!!),
        )
    }

    private fun installedSources(): List<InstalledPackage> = extensions.listInstalled(extensionRoot).filter {
        it.mediaKind == MediaKind.NOVEL && it.enabled && it.runtime == "MANGAYOMI_JAVASCRIPT" && it.baseUrl != null
    }

    private fun source(sourceId: String): InstalledPackage = installedSources().find { it.packageName == sourceId }
        ?: throw IllegalArgumentException("Novel source is not installed or enabled")

    private fun <T> withEngine(installed: InstalledPackage, operation: (MangayomiJavascriptEngine) -> T): T {
        val root = extensionRoot.toAbsolutePath().normalize()
        val script = Path.of(installed.localPath).toAbsolutePath().normalize()
        require(script.startsWith(root) && Files.isRegularFile(script)) { "Installed novel source is missing" }
        require(MessageDigest.isEqual(installed.sha256.encodeToByteArray(), Security.sha256(script).encodeToByteArray())) { "Installed novel source failed its integrity check" }
        val baseUrl = installed.baseUrl ?: throw IllegalArgumentException("Novel source base URL is missing")
        Security.validateRemoteHttps(baseUrl)
        val activeEngine = AtomicReference<MangayomiJavascriptEngine?>()
        val executor = Executors.newSingleThreadExecutor(Thread.ofVirtual().name("hao-novel-operation", 0).factory())
        val future = executor.submit<T> {
            MangayomiJavascriptEngine(installed, Files.readString(script), dataRoot).use { engine ->
                activeEngine.set(engine)
                operation(engine)
            }
        }
        return try {
            future.get(OPERATION_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        } catch (_: TimeoutException) {
            activeEngine.get()?.close()
            future.cancel(true)
            throw IllegalArgumentException("Novel source operation timed out")
        } catch (error: ExecutionException) {
            val cause = error.cause
            if (cause is IllegalArgumentException) throw cause
            throw IllegalArgumentException("Novel source operation failed", cause)
        } finally {
            executor.shutdownNow()
        }
    }

    private fun resolveRemote(baseUrl: String, raw: String): String {
        val value = raw.trim()
        val resolved = URI(baseUrl).resolve(value)
        return Security.validateRemoteHttps(resolved.toString()).toString()
    }

    private fun sanitizeChapter(raw: String, baseUrl: String): String {
        val safelist = Safelist()
            .addTags("p", "br", "h1", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "blockquote", "hr", "ul", "ol", "li", "a", "span", "div")
            .addAttributes("a", "href", "title")
            .addProtocols("a", "href", "https")
            .addEnforcedAttribute("a", "rel", "noopener noreferrer")
        return Jsoup.clean(raw, baseUrl, safelist).take(MAX_SANITIZED_HTML_CHARS)
    }

    private fun JsonObject.text(key: String): String? = this[key]?.jsonPrimitive?.contentOrNull?.trim()?.takeIf(String::isNotEmpty)
    private fun JsonObject.stringList(key: String): List<String> = (this[key] as? JsonArray)?.mapNotNull { it.jsonPrimitive.contentOrNull?.trim()?.takeIf(String::isNotEmpty) } ?: emptyList()

    companion object {
        private const val MAX_CATALOG_ITEMS = 60
        private const val MAX_CHAPTERS = 10_000
        private const val MAX_DESCRIPTION_CHARS = 20_000
        private const val MAX_HTML_CHARS = 2_000_000
        private const val MAX_SANITIZED_HTML_CHARS = 1_000_000
        private const val OPERATION_TIMEOUT_SECONDS = 25L
    }
}

private class MangayomiJavascriptEngine(
    installed: InstalledPackage,
    sourceCode: String,
    dataRoot: Path,
) : AutoCloseable {
    private val json = Json { ignoreUnknownKeys = true }
    private val network = NovelNetworkClient(dataRoot)
    private val context = Context.newBuilder("js")
        .allowHostAccess(HostAccess.NONE)
        .allowHostClassLookup { false }
        .allowIO(IOAccess.NONE)
        .allowNativeAccess(false)
        .allowCreateThread(false)
        .allowExperimentalOptions(true)
        .option("engine.WarnInterpreterOnly", "false")
        .build()

    init {
        val bindings = context.getBindings("js")
        bindings.putMember("Client", ClientConstructor(network))
        bindings.putMember("Document", DocumentConstructor(network))
        bindings.putMember("SharedPreferences", SharedPreferencesConstructor())
        context.eval("js", PRELUDE)
        context.eval("js", normalizeAsyncSource(sourceCode))
        val sourceJson = kotlinx.serialization.json.buildJsonObject {
            put("name", JsonPrimitive(installed.displayName.removePrefix("Mangayomi: ")))
            put("lang", JsonPrimitive(installed.language ?: "unknown"))
            put("baseUrl", JsonPrimitive(installed.baseUrl ?: ""))
            put("apiUrl", JsonPrimitive(""))
        }.toString()
        context.eval("js", "globalThis.__haoExtension = new DefaultExtension(); globalThis.__haoExtension.source = JSON.parse(${jsString(sourceJson)});")
    }

    fun supportsLatest(): Boolean = runCatching { context.eval("js", "Boolean(globalThis.__haoExtension.supportsLatest)").asBoolean() }.getOrDefault(false)

    fun invokeObject(method: String, arguments: List<Any?>): JsonObject {
        val value = invoke(method, arguments)
        val encoded = context.eval("js", "JSON.stringify").execute(value).asString()
        return json.parseToJsonElement(encoded).jsonObject
    }

    fun invokeString(method: String, arguments: List<Any?>): String {
        val value = invoke(method, arguments)
        return if (value.isString) value.asString() else value.toString()
    }

    private fun invoke(method: String, arguments: List<Any?>): Value {
        require(method in ALLOWED_METHODS) { "Novel extension operation is not allowed" }
        val function = context.getBindings("js").getMember("__haoExtension").getMember(method)
        require(function != null && function.canExecute()) { "Novel source does not implement $method" }
        val values = arguments.map(::toGuestValue).toTypedArray()
        return function.execute(*values)
    }

    private fun toGuestValue(value: Any?): Any? = when (value) {
        is List<*> -> ProxyArray.fromList(value.map(::toGuestValue))
        is Map<*, *> -> ProxyObject.fromMap(value.entries.associate { it.key.toString() to toGuestValue(it.value) }.toMutableMap())
        else -> value
    }

    override fun close() {
        context.close(true)
    }

    companion object {
        private val ALLOWED_METHODS = setOf("getPopular", "getLatestUpdates", "search", "getDetail", "getHtmlContent")
        private val ASYNC = Regex("\\basync\\s+")
        private val AWAIT = Regex("\\bawait\\s+")
        private const val PRELUDE = """
            class MProvider {
              constructor() { this.source = {}; }
              get headers() { return this.getHeaders ? this.getHeaders(this.source.baseUrl || "") : {}; }
            }
        """

        private fun normalizeAsyncSource(source: String): String = source.replace(ASYNC, "").replace(AWAIT, "")
        private fun jsString(value: String): String = buildString {
            append('"')
            value.forEach { character ->
                when (character) {
                    '\\' -> append("\\\\")
                    '"' -> append("\\\"")
                    '\n' -> append("\\n")
                    '\r' -> append("\\r")
                    '\t' -> append("\\t")
                    else -> append(character)
                }
            }
            append('"')
        }
    }
}

private class ClientConstructor(private val network: NovelNetworkClient) : ProxyInstantiable {
    override fun newInstance(vararg arguments: Value?): Any = NovelClientProxy(network)
}

private class NovelClientProxy(private val network: NovelNetworkClient) : ProxyObject {
    override fun getMember(key: String): Any? = when (key) {
        "get" -> ProxyExecutable { arguments -> network.request("GET", arguments) }
        "post" -> ProxyExecutable { arguments -> network.request("POST", arguments) }
        else -> null
    }
    override fun getMemberKeys(): Any = arrayOf("get", "post")
    override fun hasMember(key: String) = key == "get" || key == "post"
    override fun putMember(key: String, value: Value?) = Unit
}

private class DocumentConstructor(private val network: NovelNetworkClient) : ProxyInstantiable {
    override fun newInstance(vararg arguments: Value?): Any {
        val html = arguments.firstOrNull()?.takeUnless(Value::isNull)?.asString() ?: ""
        return JsoupProxy(Jsoup.parse(html, network.lastUrl))
    }
}

private class SharedPreferencesConstructor : ProxyInstantiable {
    override fun newInstance(vararg arguments: Value?): Any = ProxyObject.fromMap(mutableMapOf<String, Any>(
        "get" to ProxyExecutable { "" },
        "set" to ProxyExecutable { null },
    ))
}

private class JsoupProxy(private val element: Element) : ProxyObject {
    override fun getMember(key: String): Any? = when (key) {
        "text" -> element.text()
        "innerHtml" -> element.html()
        "outerHtml" -> element.outerHtml()
        "getSrc" -> element.absUrl("src").ifBlank { element.attr("src") }
        "getHref" -> element.absUrl("href").ifBlank { element.attr("href") }
        "attr" -> ProxyExecutable { args -> element.attr(args.firstOrNull()?.asString() ?: "") }
        "select" -> ProxyExecutable { args -> ProxyArray.fromList(element.select(args.firstOrNull()?.asString() ?: "").map(::JsoupProxy)) }
        "selectFirst" -> ProxyExecutable { args -> element.selectFirst(args.firstOrNull()?.asString() ?: "")?.let(::JsoupProxy) }
        else -> null
    }
    override fun getMemberKeys(): Any = arrayOf("text", "innerHtml", "outerHtml", "getSrc", "getHref", "attr", "select", "selectFirst")
    override fun hasMember(key: String) = key in (getMemberKeys() as Array<*>)
    override fun putMember(key: String, value: Value?) = Unit
}

private class NovelNetworkClient(private val dataRoot: Path) {
    private val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).followRedirects(HttpClient.Redirect.NEVER).build()
    @Volatile var lastUrl: String = ""
        private set

    fun request(method: String, arguments: Array<out Value?>): Any {
        val rawUrl = arguments.firstOrNull()?.takeUnless { it.isNull }?.asString() ?: throw IllegalArgumentException("Novel source URL is missing")
        val headers = arguments.getOrNull(1)?.let(::headersFrom) ?: emptyMap()
        val body = arguments.getOrNull(2)?.let(::bodyFrom)
        var uri = Security.validateRemoteHttps(rawUrl)
        repeat(4) { redirect ->
            val builder = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(20)).header("User-Agent", headers["User-Agent"] ?: DEFAULT_USER_AGENT)
            headers.filterKeys { it.lowercase() !in BLOCKED_HEADERS }.forEach { (key, value) -> builder.header(key, value) }
            if (method == "POST") builder.POST(HttpRequest.BodyPublishers.ofString(body ?: "")) else builder.GET()
            val response = client.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray())
            appendNetworkEvent(uri.host, response.statusCode())
            if (response.statusCode() in 300..399) {
                require(redirect < 3) { "Novel source redirected too many times" }
                val location = response.headers().firstValue("location").orElseThrow { IllegalArgumentException("Novel source redirect is missing a destination") }
                uri = Security.validateRemoteHttps(uri.resolve(location).toString())
                return@repeat
            }
            require(response.statusCode() in 200..299) { "Novel source returned HTTP ${response.statusCode()}" }
            require(response.body().size <= MAX_RESPONSE_BYTES) { "Novel source response exceeds 5 MiB" }
            lastUrl = uri.toString()
            return ProxyObject.fromMap(mutableMapOf(
                "body" to response.body().toString(StandardCharsets.UTF_8),
                "statusCode" to response.statusCode(),
                "headers" to ProxyObject.fromMap(response.headers().map().mapValues { it.value.joinToString(", ") as Any }.toMutableMap()),
            ))
        }
        throw IllegalArgumentException("Novel source request failed")
    }

    private fun headersFrom(value: Value): Map<String, String> {
        if (value.isNull || !value.hasMembers()) return emptyMap()
        return value.memberKeys.take(50).mapNotNull { key ->
            val member = value.getMember(key)
            if (member == null || member.isNull) null else key.take(80) to member.toString().take(2_000)
        }.toMap()
    }

    private fun bodyFrom(value: Value): String? = when {
        value.isNull -> null
        value.isString -> value.asString().take(MAX_REQUEST_BODY_CHARS)
        value.hasMembers() -> value.memberKeys.take(100).joinToString("&") { key ->
            val member = value.getMember(key)
            "${encode(key)}=${encode(if (member == null || member.isNull) "" else member.toString())}"
        }.take(MAX_REQUEST_BODY_CHARS)
        else -> value.toString().take(MAX_REQUEST_BODY_CHARS)
    }

    @Synchronized private fun appendNetworkEvent(host: String, status: Int) {
        Files.createDirectories(dataRoot)
        Files.writeString(
            dataRoot.resolve("extension-network.log"),
            "${Instant.now()}\t$host\tHTTP:$status${System.lineSeparator()}",
            StandardOpenOption.CREATE,
            StandardOpenOption.APPEND,
            StandardOpenOption.WRITE,
        )
    }

    private fun encode(value: String) = URLEncoder.encode(value, StandardCharsets.UTF_8)

    companion object {
        private const val DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 HAO-Novel-Bridge/0.1"
        private const val MAX_RESPONSE_BYTES = 5 * 1024 * 1024
        private const val MAX_REQUEST_BODY_CHARS = 64 * 1024
        private val BLOCKED_HEADERS = setOf(
            "host",
            "content-length",
            "connection",
            "cookie",
            "authorization",
            "proxy-authorization",
            "accept-encoding",
            "user-agent",
        )
    }
}

@Serializable private data class NovelPointer(
    val sourceId: String,
    val url: String,
    val parentId: String? = null,
    val title: String? = null,
)

private class NovelPointerCodec(secret: String) {
    private val json = Json { encodeDefaults = true; ignoreUnknownKeys = false }
    private val key = SecretKeySpec(secret.encodeToByteArray(), "HmacSHA256")

    fun encode(pointer: NovelPointer): String {
        val payload = Base64.getUrlEncoder().withoutPadding().encodeToString(json.encodeToString(pointer).encodeToByteArray())
        return "$payload.${signature(payload)}"
    }

    fun decode(value: String): NovelPointer {
        require(value.length <= 16_000) { "Novel reference is too long" }
        val parts = value.split('.', limit = 2)
        require(parts.size == 2 && MessageDigest.isEqual(signature(parts[0]).encodeToByteArray(), parts[1].encodeToByteArray())) { "Novel reference is invalid" }
        val pointer = json.decodeFromString<NovelPointer>(Base64.getUrlDecoder().decode(parts[0]).decodeToString())
        Security.validateRemoteHttps(pointer.url)
        return pointer
    }

    private fun signature(payload: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(key)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(payload.encodeToByteArray()).copyOf(18))
    }
}
