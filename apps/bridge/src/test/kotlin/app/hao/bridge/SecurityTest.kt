package app.hao.bridge

import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class SecurityTest {
    @Test fun `rejects http`() { assertFailsWith<IllegalArgumentException> { Security.validateRemoteHttps("http://example.com/index.json") } }
    @Test fun `hash is stable`() { assertTrue(Security.sha256("hao".encodeToByteArray()).matches(Regex("[a-f0-9]{64}"))) }
    @Test fun `administrator tokens use exact comparison`() {
        assertTrue(Security.secretsMatch("a".repeat(32), "a".repeat(32)))
        assertTrue(!Security.secretsMatch("a".repeat(32), "a".repeat(31)))
        assertTrue(!Security.secretsMatch("a".repeat(32), null))
    }
}
