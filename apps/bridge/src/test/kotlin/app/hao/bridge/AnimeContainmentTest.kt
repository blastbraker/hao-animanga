package app.hao.bridge

import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.network.NetworkHelper
import kotlin.io.path.createTempDirectory
import kotlin.test.Test
import kotlin.test.assertFailsWith

class AnimeContainmentTest {
    @Test
    fun `extension HTTP rejects private destinations before connecting`() {
        val root = createTempDirectory("hao-anime-network-policy")
        AnimeNetworkPolicy.configure(emptyList(), root)
        assertFailsWith<IllegalArgumentException> {
            NetworkHelper().client.newCall(GET("https://127.0.0.1/blocked")).execute()
        }
    }

    @Test
    fun `Windows Job Object limit structure is accepted by the kernel`() {
        if (!System.getProperty("os.name").lowercase().contains("win")) return
        WindowsJobObject.create(256L * 1024 * 1024).close()
    }
}
