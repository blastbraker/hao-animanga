package app.hao.bridge

import java.nio.file.Files
import java.security.KeyPairGenerator
import java.util.Comparator
import kotlin.io.path.createTempDirectory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class PairingStoreTest {
    @Test
    fun `pairing survives a store restart with its device identity`() {
        val root = createTempDirectory("hao-pairing-test")
        try {
            val request = PairRequest("A1B2C3D4", "account-1", "Test Bridge")
            val saved = PairingStore(root).save(request, KeyPairGenerator.getInstance("Ed25519").generateKeyPair())
            val loaded = assertNotNull(PairingStore(root).load())
            assertEquals(saved.deviceId, loaded.deviceId)
            assertEquals(saved.publicKey, loaded.publicKey)
            assertEquals(saved.privateKey, loaded.privateKey)
            assertEquals("account-1", loaded.accountId)
        } finally {
            Files.walk(root).use { paths -> paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) } }
        }
    }
}
