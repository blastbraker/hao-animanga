package app.hao.bridge

import java.nio.file.Files
import java.net.URI
import java.util.Comparator
import kotlin.io.path.createTempDirectory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse

class ExtensionManagerTest {
    private val manager = ExtensionManager()

    @Test
    fun `maturity labels default safely`() {
        assertEquals("GENERAL", manager.maturity(null))
        assertEquals("GENERAL", manager.maturity(0))
        assertEquals("MATURE", manager.maturity(1))
        assertEquals("ADULT", manager.maturity(2))
    }

    @Test
    fun `storage operations reject path traversal package names`() {
        val root = createTempDirectory("hao-extension-test")
        try {
            assertFailsWith<IllegalArgumentException> {
                manager.setEnabled(ExtensionStateRequest(MediaKind.MANGA, "../outside", true), root)
            }
        } finally {
            Files.walk(root).use { paths -> paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) } }
        }
    }

    @Test
    fun `removing a missing valid package is idempotent`() {
        val root = createTempDirectory("hao-extension-test")
        try {
            val result = manager.remove(RemoveExtensionRequest(MediaKind.ANIME, "app.hao.fixture"), root)
            assertFalse(result.removed)
        } finally {
            Files.walk(root).use { paths -> paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) } }
        }
    }

    @Test
    fun `repository APK resolution supports Mihon apk subdirectories`() {
        val references = manager.resolveApkReferences(
            URI("https://example.com/repo/index.min.json"),
            URI("tachiyomi-en.fixture-v1.2.3.apk"),
        )
        assertEquals(
            listOf(
                URI("https://example.com/repo/tachiyomi-en.fixture-v1.2.3.apk"),
                URI("https://example.com/repo/apk/tachiyomi-en.fixture-v1.2.3.apk"),
            ),
            references,
        )
    }
}
