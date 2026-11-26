using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Windows.Forms;

static class Program
{
    private const string PanelUrl = "http://127.0.0.1:47821";

    [STAThread]
    static void Main()
    {
        bool createdNew;
        using (new Mutex(true, "BalacopapoUtilidadesSingleInstance", out createdNew))
        {
            if (!createdNew)
            {
                OpenPanel();
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string nodeExe = Path.Combine(baseDir, "runtime", "node.exe");
            string entryJs = Path.Combine(baseDir, "app", "dist", "index.js");

            if (!File.Exists(nodeExe) || !File.Exists(entryJs))
            {
                MessageBox.Show(
                    "Arquivos do Balacopapo Utilidades não encontrados.\nExtraia todo o conteúdo do .zip antes de abrir.",
                    "Balacopapo Utilidades",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return;
            }

            var proc = new Process();
            proc.StartInfo = new ProcessStartInfo
            {
                FileName = nodeExe,
                Arguments = "\"" + entryJs + "\"",
                WorkingDirectory = Path.Combine(baseDir, "app"),
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardError = true,
                RedirectStandardOutput = false,
            };

            string lastErr = "";
            proc.ErrorDataReceived += (s, e) =>
            {
                if (!string.IsNullOrEmpty(e.Data)) lastErr += e.Data + "\n";
            };
            proc.Start();
            proc.BeginErrorReadLine();

            var menu = new ContextMenuStrip();
            menu.Items.Add("Abrir painel", null, (s, e) => OpenPanel());
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Sair", null, (s, e) =>
            {
                StopWorker(proc);
                Application.Exit();
            });

            var tray = new NotifyIcon
            {
                Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application,
                Text = "Balacopapo Utilidades — Bot de Música",
                ContextMenuStrip = menu,
                Visible = true,
            };
            tray.DoubleClick += (s, e) => OpenPanel();

            var watchdog = new System.Windows.Forms.Timer { Interval = 1500 };
            watchdog.Tick += (s, e) =>
            {
                if (proc.HasExited)
                {
                    watchdog.Stop();
                    tray.Visible = false;
                    if (!string.IsNullOrWhiteSpace(lastErr))
                    {
                        MessageBox.Show(
                            "O serviço encerrou inesperadamente:\n\n" + lastErr.Trim(),
                            "Balacopapo Utilidades",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Error
                        );
                    }
                    Application.Exit();
                }
            };
            watchdog.Start();

            Application.ApplicationExit += (s, e) =>
            {
                tray.Visible = false;
                tray.Dispose();
                StopWorker(proc);
            };

            Application.Run();
        }
    }

    static void OpenPanel()
    {
        try
        {
            Process.Start(new ProcessStartInfo(PanelUrl) { UseShellExecute = true });
        }
        catch { }
    }

    static void StopWorker(Process proc)
    {
        try
        {
            if (!proc.HasExited) proc.Kill();
        }
        catch { }
    }
}
