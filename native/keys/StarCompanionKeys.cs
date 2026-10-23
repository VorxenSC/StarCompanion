// Star Companion key listener (Windows).
//
// Why this exists: Star Citizen registers its keyboard with Raw Input and the "no hotkeys" flag, which
// switches off RegisterHotKey-style global shortcuts (what Electron's globalShortcut uses) while the game
// has focus. A window that registers for keyboard Raw Input with RIDEV_INPUTSINK still *receives* key
// events in the background: the documented, passive way to listen. Nothing is hooked or injected, keys
// are neither blocked nor changed, and the game process is never touched. Same approach as the Mining
// Assistant's HotkeyManager.
//
// Protocol (lines on stdin/stdout):
//   in:  "keys <token> [<token>...]"  keys to watch; a token is "vk:<decimal>" or "char:<c>" (the key
//                                     that types c on the active layout, so "/" works on ABNT2 and US)
//   in:  "pause" / "resume"           stop / restart reporting (while the shortcut is being changed)
//   out: "READY" once listening, "HIT" when a watched key goes down with no Ctrl/Alt/Shift/Win held,
//        "ERROR <message>" if listening is impossible.
// The process exits when stdin closes, so it never outlives Star Companion.
//
// Built with the C# 5 compiler that ships with .NET Framework 4.x (scripts/build-keys.js).

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

internal static class Program
{
    private const int WM_INPUT = 0x00FF;
    private const uint RIDEV_INPUTSINK = 0x00000100;
    private const uint RID_INPUT = 0x10000003;
    private const uint RIM_TYPEKEYBOARD = 1;
    private const ushort RI_KEY_BREAK = 1;
    private const uint VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_MENU = 0x12, VK_LWIN = 0x5B, VK_RWIN = 0x5C;

    [StructLayout(LayoutKind.Sequential)]
    private struct RAWINPUTDEVICE { public ushort usUsagePage; public ushort usUsage; public uint dwFlags; public IntPtr hwndTarget; }

    [StructLayout(LayoutKind.Sequential)]
    private struct RAWINPUTHEADER { public uint dwType; public uint dwSize; public IntPtr hDevice; public IntPtr wParam; }

    [StructLayout(LayoutKind.Sequential)]
    private struct RAWKEYBOARD { public ushort MakeCode; public ushort Flags; public ushort Reserved; public ushort VKey; public uint Message; public uint ExtraInformation; }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] devices, uint count, uint size);

    [DllImport("user32.dll")]
    private static extern uint GetRawInputData(IntPtr hRawInput, uint command, IntPtr data, ref uint size, uint headerSize);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "VkKeyScanW")]
    private static extern short VkKeyScan(char ch);

    private static readonly object Gate = new object();
    private static HashSet<uint> watched = new HashSet<uint>();
    private static bool paused;

    private sealed class Listener : NativeWindow
    {
        private readonly HashSet<uint> down = new HashSet<uint>();
        private readonly Dictionary<uint, DateTime> lastSeen = new Dictionary<uint, DateTime>();
        private static readonly TimeSpan StaleAfter = TimeSpan.FromSeconds(2);

        public Listener() { CreateHandle(new CreateParams()); }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_INPUT)
            {
                uint vkey;
                bool isUp;
                if (TryReadKeyboard(m.LParam, out vkey, out isUp) && vkey != 0 && vkey != 0xFF) OnKey(vkey, isUp);
            }
            base.WndProc(ref m);
        }

        private void OnKey(uint vkey, bool isUp)
        {
            DateTime now = DateTime.UtcNow;
            if (isUp)
            {
                down.Remove(vkey);
                lastSeen.Remove(vkey);
                return;
            }
            // A lost key-up (Win+L, UAC) would leave a modifier "held" forever; a held key auto-repeats,
            // so one silent for 2 s is treated as released.
            foreach (KeyValuePair<uint, DateTime> kv in new List<KeyValuePair<uint, DateTime>>(lastSeen))
                if (now - kv.Value > StaleAfter) { down.Remove(kv.Key); lastSeen.Remove(kv.Key); }

            bool isNew = down.Add(vkey); // fire on the up→down transition, not on auto-repeat
            lastSeen[vkey] = now;
            if (!isNew) return;

            bool modifierHeld = down.Contains(VK_SHIFT) || down.Contains(VK_CONTROL) || down.Contains(VK_MENU) || down.Contains(VK_LWIN) || down.Contains(VK_RWIN);
            bool hit;
            lock (Gate) hit = !paused && !modifierHeld && watched.Contains(vkey);
            if (hit) Send("HIT");
        }
    }

    private static bool TryReadKeyboard(IntPtr lParam, out uint vkey, out bool isUp)
    {
        vkey = 0;
        isUp = false;
        uint headerSize = (uint)Marshal.SizeOf(typeof(RAWINPUTHEADER));
        uint size = 0;
        GetRawInputData(lParam, RID_INPUT, IntPtr.Zero, ref size, headerSize);
        if (size == 0) return false;
        IntPtr buffer = Marshal.AllocHGlobal((int)size);
        try
        {
            if (GetRawInputData(lParam, RID_INPUT, buffer, ref size, headerSize) != size) return false;
            RAWINPUTHEADER header = (RAWINPUTHEADER)Marshal.PtrToStructure(buffer, typeof(RAWINPUTHEADER));
            if (header.dwType != RIM_TYPEKEYBOARD) return false;
            RAWKEYBOARD kb = (RAWKEYBOARD)Marshal.PtrToStructure(new IntPtr(buffer.ToInt64() + headerSize), typeof(RAWKEYBOARD));
            vkey = kb.VKey;
            isUp = (kb.Flags & RI_KEY_BREAK) != 0;
            return true;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    // "vk:111" → 111; "char:/" → the virtual key that types "/" on the active layout (no modifiers needed).
    private static HashSet<uint> ParseKeys(string[] tokens, int start)
    {
        HashSet<uint> keys = new HashSet<uint>();
        for (int i = start; i < tokens.Length; i++)
        {
            string t = tokens[i];
            if (t.StartsWith("vk:"))
            {
                uint vk;
                if (uint.TryParse(t.Substring(3), out vk) && vk > 0 && vk < 0xFF) keys.Add(vk);
            }
            else if (t.StartsWith("char:") && t.Length == 6)
            {
                short scan = VkKeyScan(t[5]);
                if (scan != -1 && ((scan >> 8) & 0xFF) == 0) keys.Add((uint)(scan & 0xFF));
            }
        }
        return keys;
    }

    private static void Send(string line)
    {
        lock (Console.Out) { Console.Out.WriteLine(line); Console.Out.Flush(); }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        Listener listener = new Listener();
        RAWINPUTDEVICE[] devices = new RAWINPUTDEVICE[1];
        devices[0].usUsagePage = 0x01; // generic desktop
        devices[0].usUsage = 0x06;     // keyboard
        devices[0].dwFlags = RIDEV_INPUTSINK;
        devices[0].hwndTarget = listener.Handle;
        if (!RegisterRawInputDevices(devices, 1, (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICE))))
        {
            Send("ERROR raw input registration failed (" + Marshal.GetLastWin32Error() + ")");
            return 1;
        }
        lock (Gate) watched = ParseKeys(args, 0);
        Send("READY");

        // Commands arrive on stdin; when Star Companion goes away, stdin closes and so do we.
        Thread reader = new Thread(delegate ()
        {
            string line;
            while ((line = Console.In.ReadLine()) != null)
            {
                string[] parts = line.Trim().Split(' ');
                lock (Gate)
                {
                    if (parts[0] == "keys") watched = ParseKeys(parts, 1);
                    else if (parts[0] == "pause") paused = true;
                    else if (parts[0] == "resume") paused = false;
                }
            }
            Environment.Exit(0);
        });
        reader.IsBackground = true;
        reader.Start();

        Application.Run();
        return 0;
    }
}
