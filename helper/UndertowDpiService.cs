using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Threading;

namespace UndertowDpi
{
    internal static class Native
    {
        public const uint SC_MANAGER_ALL_ACCESS = 0xF003F;
        public const uint SERVICE_ALL_ACCESS = 0xF01FF;
        public const uint SERVICE_WIN32_OWN_PROCESS = 0x00000010;
        public const uint SERVICE_AUTO_START = 0x00000002;
        public const uint SERVICE_ERROR_NORMAL = 0x00000001;
        public const uint SERVICE_CONTROL_STOP = 0x00000001;
        public const uint SERVICE_STOP = 0x00000020;
        public const uint DELETE = 0x00010000;
        public const uint SERVICE_QUERY_STATUS = 0x00000004;

        [StructLayout(LayoutKind.Sequential)]
        public struct SERVICE_STATUS
        {
            public uint dwServiceType;
            public uint dwCurrentState;
            public uint dwControlsAccepted;
            public uint dwWin32ExitCode;
            public uint dwServiceSpecificExitCode;
            public uint dwCheckPoint;
            public uint dwWaitHint;
        }

        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern IntPtr OpenSCManager(string machine, string database, uint access);

        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern IntPtr CreateService(
            IntPtr manager,
            string name,
            string displayName,
            uint access,
            uint type,
            uint startType,
            uint errorControl,
            string binaryPath,
            string loadOrderGroup,
            IntPtr tagId,
            string dependencies,
            string account,
            string password);

        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern IntPtr OpenService(IntPtr manager, string name, uint access);

        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool CloseServiceHandle(IntPtr handle);

        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool DeleteService(IntPtr service);

        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool StartService(IntPtr service, int argc, string[] argv);

        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool ControlService(IntPtr service, uint control, ref SERVICE_STATUS status);
    }

    internal sealed class DpiService : ServiceBase
    {
        private const string PipeName = "UndertowDpi";
        private const string Hosts = "youtube.com\nyoutu.be\nyoutube-nocookie.com\nyoutubekids.com\nyoutubei.googleapis.com\nyoutube.googleapis.com\nyoutubeembeddedplayer.googleapis.com\ngooglevideo.com\nredirector.googlevideo.com\nytimg.com\nyt3.ggpht.com\nyt4.ggpht.com\nyt3.googleusercontent.com\ngoogleusercontent.com\ngoogleapis.com\ngstatic.com\n";

        private static readonly object LogLock = new object();
        private readonly object gate = new object();
        private readonly string baseDir;
        private Thread pipeThread;
        private Timer appWatch;
        private Process winws;
        private volatile int appPid;
        private volatile bool stopping;

        public DpiService(string baseDir)
        {
            this.baseDir = baseDir;
            ServiceName = "UndertowDpi";
            CanStop = true;
            CanShutdown = true;
            AutoLog = true;
        }

        public static string LogPath
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                    "Undertow",
                    "dpi-service.log");
            }
        }

        public static void Log(string message)
        {
            try
            {
                string path = LogPath;
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                lock (LogLock)
                {
                    File.AppendAllText(
                        path,
                        DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " " + message + Environment.NewLine,
                        Encoding.UTF8);
                }
            }
            catch
            {
                // лог не должен ронять службу
            }
        }

        protected override void OnStart(string[] args)
        {
            stopping = false;
            Log("service started, base=" + baseDir);
            pipeThread = new Thread(PipeLoop);
            pipeThread.IsBackground = true;
            pipeThread.Name = "undertow-dpi-pipe";
            pipeThread.Start();
            appWatch = new Timer(WatchApp, null, 1000, 1000);
        }

        protected override void OnStop()
        {
            stopping = true;
            if (appWatch != null)
            {
                appWatch.Dispose();
                appWatch = null;
            }
            StopWinws();
            Log("service stopped");
        }

        protected override void OnShutdown()
        {
            OnStop();
            base.OnShutdown();
        }

        private void WatchApp(object state)
        {
            int pid = appPid;
            if (pid <= 0) return;
            if (ProcessExists(pid)) return;

            lock (gate)
            {
                if (appPid == pid)
                {
                    Log("app " + pid + " exited, stopping winws");
                    StopWinwsLocked();
                }
            }
        }

        private static bool ProcessExists(int pid)
        {
            try
            {
                using (Process p = Process.GetProcessById(pid))
                {
                    return !p.HasExited;
                }
            }
            catch
            {
                return false;
            }
        }

        private void PipeLoop()
        {
            while (!stopping)
            {
                try
                {
                    using (NamedPipeServerStream pipe = CreatePipe())
                    {
                        pipe.WaitForConnection();
                        using (StreamReader reader = new StreamReader(pipe, Encoding.UTF8))
                        using (StreamWriter writer = new StreamWriter(pipe, new UTF8Encoding(false)))
                        {
                            writer.AutoFlush = true;
                            string line = reader.ReadLine();
                            string reply = Handle(line);
                            writer.WriteLine(reply);
                        }
                    }
                }
                catch (Exception e)
                {
                    Log("pipe error: " + e.Message);
                    Thread.Sleep(500);
                }
            }
        }

        private static NamedPipeServerStream CreatePipe()
        {
            PipeSecurity security = new PipeSecurity();
            SecurityIdentifier users = new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null);
            security.AddAccessRule(new PipeAccessRule(users, PipeAccessRights.ReadWrite, AccessControlType.Allow));
            return new NamedPipeServerStream(
                PipeName,
                PipeDirection.InOut,
                1,
                PipeTransmissionMode.Byte,
                PipeOptions.None,
                4096,
                4096,
                security);
        }

        private string Handle(string command)
        {
            if (command == null) return "err empty";
            command = command.Trim();
            Log("command: " + command);

            try
            {
                if (command == "status")
                {
                    lock (gate)
                    {
                        bool alive = IsWinwsRunning();
                        return string.Format(
                            "ok running={0} pid={1} app={2}",
                            alive ? 1 : 0,
                            alive ? winws.Id : 0,
                            appPid);
                    }
                }

                if (command.StartsWith("start", StringComparison.OrdinalIgnoreCase))
                {
                    int pid = 0;
                    string[] parts = command.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length > 1) int.TryParse(parts[1], out pid);
                    lock (gate)
                    {
                        appPid = pid;
                        if (!IsWinwsRunning())
                        {
                            StartWinwsLocked();
                        }
                        return "ok pid=" + winws.Id;
                    }
                }

                if (command == "stop" || command == "shutdown")
                {
                    lock (gate)
                    {
                        StopWinwsLocked();
                    }
                    return "ok";
                }

                return "err unknown command";
            }
            catch (Exception e)
            {
                Log("command failed: " + e.Message);
                return "err " + e.Message.Replace("\r", " ").Replace("\n", " ");
            }
        }

        private bool IsWinwsRunning()
        {
            if (winws == null) return false;
            try
            {
                if (winws.HasExited)
                {
                    winws.Dispose();
                    winws = null;
                    return false;
                }
                return true;
            }
            catch
            {
                return false;
            }
        }

        private void StartWinwsLocked()
        {
            string bin = Path.Combine(baseDir, "bin");
            string exe = Path.Combine(bin, "winws.exe");
            if (!File.Exists(exe)) throw new Exception("Не найден " + exe);

            string hosts = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                "Undertow",
                "hosts.txt");
            Directory.CreateDirectory(Path.GetDirectoryName(hosts));
            File.WriteAllText(hosts, Hosts, new UTF8Encoding(false));

            string quic = Path.Combine(bin, "quic_initial_www_google_com.bin");
            string tls = Path.Combine(bin, "tls_clienthello_www_google_com.bin");
            if (!File.Exists(quic)) throw new Exception("Не найден QUIC-паттерн");
            if (!File.Exists(tls)) throw new Exception("Не найден TLS-паттерн");

            string args =
                "--wf-tcp=443 --wf-udp=443 " +
                "--filter-udp=443 --hostlist=" + Quote(hosts) +
                " --dpi-desync=fake --dpi-desync-repeats=6 --dpi-desync-fake-quic=" + Quote(quic) +
                " --new " +
                "--filter-tcp=443 --hostlist=" + Quote(hosts) +
                " --ip-id=zero --dpi-desync=multisplit --dpi-desync-split-seqovl=681 --dpi-desync-split-pos=1" +
                " --dpi-desync-split-seqovl-pattern=" + Quote(tls);

            ProcessStartInfo info = new ProcessStartInfo(exe, args);
            info.WorkingDirectory = bin;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.WindowStyle = ProcessWindowStyle.Hidden;

            Process p = Process.Start(info);
            Thread.Sleep(800);
            if (p.HasExited)
            {
                int code = p.ExitCode;
                p.Dispose();
                throw new Exception("winws завершился с кодом " + code);
            }
            winws = p;
            Log("winws started pid=" + p.Id + " app=" + appPid);
        }

        private void StopWinwsLocked()
        {
            appPid = 0;
            if (winws == null) return;
            try
            {
                if (!winws.HasExited) winws.Kill();
                winws.WaitForExit(5000);
            }
            catch (Exception e)
            {
                Log("stop winws: " + e.Message);
            }
            finally
            {
                try { winws.Dispose(); } catch { }
                winws = null;
            }
            Log("winws stopped");
        }

        private void StopWinws()
        {
            lock (gate)
            {
                StopWinwsLocked();
            }
        }

        private static string Quote(string value)
        {
            return "\"" + value.Replace("\"", "\\\"") + "\"";
        }
    }

    internal static class Program
    {
        private static string BaseDir
        {
            get { return AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\'); }
        }

        private static void Main(string[] args)
        {
            if (args.Length > 0 && args[0] == "--install")
            {
                string dir = args.Length > 1 ? Path.GetFullPath(args[1]) : BaseDir;
                Install(dir);
                return;
            }
            if (args.Length > 0 && args[0] == "--uninstall")
            {
                Uninstall();
                return;
            }
            if (args.Length > 0 && args[0] == "--service")
            {
                string dir = args.Length > 1 ? Path.GetFullPath(args[1]) : BaseDir;
                ServiceBase.Run(new DpiService(dir));
                return;
            }

            Console.WriteLine("UndertowDpiService.exe --install <zapret dir> | --uninstall | --service <dir>");
        }

        private static void Install(string baseDir)
        {
            string exe = Path.Combine(baseDir, "UndertowDpiService.exe");
            if (!File.Exists(exe))
            {
                Fail("Не найден " + exe);
            }

            IntPtr manager = Native.OpenSCManager(null, null, Native.SC_MANAGER_ALL_ACCESS);
            if (manager == IntPtr.Zero) FailLast("OpenSCManager");

            try
            {
                IntPtr old = Native.OpenService(
                    manager,
                    "UndertowDpi",
                    Native.SERVICE_ALL_ACCESS | Native.DELETE);
                if (old != IntPtr.Zero)
                {
                    Native.SERVICE_STATUS status = new Native.SERVICE_STATUS();
                    Native.ControlService(old, Native.SERVICE_CONTROL_STOP, ref status);
                    Native.DeleteService(old);
                    Native.CloseServiceHandle(old);
                    Thread.Sleep(500);
                }

                string binary = "\"" + exe + "\" --service \"" + baseDir + "\"";
                IntPtr service = Native.CreateService(
                    manager,
                    "UndertowDpi",
                    "Undertow DPI Helper",
                    Native.SERVICE_ALL_ACCESS,
                    Native.SERVICE_WIN32_OWN_PROCESS,
                    Native.SERVICE_AUTO_START,
                    Native.SERVICE_ERROR_NORMAL,
                    binary,
                    null,
                    IntPtr.Zero,
                    null,
                    null,
                    null);
                if (service == IntPtr.Zero) FailLast("CreateService");

                bool started = Native.StartService(service, 0, null);
                if (!started)
                {
                    int code = Marshal.GetLastWin32Error();
                    Native.CloseServiceHandle(service);
                    // 1056 = служба уже запущена, это не ошибка
                    if (code != 1056) Fail("StartService: " + new Win32Exception(code).Message);
                }
                else
                {
                    Native.CloseServiceHandle(service);
                }
                DpiService.Log("installed from " + baseDir);
                Console.WriteLine("UndertowDpi installed");
            }
            finally
            {
                Native.CloseServiceHandle(manager);
            }
        }

        private static void Uninstall()
        {
            IntPtr manager = Native.OpenSCManager(null, null, Native.SC_MANAGER_ALL_ACCESS);
            if (manager == IntPtr.Zero) FailLast("OpenSCManager");
            try
            {
                IntPtr service = Native.OpenService(
                    manager,
                    "UndertowDpi",
                    Native.SERVICE_ALL_ACCESS | Native.DELETE);
                if (service == IntPtr.Zero)
                {
                    int code = Marshal.GetLastWin32Error();
                    if (code == 1060) return; // службы уже нет
                    Fail("OpenService: " + new Win32Exception(code).Message);
                }
                Native.SERVICE_STATUS status = new Native.SERVICE_STATUS();
                Native.ControlService(service, Native.SERVICE_CONTROL_STOP, ref status);
                if (!Native.DeleteService(service))
                {
                    FailLast("DeleteService");
                }
                Native.CloseServiceHandle(service);
                DpiService.Log("uninstalled");
                Console.WriteLine("UndertowDpi removed");
            }
            finally
            {
                Native.CloseServiceHandle(manager);
            }
        }

        private static void Fail(string message)
        {
            Console.Error.WriteLine(message);
            Environment.Exit(1);
        }

        private static void FailLast(string operation)
        {
            int code = Marshal.GetLastWin32Error();
            Fail(operation + ": " + new Win32Exception(code).Message);
        }
    }
}
