package app.hao.bridge

import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.nio.file.attribute.PosixFilePermission
import java.nio.file.attribute.AclEntry
import java.nio.file.attribute.AclEntryPermission
import java.nio.file.attribute.AclEntryType
import java.nio.file.attribute.AclFileAttributeView
import java.security.KeyPair
import java.time.Instant
import java.util.Base64
import java.util.EnumSet

@Serializable data class PersistedPairing(
    val deviceId: String,
    val accountId: String,
    val deviceName: String,
    val publicKey: String,
    val privateKey: String,
    val pairedAt: String,
) {
    fun response() = PairResponse(deviceId, publicKey, pairedAt)
}

class PairingStore(private val stateRoot: Path) {
    private val json = Json { ignoreUnknownKeys = false; encodeDefaults = true; prettyPrint = true }
    private val stateFile = stateRoot.resolve("pairing.json")

    fun load(): PersistedPairing? {
        if (!Files.isRegularFile(stateFile)) return null
        return runCatching { json.decodeFromString<PersistedPairing>(Files.readString(stateFile)) }.getOrNull()
    }

    fun save(request: PairRequest, keyPair: KeyPair): PersistedPairing {
        val record = PersistedPairing(
            deviceId = java.util.UUID.randomUUID().toString(),
            accountId = request.accountId,
            deviceName = request.deviceName.take(120),
            publicKey = Base64.getEncoder().encodeToString(keyPair.public.encoded),
            privateKey = Base64.getEncoder().encodeToString(keyPair.private.encoded),
            pairedAt = Instant.now().toString(),
        )
        Files.createDirectories(stateRoot)
        restrictDirectory(stateRoot)
        val temporary = stateRoot.resolve("pairing.json.tmp")
        Files.writeString(temporary, json.encodeToString(record), StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE)
        restrictFile(temporary)
        try {
            Files.move(temporary, stateFile, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        } catch (_: AtomicMoveNotSupportedException) {
            Files.move(temporary, stateFile, StandardCopyOption.REPLACE_EXISTING)
        }
        restrictFile(stateFile)
        return record
    }

    private fun restrictDirectory(path: Path) {
        runCatching { Files.setPosixFilePermissions(path, setOf(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE, PosixFilePermission.OWNER_EXECUTE)) }
        restrictWindowsAcl(path)
    }

    private fun restrictFile(path: Path) {
        runCatching { Files.setPosixFilePermissions(path, setOf(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE)) }
        restrictWindowsAcl(path)
    }

    private fun restrictWindowsAcl(path: Path) {
        runCatching {
            val view = Files.getFileAttributeView(path, AclFileAttributeView::class.java) ?: return
            val owner = Files.getOwner(path)
            val ownerOnly = AclEntry.newBuilder()
                .setType(AclEntryType.ALLOW)
                .setPrincipal(owner)
                .setPermissions(EnumSet.allOf(AclEntryPermission::class.java))
                .build()
            view.acl = listOf(ownerOnly)
        }
    }
}
