using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace Hao.Bridge.Tray;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        using var mutex = new Mutex(initiallyOwned: true, "Local\\HAO.Bridge.Tray", out var createdNew);
        if (!createdNew)
        {
            return;
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new TrayApplicationContext());
    }
}

internal sealed class TrayApplicationContext : ApplicationContext
{
    private const string HaoUrl = "https://hao-animanga.vercel.app";
    private const string HealthUrl = "http://127.0.0.1:4568/health";

    private readonly NotifyIcon _notifyIcon;
    private readonly ToolStripMenuItem _statusItem;
    private readonly ToolStripMenuItem _startItem;
    private readonly ToolStripMenuItem _stopItem;
    private readonly ToolStripMenuItem _restartItem;
    private readonly System.Windows.Forms.Timer _timer;
    private readonly HttpClient _httpClient = new() { Timeout = TimeSpan.FromSeconds(2) };
    private readonly object _logLock = new();
    private readonly string _projectRoot;
    private readonly string _runDirectory;
    private readonly string _errorLog;

    private Process? _bridgeProcess;
    private StreamWriter? _stdoutWriter;
    private StreamWriter? _stderrWriter;
    private SafeJobHandle? _job;
    private string? _adminToken;
    private bool? _lastOnline;
    private bool _refreshing;
    private bool _firstTick = true;
    private bool _closing;

    public TrayApplicationContext()
    {
        _projectRoot = FindProjectRoot();
        _runDirectory = Path.Combine(_projectRoot, ".run");
        _errorLog = Path.Combine(_runDirectory, "hao-tray.error.log");
        Directory.CreateDirectory(_runDirectory);

        _statusItem = new ToolStripMenuItem("Checking Bridge status...") { Enabled = false };
        _startItem = new ToolStripMenuItem("Start Bridge", null, (_, _) => StartBridge());
        _stopItem = new ToolStripMenuItem("Stop Bridge", null, (_, _) => StopBridge());
        _restartItem = new ToolStripMenuItem("Restart Bridge", null, (_, _) => RestartBridge());

        var menu = new ContextMenuStrip();
        menu.Items.Add(_statusItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(_startItem);
        menu.Items.Add(_stopItem);
        menu.Items.Add(_restartItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("Open HAO", null, (_, _) => OpenUrl(HaoUrl)));
        menu.Items.Add(new ToolStripMenuItem("Open Settings", null, (_, _) => OpenUrl($"{HaoUrl}/settings")));
        menu.Items.Add(new ToolStripMenuItem("Open Logs", null, (_, _) => OpenLogs()));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("Change admin token...", null, (_, _) => ChangeAdminToken()));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("Exit (stop Bridge)", null, (_, _) => ExitController()));

        _notifyIcon = new NotifyIcon
        {
            Icon = LoadTrayIcon(),
            Text = "HAO Bridge",
            ContextMenuStrip = menu,
            Visible = true
        };
        _notifyIcon.DoubleClick += (_, _) => OpenUrl(HaoUrl);

        _timer = new System.Windows.Forms.Timer { Interval = 150 };
        _timer.Tick += async (_, _) => await OnTimerTickAsync();
        _timer.Start();
    }

    private async Task OnTimerTickAsync()
    {
        if (_refreshing || _closing)
        {
            return;
        }

        _refreshing = true;
        try
        {
            if (_firstTick)
            {
                _firstTick = false;
                _timer.Interval = 5_000;
                _adminToken = CredentialStore.TryRead() ?? TryMigrateLegacyToken();
                if (string.IsNullOrWhiteSpace(_adminToken))
                {
                    _adminToken = TokenDialog.Prompt();
                    if (!string.IsNullOrWhiteSpace(_adminToken))
                    {
                        CredentialStore.Write(_adminToken);
                    }
                }

                if (!string.IsNullOrWhiteSpace(_adminToken))
                {
                    StartBridge();
                }
            }

            await RefreshStatusAsync();
        }
        catch (Exception exception)
        {
            LogError(exception);
        }
        finally
        {
            _refreshing = false;
        }
    }

    private void StartBridge()
    {
        try
        {
            if (_bridgeProcess is { HasExited: false })
            {
                return;
            }

            _adminToken ??= CredentialStore.TryRead() ?? TryMigrateLegacyToken();
            if (string.IsNullOrWhiteSpace(_adminToken))
            {
                _adminToken = TokenDialog.Prompt();
                if (string.IsNullOrWhiteSpace(_adminToken))
                {
                    return;
                }

                CredentialStore.Write(_adminToken);
            }

            if (_adminToken.Length < 32)
            {
                throw new InvalidOperationException("The Bridge administrator token must contain at least 32 characters.");
            }

            var javaHome = FindJavaHome();
            var javaExecutable = Path.Combine(javaHome, "bin", "javaw.exe");
            var bridgeLib = Path.Combine(_projectRoot, "apps", "bridge", "build", "install", "hao-bridge", "lib");
            if (!Directory.Exists(bridgeLib))
            {
                throw new DirectoryNotFoundException($"The installed Bridge runtime is missing: {bridgeLib}");
            }
            var bridgeClasspath = string.Join(
                Path.PathSeparator,
                Directory.EnumerateFiles(bridgeLib)
                    .Where(path => path.EndsWith(".jar", StringComparison.OrdinalIgnoreCase)
                        || path.EndsWith(".aar", StringComparison.OrdinalIgnoreCase)
                        || path.EndsWith(".pom", StringComparison.OrdinalIgnoreCase))
                    .OrderBy(path => path, StringComparer.OrdinalIgnoreCase));
            if (string.IsNullOrWhiteSpace(bridgeClasspath))
            {
                throw new InvalidOperationException("The installed Bridge runtime has no Java libraries.");
            }

            DisposeBridgeResources();
            _stdoutWriter = CreateLogWriter(Path.Combine(_runDirectory, "bridge-tray.stdout.log"));
            _stderrWriter = CreateLogWriter(Path.Combine(_runDirectory, "bridge-tray.stderr.log"));
            _job = SafeJobHandle.CreateKillOnClose();

            var startInfo = new ProcessStartInfo
            {
                FileName = javaExecutable,
                WorkingDirectory = _projectRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            startInfo.ArgumentList.Add("-classpath");
            // Keep every dependency explicit. The anime extension probe locates
            // the bundled Aniyomi API .aar through java.class.path, and a Java
            // wildcard remains opaque in that system property.
            startInfo.ArgumentList.Add(bridgeClasspath);
            startInfo.ArgumentList.Add("app.hao.bridge.MainKt");
            startInfo.Environment["HAO_BRIDGE_ADMIN_TOKEN"] = _adminToken;
            startInfo.Environment["HAO_WEB_ORIGIN"] = HaoUrl;
            startInfo.Environment["HAO_JAVA_HOME"] = javaHome;
            startInfo.Environment["JAVA_HOME"] = javaHome;

            _bridgeProcess = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
            var startedProcess = _bridgeProcess;
            startedProcess.OutputDataReceived += (_, args) => WriteBridgeLog(_stdoutWriter, args.Data);
            startedProcess.ErrorDataReceived += (_, args) => WriteBridgeLog(_stderrWriter, args.Data);
            startedProcess.Exited += (_, _) => BeginInvokeOnUi(() => HandleBridgeExit(startedProcess));

            if (!_bridgeProcess.Start())
            {
                throw new InvalidOperationException("Windows did not start the HAO Bridge process.");
            }

            if (!_job.Assign(_bridgeProcess))
            {
                _bridgeProcess.Kill(entireProcessTree: true);
                throw new InvalidOperationException("Windows could not attach the Bridge to the tray controller process group.");
            }

            _bridgeProcess.BeginOutputReadLine();
            _bridgeProcess.BeginErrorReadLine();
            _statusItem.Text = "Bridge starting...";
            _startItem.Enabled = false;
            _stopItem.Enabled = true;
            _restartItem.Enabled = true;
        }
        catch (Exception exception)
        {
            LogError(exception);
            DisposeBridgeResources();
            MessageBox.Show(
                $"HAO Bridge could not start.\n\n{exception.Message}\n\nOpen Logs from the tray menu for details.",
                "HAO Bridge",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private void StopBridge()
    {
        try
        {
            if (_job is not null && !_job.IsInvalid)
            {
                _job.Terminate();
            }
            else if (_bridgeProcess is { HasExited: false })
            {
                _bridgeProcess.Kill(entireProcessTree: true);
            }
        }
        catch (Exception exception)
        {
            LogError(exception);
        }
        finally
        {
            DisposeBridgeResources();
            _statusItem.Text = "Bridge offline";
            _startItem.Enabled = true;
            _stopItem.Enabled = false;
            _restartItem.Enabled = false;
        }
    }

    private void RestartBridge()
    {
        StopBridge();
        StartBridge();
    }

    private void HandleBridgeExit(Process exitedProcess)
    {
        if (_closing || !ReferenceEquals(_bridgeProcess, exitedProcess))
        {
            return;
        }

        DisposeBridgeResources();
        _statusItem.Text = "Bridge stopped unexpectedly";
        _startItem.Enabled = true;
        _stopItem.Enabled = false;
        _restartItem.Enabled = false;
        _notifyIcon.BalloonTipTitle = "HAO Bridge";
        _notifyIcon.BalloonTipText = "The Bridge stopped. Open Logs for details.";
        _notifyIcon.BalloonTipIcon = ToolTipIcon.Warning;
        _notifyIcon.ShowBalloonTip(4_000);
    }

    private async Task RefreshStatusAsync()
    {
        var online = false;
        try
        {
            using var response = await _httpClient.GetAsync(HealthUrl);
            online = response.IsSuccessStatusCode;
        }
        catch (HttpRequestException)
        {
        }
        catch (TaskCanceledException)
        {
        }

        var owned = _bridgeProcess is { HasExited: false };
        if (online)
        {
            _statusItem.Text = owned ? "Bridge online" : "Bridge online (external)";
            _notifyIcon.Text = "HAO Bridge - Online";
            _startItem.Enabled = false;
            _stopItem.Enabled = owned;
            _restartItem.Enabled = owned;
        }
        else if (owned)
        {
            _statusItem.Text = "Bridge starting...";
            _notifyIcon.Text = "HAO Bridge - Starting";
            _startItem.Enabled = false;
            _stopItem.Enabled = true;
            _restartItem.Enabled = true;
        }
        else
        {
            _statusItem.Text = "Bridge offline";
            _notifyIcon.Text = "HAO Bridge - Offline";
            _startItem.Enabled = true;
            _stopItem.Enabled = false;
            _restartItem.Enabled = false;
        }

        if (_lastOnline.HasValue && _lastOnline.Value != online)
        {
            _notifyIcon.BalloonTipTitle = "HAO Bridge";
            _notifyIcon.BalloonTipText = online
                ? "Your shared HAO Bridge is online."
                : "Your shared HAO Bridge is offline.";
            _notifyIcon.BalloonTipIcon = online ? ToolTipIcon.Info : ToolTipIcon.Warning;
            _notifyIcon.ShowBalloonTip(3_000);
        }

        _lastOnline = online;
    }

    private string? TryMigrateLegacyToken()
    {
        try
        {
            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var legacyPath = Path.Combine(localAppData, "HAO", "Secrets", "bridge-admin-token.dpapi");
            if (!File.Exists(legacyPath))
            {
                return null;
            }

            var encoded = File.ReadAllText(legacyPath).Trim();
            var encrypted = Convert.FromBase64String(encoded);
            try
            {
                var token = LegacyDpapi.Unprotect(encrypted);
                if (token.Length >= 32)
                {
                    CredentialStore.Write(token);
                    return token;
                }
            }
            finally
            {
                CryptographicOperations.ZeroMemory(encrypted);
            }
        }
        catch (Exception exception)
        {
            LogError(new InvalidOperationException("The legacy Bridge token could not be migrated.", exception));
        }

        return null;
    }

    private void ChangeAdminToken()
    {
        var replacement = TokenDialog.Prompt();
        if (string.IsNullOrWhiteSpace(replacement))
        {
            return;
        }

        CredentialStore.Write(replacement);
        _adminToken = replacement;
        RestartBridge();
    }

    private static string FindProjectRoot()
    {
        var candidates = new[] { AppContext.BaseDirectory, Environment.CurrentDirectory };
        foreach (var candidate in candidates)
        {
            var directory = new DirectoryInfo(candidate);
            while (directory is not null)
            {
                if (File.Exists(Path.Combine(directory.FullName, "pnpm-workspace.yaml")))
                {
                    return directory.FullName;
                }
                directory = directory.Parent;
            }
        }

        throw new DirectoryNotFoundException("The HAO project directory could not be located.");
    }

    private static string FindJavaHome()
    {
        foreach (var variable in new[] { "HAO_JAVA_HOME", "JAVA_HOME" })
        {
            var configured = Environment.GetEnvironmentVariable(variable);
            if (!string.IsNullOrWhiteSpace(configured) && File.Exists(Path.Combine(configured, "bin", "javaw.exe")))
            {
                return configured;
            }
        }

        var adoptiumRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            "Eclipse Adoptium");
        var installation = Directory.Exists(adoptiumRoot)
            ? new DirectoryInfo(adoptiumRoot)
                .EnumerateDirectories("jdk-21*")
                .Where(directory => File.Exists(Path.Combine(directory.FullName, "bin", "javaw.exe")))
                .OrderByDescending(directory => directory.LastWriteTimeUtc)
                .FirstOrDefault()
            : null;

        return installation?.FullName
            ?? throw new FileNotFoundException("Java 21 Eclipse Adoptium was not found.");
    }

    private static StreamWriter CreateLogWriter(string path)
    {
        return new StreamWriter(new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.ReadWrite), Encoding.UTF8)
        {
            AutoFlush = true
        };
    }

    private void WriteBridgeLog(StreamWriter? writer, string? line)
    {
        if (writer is null || line is null)
        {
            return;
        }

        lock (_logLock)
        {
            writer.WriteLine(line);
        }
    }

    private void LogError(Exception exception)
    {
        try
        {
            lock (_logLock)
            {
                File.AppendAllText(
                    _errorLog,
                    $"[{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss zzz}] {exception}\r\n",
                    Encoding.UTF8);
            }
        }
        catch
        {
        }
    }

    private void DisposeBridgeResources()
    {
        lock (_logLock)
        {
            _stdoutWriter?.Dispose();
            _stderrWriter?.Dispose();
            _stdoutWriter = null;
            _stderrWriter = null;
        }

        _bridgeProcess?.Dispose();
        _bridgeProcess = null;
        _job?.Dispose();
        _job = null;
    }

    private void BeginInvokeOnUi(Action action)
    {
        if (_closing)
        {
            return;
        }

        _notifyIcon.ContextMenuStrip?.BeginInvoke(action);
    }

    private static void OpenUrl(string url)
    {
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }

    private void OpenLogs()
    {
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{_runDirectory}\"") { UseShellExecute = true });
    }

    private void ExitController()
    {
        _closing = true;
        _timer.Stop();
        StopBridge();
        _notifyIcon.Visible = false;
        _notifyIcon.Icon?.Dispose();
        _notifyIcon.Dispose();
        _httpClient.Dispose();
        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && !_closing)
        {
            ExitController();
        }
        base.Dispose(disposing);
    }

    private static Icon LoadTrayIcon()
    {
        try
        {
            using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Hao.Bridge.Tray.logo.png");
            if (stream is null)
            {
                return (Icon)SystemIcons.Application.Clone();
            }

            using var bitmap = new Bitmap(stream);
            var handle = bitmap.GetHicon();
            try
            {
                return (Icon)Icon.FromHandle(handle).Clone();
            }
            finally
            {
                NativeMethods.DestroyIcon(handle);
            }
        }
        catch
        {
            return (Icon)SystemIcons.Application.Clone();
        }
    }
}

internal static class TokenDialog
{
    public static string? Prompt()
    {
        using var dialog = new Form
        {
            Text = "HAO Bridge administrator token",
            Width = 520,
            Height = 230,
            StartPosition = FormStartPosition.CenterScreen,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false,
            ShowInTaskbar = true
        };

        var explanation = new Label
        {
            Left = 20,
            Top = 18,
            Width = 465,
            Height = 55,
            Text = "Paste the existing HAO Bridge admin token. It will be stored for this Windows account in Credential Manager and will never be written to the repository."
        };
        var tokenBox = new TextBox
        {
            Left = 20,
            Top = 82,
            Width = 465,
            UseSystemPasswordChar = true
        };
        var save = new Button
        {
            Text = "Save and start",
            Left = 350,
            Top = 125,
            Width = 135,
            DialogResult = DialogResult.None
        };
        var cancel = new Button
        {
            Text = "Cancel",
            Left = 255,
            Top = 125,
            Width = 85,
            DialogResult = DialogResult.Cancel
        };

        save.Click += (_, _) =>
        {
            if (tokenBox.Text.Trim().Length < 32)
            {
                MessageBox.Show(
                    dialog,
                    "The admin token must contain at least 32 characters.",
                    "HAO Bridge",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
                return;
            }

            dialog.DialogResult = DialogResult.OK;
            dialog.Close();
        };

        dialog.Controls.AddRange(new Control[] { explanation, tokenBox, save, cancel });
        dialog.AcceptButton = save;
        dialog.CancelButton = cancel;
        dialog.Shown += (_, _) => tokenBox.Focus();

        return dialog.ShowDialog() == DialogResult.OK ? tokenBox.Text.Trim() : null;
    }
}

internal static class CredentialStore
{
    private const string TargetName = "HAO/BridgeAdminToken";
    private const int CredentialTypeGeneric = 1;
    private const int CredentialPersistLocalMachine = 2;

    public static string? TryRead()
    {
        if (!NativeMethods.CredRead(TargetName, CredentialTypeGeneric, 0, out var credentialPointer))
        {
            var error = Marshal.GetLastWin32Error();
            if (error == 1168)
            {
                return null;
            }
            throw new System.ComponentModel.Win32Exception(error, "Windows Credential Manager could not read the HAO Bridge token.");
        }

        try
        {
            var credential = Marshal.PtrToStructure<NativeMethods.Credential>(credentialPointer);
            if (credential.CredentialBlob == IntPtr.Zero || credential.CredentialBlobSize == 0)
            {
                return null;
            }

            var bytes = new byte[credential.CredentialBlobSize];
            Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
            try
            {
                return Encoding.Unicode.GetString(bytes);
            }
            finally
            {
                CryptographicOperations.ZeroMemory(bytes);
            }
        }
        finally
        {
            NativeMethods.CredFree(credentialPointer);
        }
    }

    public static void Write(string token)
    {
        var bytes = Encoding.Unicode.GetBytes(token);
        var blob = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            var credential = new NativeMethods.Credential
            {
                Type = CredentialTypeGeneric,
                TargetName = TargetName,
                CredentialBlobSize = bytes.Length,
                CredentialBlob = blob,
                Persist = CredentialPersistLocalMachine,
                UserName = Environment.UserName
            };

            if (!NativeMethods.CredWrite(ref credential, 0))
            {
                throw new System.ComponentModel.Win32Exception(
                    Marshal.GetLastWin32Error(),
                    "Windows Credential Manager could not save the HAO Bridge token.");
            }
        }
        finally
        {
            CryptographicOperations.ZeroMemory(bytes);
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            Marshal.FreeHGlobal(blob);
        }
    }
}

internal static class LegacyDpapi
{
    public static string Unprotect(byte[] encrypted)
    {
        var inputPointer = Marshal.AllocHGlobal(encrypted.Length);
        Marshal.Copy(encrypted, 0, inputPointer, encrypted.Length);
        var input = new NativeMethods.DataBlob { DataSize = encrypted.Length, DataPointer = inputPointer };

        try
        {
            if (!NativeMethods.CryptUnprotectData(
                    ref input,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    0x1,
                    out var output))
            {
                throw new System.ComponentModel.Win32Exception(
                    Marshal.GetLastWin32Error(),
                    "Windows could not decrypt the legacy HAO Bridge token.");
            }

            try
            {
                var bytes = new byte[output.DataSize];
                Marshal.Copy(output.DataPointer, bytes, 0, bytes.Length);
                try
                {
                    return Encoding.UTF8.GetString(bytes);
                }
                finally
                {
                    CryptographicOperations.ZeroMemory(bytes);
                }
            }
            finally
            {
                NativeMethods.LocalFree(output.DataPointer);
            }
        }
        finally
        {
            var zeros = new byte[encrypted.Length];
            Marshal.Copy(zeros, 0, inputPointer, zeros.Length);
            Marshal.FreeHGlobal(inputPointer);
        }
    }
}

internal sealed class SafeJobHandle : SafeHandle
{
    public SafeJobHandle() : base(IntPtr.Zero, ownsHandle: true)
    {
    }

    public override bool IsInvalid => handle == IntPtr.Zero || handle == new IntPtr(-1);

    public static SafeJobHandle CreateKillOnClose()
    {
        var job = NativeMethods.CreateJobObject(IntPtr.Zero, null);
        if (job.IsInvalid)
        {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "Windows could not create the HAO Bridge process group.");
        }

        var information = new NativeMethods.JobObjectExtendedLimitInformation
        {
            BasicLimitInformation = new NativeMethods.JobObjectBasicLimitInformation
            {
                LimitFlags = 0x00002000
            }
        };
        var length = Marshal.SizeOf<NativeMethods.JobObjectExtendedLimitInformation>();
        var pointer = Marshal.AllocHGlobal(length);
        try
        {
            Marshal.StructureToPtr(information, pointer, false);
            if (!NativeMethods.SetInformationJobObject(job, 9, pointer, (uint)length))
            {
                var error = Marshal.GetLastWin32Error();
                job.Dispose();
                throw new System.ComponentModel.Win32Exception(error, "Windows could not configure the HAO Bridge process group.");
            }
        }
        finally
        {
            Marshal.FreeHGlobal(pointer);
        }

        return job;
    }

    public bool Assign(Process process)
    {
        return NativeMethods.AssignProcessToJobObject(this, process.Handle);
    }

    public void Terminate()
    {
        if (!IsInvalid && !NativeMethods.TerminateJobObject(this, 0))
        {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "Windows could not stop the HAO Bridge process group.");
        }
    }

    protected override bool ReleaseHandle()
    {
        return NativeMethods.CloseHandle(handle);
    }
}

internal static class NativeMethods
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct Credential
    {
        public uint Flags;
        public uint Type;
        [MarshalAs(UnmanagedType.LPWStr)] public string? TargetName;
        [MarshalAs(UnmanagedType.LPWStr)] public string? Comment;
        public long LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        [MarshalAs(UnmanagedType.LPWStr)] public string? TargetAlias;
        [MarshalAs(UnmanagedType.LPWStr)] public string? UserName;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct DataBlob
    {
        public int DataSize;
        public IntPtr DataPointer;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct JobObjectBasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct JobObjectExtendedLimitInformation
    {
        public JobObjectBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPointer);

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CredWrite(ref Credential userCredential, uint flags);

    [DllImport("advapi32.dll")]
    internal static extern void CredFree(IntPtr buffer);

    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CryptUnprotectData(
        ref DataBlob dataIn,
        IntPtr description,
        IntPtr optionalEntropy,
        IntPtr reserved,
        IntPtr promptStruct,
        int flags,
        out DataBlob dataOut);

    [DllImport("kernel32.dll")]
    internal static extern IntPtr LocalFree(IntPtr memory);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern SafeJobHandle CreateJobObject(IntPtr securityAttributes, string? name);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetInformationJobObject(
        SafeJobHandle job,
        int informationClass,
        IntPtr information,
        uint informationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool AssignProcessToJobObject(SafeJobHandle job, IntPtr process);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool TerminateJobObject(SafeJobHandle job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CloseHandle(IntPtr handle);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool DestroyIcon(IntPtr handle);
}
