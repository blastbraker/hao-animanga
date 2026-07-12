package app.hao.bridge

import com.android.apksig.internal.apk.AndroidBinXmlParser
import java.nio.ByteBuffer
import java.nio.file.Path
import java.util.zip.ZipFile

data class ParsedApkManifest(
    val packageName: String,
    val versionName: String,
    val permissions: List<String>,
    val animeSourceClasses: List<String>,
)

object ApkManifestReader {
    fun read(apk: Path): ParsedApkManifest {
        val bytes = ZipFile(apk.toFile()).use { archive ->
            val entry = archive.getEntry("AndroidManifest.xml") ?: error("APK is missing AndroidManifest.xml")
            archive.getInputStream(entry).use { it.readAllBytes() }
        }
        val parser = AndroidBinXmlParser(ByteBuffer.wrap(bytes))
        var packageName = ""
        var versionName = "unknown"
        val permissions = mutableListOf<String>()
        val rawSourceClasses = mutableListOf<String>()
        while (parser.next() != AndroidBinXmlParser.EVENT_END_DOCUMENT) {
            if (parser.eventType != AndroidBinXmlParser.EVENT_START_ELEMENT) continue
            val attributes = (0 until parser.attributeCount).associate { index ->
                parser.getAttributeName(index) to attributeValue(parser, index)
            }
            when (parser.name) {
                "manifest" -> {
                    packageName = attributes["package"].orEmpty()
                    versionName = attributes["versionName"] ?: "unknown"
                }
                "uses-permission", "uses-permission-sdk-23" -> attributes["name"]?.let(permissions::add)
                "meta-data" -> if (attributes["name"] == SOURCE_CLASS_METADATA) {
                    attributes["value"]?.let(rawSourceClasses::add)
                }
            }
        }
        require(packageName.isNotBlank()) { "APK manifest has no package name" }
        val classes = rawSourceClasses.flatMap { it.split(';') }.map(String::trim).filter(String::isNotEmpty).map {
            if (it.startsWith('.')) packageName + it else it
        }
        return ParsedApkManifest(packageName, versionName, permissions.distinct().sorted(), classes)
    }

    private fun attributeValue(parser: AndroidBinXmlParser, index: Int): String = when (parser.getAttributeValueType(index)) {
        AndroidBinXmlParser.VALUE_TYPE_STRING -> parser.getAttributeStringValue(index)
        AndroidBinXmlParser.VALUE_TYPE_INT, AndroidBinXmlParser.VALUE_TYPE_REFERENCE -> parser.getAttributeIntValue(index).toString()
        AndroidBinXmlParser.VALUE_TYPE_BOOLEAN -> parser.getAttributeBooleanValue(index).toString()
        else -> ""
    }

    private const val SOURCE_CLASS_METADATA = "tachiyomi.animeextension.class"
}
