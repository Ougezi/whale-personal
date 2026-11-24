using System;
using System.Runtime.InteropServices;

namespace WhaleLauncher
{
    /// <summary>
    /// 去掉「来自 Internet」标记（Zone.Identifier）。
    /// 更新包从 GitHub 下载，落到临时目录后会被 Windows 打上 Mark-of-the-Web；
    /// 解压/替换后双击会弹「打开文件 - 安全警告 / 无法验证发布者」。
    /// 这里在下载完成后直接删掉这个备用数据流，启动器自己不再触发该提示。
    /// </summary>
    internal static class Motw
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool DeleteFileW(string lpFileName);

        public static void Remove(string path)
        {
            if (string.IsNullOrEmpty(path)) return;
            try { DeleteFileW(path + ":Zone.Identifier"); } catch { /* 没有标记就算了 */ }
        }
    }
}
