@file:Suppress("DEPRECATION")

package app.hao.bridge

import java.net.InetAddress
import java.net.URL
import java.net.URLClassLoader
import java.nio.file.Path
import java.security.Permission

class ExtensionClassLoader(urls: Array<URL>, parent: ClassLoader, val privateRoot: Path) : URLClassLoader(urls, parent)

class ExtensionSecurityManager private constructor(
    private val allowedHosts: MutableSet<String>,
    private val allowedAddresses: MutableSet<String>,
    private val extensionLoaderType: Class<ExtensionClassLoader>,
    private val runtimeReadRoots: List<Path>,
    private val preferencesRoot: Path,
    private val temporaryRoot: Path,
    private val auditLog: Path,
) : SecurityManager() {
    private val inspecting = ThreadLocal.withInitial { false }

    private fun extensionLoader(): ExtensionClassLoader? {
        if (inspecting.get()) return null
        inspecting.set(true)
        try {
            return extensionLoaderUnchecked()
        } finally {
            inspecting.set(false)
        }
    }

    private fun extensionLoaderUnchecked(): ExtensionClassLoader? {
        val context = classContext
        var index = 0
        while (index < context.size) {
            val loader = context[index].classLoader
            if (extensionLoaderType.isInstance(loader)) return extensionLoaderType.cast(loader)
            index++
        }
        return null
    }

    override fun checkRead(file: String) = checkPath(file, write = false)
    override fun checkWrite(file: String) = checkPath(file, write = true)
    override fun checkDelete(file: String) = checkPath(file, write = true)

    private fun checkPath(file: String, write: Boolean) {
        if (inspecting.get()) return
        inspecting.set(true)
        try {
            val loader = extensionLoaderUnchecked() ?: return
            val path = Path.of(file).toAbsolutePath().normalize()
            val privatePath = path.startsWith(loader.privateRoot.toAbsolutePath().normalize())
            val preferencesPath = path.startsWith(preferencesRoot)
            val temporaryPath = path.startsWith(temporaryRoot)
            val auditPath = path == auditLog
            val runtimeRead = !write && runtimeReadRoots.any(path::startsWith)
            if (!privatePath && !preferencesPath && !temporaryPath && !auditPath && !runtimeRead) {
                throw SecurityException("Extension ${if (write) "write" else "read"} access is outside its private directory: $path")
            }
        } finally {
            inspecting.set(false)
        }
    }

    override fun checkExec(command: String) {
        if (extensionLoader() != null) throw SecurityException("Extensions cannot start processes")
    }

    override fun checkExit(status: Int) {
        if (extensionLoader() != null) throw SecurityException("Extensions cannot terminate the host")
    }

    override fun checkLink(library: String) {
        if (extensionLoader() != null) throw SecurityException("Extensions cannot load native libraries")
    }

    override fun checkConnect(host: String, port: Int) {
        if (approvingHost.get()) return
        if (inspecting.get()) return
        inspecting.set(true)
        try {
            if (extensionLoaderUnchecked() == null) return
            val normalized = host.lowercase()
            if (host in allowedAddresses) return
            if (normalized !in allowedHosts) throw SecurityException("Extension network host is not approved")
            val currentAddresses = InetAddress.getAllByName(normalized).map { it.hostAddress }
            if (currentAddresses.isEmpty() || currentAddresses.any { it !in allowedAddresses }) {
                throw SecurityException("Extension network host changed its approved DNS identity")
            }
        } finally {
            inspecting.set(false)
        }
    }

    override fun checkPermission(permission: Permission) {
        if (extensionLoader() == null) return
        if (permission is RuntimePermission && (
                permission.name == "setSecurityManager" ||
                    permission.name == "createClassLoader" ||
                    permission.name == "setIO" ||
                    permission.name.startsWith("loadLibrary.")
                )
        ) {
            throw SecurityException("Extension runtime permission is denied: ${permission.name}")
        }
    }

    companion object {
        @Volatile private var active: ExtensionSecurityManager? = null
        private val approvingHost = ThreadLocal.withInitial { false }

        fun install(hosts: Collection<String>, dataRoot: Path) {
            val normalizedHosts = java.util.concurrent.ConcurrentHashMap.newKeySet<String>().apply {
                addAll(hosts.map { it.trim().lowercase() }.filter(String::isNotBlank))
            }
            val addresses = java.util.concurrent.ConcurrentHashMap.newKeySet<String>().apply {
                addAll(normalizedHosts.flatMap { host -> runCatching { InetAddress.getAllByName(host).map { it.hostAddress } }.getOrDefault(emptyList()) })
            }
            // Resolve the custom loader type before activating checks so the first
            // stack inspection cannot recursively trigger classpath reads.
            val loaderType = ExtensionClassLoader::class.java
            val runtimeRoots = buildList {
                add(Path.of(System.getProperty("java.home")).toAbsolutePath().normalize())
                System.getProperty("java.class.path").split(java.io.File.pathSeparator)
                    .filter(String::isNotBlank)
                    .mapTo(this) { Path.of(it).toAbsolutePath().normalize() }
            }
            val preferences = dataRoot.resolve("android").toAbsolutePath().normalize()
            val temporary = dataRoot.resolve("tmp").toAbsolutePath().normalize()
            val auditLog = dataRoot.resolve("extension-network.log").toAbsolutePath().normalize()
            val manager = ExtensionSecurityManager(normalizedHosts, addresses, loaderType, runtimeRoots, preferences, temporary, auditLog)
            active = manager
            System.setSecurityManager(manager)
        }

        fun validateAndAllowHost(rawUrl: String): String {
            if (approvingHost.get()) error("Nested extension host approval is not allowed")
            approvingHost.set(true)
            try {
                val uri = Security.validateRemoteHttps(rawUrl)
                val normalized = requireNotNull(uri.host).lowercase()
                val manager = active ?: error("Extension security manager is not installed")
                val resolved = InetAddress.getAllByName(normalized)
                require(resolved.isNotEmpty()) { "Extension host did not resolve" }
                manager.allowedHosts += normalized
                manager.allowedAddresses += resolved.map { it.hostAddress }
                return normalized
            } finally {
                approvingHost.set(false)
            }
        }
    }
}
