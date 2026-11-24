using System;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;

namespace WhaleLauncher.Views;

// 内心记录（感受 / 教训）：只读视图，数据来自内核 /api/inner。
// 写入口在她自己的回复标记里（[[feel:…]] / [[lesson:…]]），启动器不提供编辑。
public sealed class InnerPage : UserControl, IRefreshable
{
    readonly RuntimeSupervisor sup;
    readonly TextBlock feelings = new() { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 18) };
    readonly TextBlock lessons = new() { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 0) };
    readonly TextBlock status = new() { Opacity = 0.72, Margin = new Thickness(0, 10, 0, 0), TextWrapping = TextWrapping.Wrap };

    public InnerPage(RuntimeSupervisor supervisor)
    {
        sup = supervisor;
        var root = new Grid { Margin = new Thickness(28, 24, 28, 20) };
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var head = new DockPanel();
        var title = new TextBlock { Text = "内心记录", FontSize = 20, FontWeight = FontWeights.SemiBold };
        var refresh = new Button { Content = "刷新", Padding = new Thickness(12, 4, 12, 4), HorizontalAlignment = HorizontalAlignment.Right };
        refresh.Click += async (_, _) => await RefreshAsync();
        DockPanel.SetDock(refresh, Dock.Right);
        head.Children.Add(refresh);
        head.Children.Add(title);
        Grid.SetRow(head, 0);
        root.Children.Add(head);

        var scroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Margin = new Thickness(0, 16, 0, 0) };
        var stack = new StackPanel();
        stack.Children.Add(new TextBlock { Text = "感受（她自己写下的）", FontWeight = FontWeights.SemiBold });
        stack.Children.Add(feelings);
        stack.Children.Add(new TextBlock { Text = "教训（以后怎么做）", FontWeight = FontWeights.SemiBold });
        stack.Children.Add(lessons);
        scroll.Content = stack;
        Grid.SetRow(scroll, 1);
        root.Children.Add(scroll);

        Grid.SetRow(status, 2);
        root.Children.Add(status);
        Content = root;

        Loaded += async (_, _) => { try { await RefreshAsync(); } catch { /* 页面刷新失败不影响其它页 */ } };
    }

    public async Task RefreshAsync()
    {
        status.Text = "读取中…";
        try
        {
            var res = await Api.Get(sup.Url, "/api/inner");
            if (!res.Ok) { status.Text = Api.FriendlyError(res.Raw ?? ""); return; }
            feelings.Text = Render(res.Prop("feelings"));
            lessons.Text = Render(res.Prop("lessons"));
            status.Text = "只读视图；她自己在聊天里用 [[feel:…]] / [[lesson:…]] 写。";
        }
        catch (Exception ex)
        {
            status.Text = Api.FriendlyError(ex);
        }
    }

    static string Render(JsonElement items)
    {
        if (items.ValueKind != JsonValueKind.Array) return "（暂不支持）";
        var sb = new StringBuilder();
        var n = 0;
        foreach (var it in items.EnumerateArray())
        {
            if (n >= 20) break;
            n++;
            var at = it.TryGetProperty("at", out var a) && a.ValueKind == JsonValueKind.String ? a.GetString() : "";
            var text = it.TryGetProperty("text", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() : "";
            sb.AppendLine("· " + (string.IsNullOrEmpty(at) ? "" : at + "  ") + text);
        }
        return n == 0 ? "（还没写过）" : sb.ToString().TrimEnd();
    }
}
