param(
  [Parameter(Mandatory = $true)][Int64]$Handle,
  [string]$IconPath
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;

public static class TaskbarPropertyCheck {
  [StructLayout(LayoutKind.Sequential)]
  public struct PropertyKey { public Guid format; public uint id; }
  [StructLayout(LayoutKind.Explicit, Size = 24)]
  public struct PropVariant {
    [FieldOffset(0)] public ushort type;
    [FieldOffset(8)] public IntPtr text;
  }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int GetAt(uint index, out PropertyKey key);
    [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
    [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
    [PreserveSig] int Commit();
  }
  [DllImport("shell32.dll")]
  static extern int SHGetPropertyStoreForWindow(IntPtr window, ref Guid iid, out IPropertyStore store);
  [DllImport("ole32.dll")]
  static extern int PropVariantClear(ref PropVariant value);
  [DllImport("user32.dll")]
  static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  public static Dictionary<string, string> Read(IntPtr window) {
    var iid = typeof(IPropertyStore).GUID;
    IPropertyStore store;
    Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(window, ref iid, out store));
    var output = new Dictionary<string, string>();
    var names = new[] { "command", "icon", "name", "appId" };
    try {
      for (uint index = 0; index < names.Length; index++) {
        var key = new PropertyKey { format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), id = index + 2 };
        PropVariant value;
        Marshal.ThrowExceptionForHR(store.GetValue(ref key, out value));
        try { output[names[index]] = value.type == 31 ? Marshal.PtrToStringUni(value.text) : null; }
        finally { PropVariantClear(ref value); }
      }
    } finally { Marshal.ReleaseComObject(store); }
    return output;
  }
  public static void SaveIcon(IntPtr window, string file) {
    var handle = SendMessage(window, 0x007F, new IntPtr(1), IntPtr.Zero);
    if (handle == IntPtr.Zero) throw new Exception("Window has no native icon");
    using (var icon = Icon.FromHandle(handle))
    using (var bitmap = icon.ToBitmap()) bitmap.Save(file, System.Drawing.Imaging.ImageFormat.Png);
  }
}
'@
if ($IconPath) { [TaskbarPropertyCheck]::SaveIcon([IntPtr]$Handle, $IconPath) }
[TaskbarPropertyCheck]::Read([IntPtr]$Handle) | ConvertTo-Json -Compress
