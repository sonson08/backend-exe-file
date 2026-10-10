using System.Diagnostics;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32;

const string AppName = "OllamaLauncher";
const string BaseUrl = "http://localhost:11434";
//const string PreloadModel = "llama3.2"; // set to "" to skip preloading
const string PreloadModel = "hf.co/mradermacher/Distil-PII-Llama-3.2-3B-Instruct-GGUF:Q4_K_M";



// Admin => all users (HKLM + ProgramData). Normal user => current user only (HKCU + LocalAppData).
bool isAdmin = new WindowsPrincipal(WindowsIdentity.GetCurrent())
    .IsInRole(WindowsBuiltInRole.Administrator);

string installDir = Path.Combine(
    Environment.GetFolderPath(isAdmin
        ? Environment.SpecialFolder.CommonApplicationData
        : Environment.SpecialFolder.LocalApplicationData),
    AppName);
string installedExe = Path.Combine(installDir, AppName + ".exe");
var hive = isAdmin ? Registry.LocalMachine : Registry.CurrentUser;
const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

// ---- uninstall ----
if (args.Contains("--uninstall"))
{
    using var k = hive.OpenSubKey(RunKey, writable: true);
    k?.DeleteValue(AppName, throwOnMissingValue: false);
    return;
}

// ---- self-install on first run ----
string? me = Environment.ProcessPath;
if (me != null && !string.Equals(me, installedExe, StringComparison.OrdinalIgnoreCase))
{
    Directory.CreateDirectory(installDir);
    File.Copy(me, installedExe, overwrite: true);
    using var k = hive.CreateSubKey(RunKey);
    k.SetValue(AppName, $"\"{installedExe}\"");
}

// ---- start Ollama ----
using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };

async Task<bool> IsRunningAsync()
{
    try { return (await http.GetAsync(BaseUrl)).IsSuccessStatusCode; }
    catch { return false; }
}

string FindOllama()
{
    string local = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Programs", "Ollama", "ollama.exe");
    if (File.Exists(local)) return local;

    string pf = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
        "Ollama", "ollama.exe");
    if (File.Exists(pf)) return pf;

    return "ollama"; // fall back to PATH
}

if (!await IsRunningAsync())
{
    try
    {
        Process.Start(new ProcessStartInfo(FindOllama(), "serve")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        });
    }
    catch { return; } // Ollama not installed

    for (int i = 0; i < 30 && !await IsRunningAsync(); i++)
        await Task.Delay(1000);
}

// ---- optional: preload model ----
if (!string.IsNullOrEmpty(PreloadModel) && await IsRunningAsync())
{
    try
    {
        using var longHttp = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
        var body = new StringContent(
            $"{{\"model\":\"{PreloadModel}\",\"keep_alive\":\"30m\"}}",
            Encoding.UTF8, "application/json");
        await longHttp.PostAsync($"{BaseUrl}/api/generate", body);
    }
    catch { }
}