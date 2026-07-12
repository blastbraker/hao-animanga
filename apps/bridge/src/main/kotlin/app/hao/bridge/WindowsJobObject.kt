package app.hao.bridge

import com.sun.jna.Native
import com.sun.jna.Pointer
import com.sun.jna.Structure
import com.sun.jna.platform.win32.BaseTSD
import com.sun.jna.platform.win32.WinDef
import com.sun.jna.platform.win32.WinNT
import com.sun.jna.win32.W32APIOptions
import com.sun.jna.win32.StdCallLibrary

class WindowsJobObject private constructor(private val handle: WinNT.HANDLE) : AutoCloseable {
    fun assign(processId: Long) {
        require(processId in 1..Int.MAX_VALUE) { "Anime host process id is invalid" }
        val process = api.OpenProcess(PROCESS_SET_QUOTA or PROCESS_TERMINATE or PROCESS_QUERY_LIMITED_INFORMATION, false, processId.toInt())
        require(process != null && !WinBaseInvalidHandle.isInvalid(process)) { "Could not open the anime host for Job Object assignment: ${Native.getLastError()}" }
        try {
            require(api.AssignProcessToJobObject(handle, process)) { "Could not assign the anime host to its Job Object: ${Native.getLastError()}" }
        } finally {
            api.CloseHandle(process)
        }
    }

    override fun close() {
        api.CloseHandle(handle)
    }

    companion object {
        private val api = Native.load("kernel32", JobKernel32::class.java, W32APIOptions.UNICODE_OPTIONS)
        private const val JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS = 9
        private const val JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x00000008
        private const val JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100
        private const val JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION = 0x00000400
        private const val JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
        private const val PROCESS_TERMINATE = 0x0001
        private const val PROCESS_SET_QUOTA = 0x0100
        private const val PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

        fun create(processMemoryLimitBytes: Long = 512L * 1024 * 1024): WindowsJobObject {
            require(System.getProperty("os.name").lowercase().contains("win")) { "Windows Job Objects are only available on Windows" }
            require(processMemoryLimitBytes >= 128L * 1024 * 1024) { "Job Object memory limit is too small" }
            val handle = api.CreateJobObjectW(Pointer.NULL, null)
            require(handle != null && !WinBaseInvalidHandle.isInvalid(handle)) { "Could not create the anime host Job Object: ${Native.getLastError()}" }
            val job = WindowsJobObject(handle)
            try {
                val limits = JobObjectExtendedLimitInformation().apply {
                    val limitFlags = (
                        JOB_OBJECT_LIMIT_ACTIVE_PROCESS or
                            JOB_OBJECT_LIMIT_PROCESS_MEMORY or
                            JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION or
                            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                        ).toLong()
                    BasicLimitInformation.LimitFlags = WinDef.DWORD(limitFlags)
                    BasicLimitInformation.ActiveProcessLimit = WinDef.DWORD(1L)
                    ProcessMemoryLimit = BaseTSD.SIZE_T(processMemoryLimitBytes)
                    write()
                }
                require(api.SetInformationJobObject(handle, JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS, limits.pointer, limits.size())) {
                    "Could not configure the anime host Job Object: ${Native.getLastError()}"
                }
                return job
            } catch (error: Throwable) {
                job.close()
                throw error
            }
        }
    }
}

@Structure.FieldOrder(
    "PerProcessUserTimeLimit",
    "PerJobUserTimeLimit",
    "LimitFlags",
    "MinimumWorkingSetSize",
    "MaximumWorkingSetSize",
    "ActiveProcessLimit",
    "Affinity",
    "PriorityClass",
    "SchedulingClass",
)
class JobObjectBasicLimitInformation : Structure() {
    @JvmField var PerProcessUserTimeLimit = WinNT.LARGE_INTEGER(0)
    @JvmField var PerJobUserTimeLimit = WinNT.LARGE_INTEGER(0)
    @JvmField var LimitFlags = WinDef.DWORD(0)
    @JvmField var MinimumWorkingSetSize = BaseTSD.SIZE_T(0)
    @JvmField var MaximumWorkingSetSize = BaseTSD.SIZE_T(0)
    @JvmField var ActiveProcessLimit = WinDef.DWORD(0)
    @JvmField var Affinity = BaseTSD.ULONG_PTR(0)
    @JvmField var PriorityClass = WinDef.DWORD(0)
    @JvmField var SchedulingClass = WinDef.DWORD(0)
}

@Structure.FieldOrder(
    "BasicLimitInformation",
    "IoInfo",
    "ProcessMemoryLimit",
    "JobMemoryLimit",
    "PeakProcessMemoryUsed",
    "PeakJobMemoryUsed",
)
class JobObjectExtendedLimitInformation : Structure() {
    @JvmField var BasicLimitInformation = JobObjectBasicLimitInformation()
    @JvmField var IoInfo = WinNT.IO_COUNTERS()
    @JvmField var ProcessMemoryLimit = BaseTSD.SIZE_T(0)
    @JvmField var JobMemoryLimit = BaseTSD.SIZE_T(0)
    @JvmField var PeakProcessMemoryUsed = BaseTSD.SIZE_T(0)
    @JvmField var PeakJobMemoryUsed = BaseTSD.SIZE_T(0)
}

private interface JobKernel32 : StdCallLibrary {
    fun CreateJobObjectW(jobAttributes: Pointer?, name: String?): WinNT.HANDLE?
    fun SetInformationJobObject(job: WinNT.HANDLE, informationClass: Int, information: Pointer, informationLength: Int): Boolean
    fun AssignProcessToJobObject(job: WinNT.HANDLE, process: WinNT.HANDLE): Boolean
    fun OpenProcess(desiredAccess: Int, inheritHandle: Boolean, processId: Int): WinNT.HANDLE?
    fun CloseHandle(handle: WinNT.HANDLE): Boolean
}

private object WinBaseInvalidHandle {
    fun isInvalid(handle: WinNT.HANDLE): Boolean = Pointer.nativeValue(handle.pointer) == -1L
}
