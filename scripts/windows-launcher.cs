using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

[assembly: AssemblyTitle("自由画布提取")]
[assembly: AssemblyProduct("自由画布提取")]
[assembly: AssemblyDescription("自由画布提取图形启动器")]
[assembly: AssemblyVersion("1.4.0.0")]

internal static class WindowsLauncher
{
    [STAThread]
    private static int Main()
    {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string log = Path.Combine(root, ".runtime", "launcher-error.log");
        try
        {
            string script = Path.Combine(root, "launch.ps1");
            if (!File.Exists(script))
                throw new FileNotFoundException("请将启动程序放在软件目录中，与 launch.ps1 保持在同一文件夹。", script);

            var output = new StringBuilder();
            var start = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe"),
                Arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + script + "\" -Wait",
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            using (var process = new Process())
            {
                process.StartInfo = start;
                DataReceivedEventHandler collect = delegate(object sender, DataReceivedEventArgs args)
                {
                    if (args.Data == null) return;
                    lock (output)
                    {
                        if (output.Length < 65536) output.AppendLine(args.Data);
                    }
                };
                process.OutputDataReceived += collect;
                process.ErrorDataReceived += collect;
                process.Start();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                process.WaitForExit();
                if (process.ExitCode == 0) return 0;
                Directory.CreateDirectory(Path.GetDirectoryName(log));
                File.WriteAllText(log, output.ToString(), Encoding.UTF8);
                MessageBox.Show(
                    "软件启动失败，请查看以下日志：\n" + log + "\n" + Path.Combine(root, ".runtime", "startup-error.log"),
                    "自由画布提取", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return process.ExitCode;
            }
        }
        catch (Exception error)
        {
            MessageBox.Show("无法启动软件：\n" + error.Message, "自由画布提取",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
