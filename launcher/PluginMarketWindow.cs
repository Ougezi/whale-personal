using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;


namespace WhaleLauncher
{
    /// <summary>
    /// 插件市场：参考 Obsidian 社区目录 / VS Code 扩展视图 / Dify Marketplace 的布局——
    ///   顶部搜索 + 分类 → 卡片网格（自适应换行）→ 点卡片进「详情页」，详情里列具体功能。
    ///   写操作开关只属于「刷抖音」插件：只有它的详情页出现这张卡，别的插件不显示。
    /// </summary>
    public sealed class PluginMarketWindow : Window
    {
        private const string KernelBase = "http://127.0.0.1:8787";
        private readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromMinutes(4) };
        private readonly TextBox _search = new TextBox { Height = 32, Margin = new Thickness(0, 0, 10, 0) };
        private readonly WrapPanel _chips = new WrapPanel { Margin = new Thickness(0, 0, 0, 10) };
        private readonly ScrollViewer _body = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
        private readonly TextBox _output = new TextBox
        {
            IsReadOnly = true, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            FontFamily = new FontFamily("Consolas"), Background = Brushes.Transparent, BorderThickness = new Thickness(0)
        };
        private readonly TextBlock _status = new TextBlock { Margin = new Thickness(0, 0, 0, 4), Opacity = 0.7, FontSize = 11.5 };
        private readonly StackPanel _detail = new StackPanel();
        private readonly CheckBox _opsEnable = new CheckBox { Content = "启用写操作（点赞 / 收藏）", Margin = new Thickness(0, 0, 0, 6) };
        private readonly CheckBox _opsLike = new CheckBox { Content = "允许点赞", Margin = new Thickness(0, 0, 0, 6) };
        private readonly CheckBox _opsCollect = new CheckBox { Content = "允许收藏", Margin = new Thickness(0, 0, 0, 6) };
        private readonly TextBox _opsDaily = new TextBox { Width = 70, Height = 26, Text = "0", HorizontalAlignment = HorizontalAlignment.Left };
        private readonly TextBlock _opsStatus = new TextBlock { Opacity = 0.6, FontSize = 11.5, Margin = new Thickness(0, 6, 0, 0), TextWrapping = TextWrapping.Wrap };
        private readonly TextBlock _crumb = new TextBlock { Opacity = 0.7, FontSize = 12, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 0, 0) };
        private readonly string _token;
        private JsonDocument _catalog;
        private string _category = "全部";
        private JsonElement? _open;
        private string _pendingId;

        public PluginMarketWindow(Window owner)
        {
            Owner = owner;
            Title = "插件市场 · 鲸鲸";
            Width = 1120; Height = 760;
            MinWidth = 760; MinHeight = 500;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
            ResizeMode = ResizeMode.CanResize;
            Topmost = true; ShowInTaskbar = false;
            SetResourceReference(BackgroundProperty, "Bg");
            SetResourceReference(ForegroundProperty, "Text");
            FontSize = 12.5;
            _token = ReadToken();

            // ── 顶部：标题 + 搜索 ─────────────────────────────
            var header = new Grid { Margin = new Thickness(18, 14, 18, 8) };
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(320) });
            var titles = new StackPanel { Orientation = Orientation.Horizontal };
            titles.Children.Add(new TextBlock { Text = "插件市场", FontSize = 20, FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center });
            titles.Children.Add(new TextBlock { Text = "点卡片进详情，功能都在详情里", Margin = new Thickness(12, 0, 0, 0), Opacity = 0.6, VerticalAlignment = VerticalAlignment.Center });
            header.Children.Add(titles);
            _search.SetResourceReference(Control.BackgroundProperty, "BgTop");
            _search.SetResourceReference(Control.BorderBrushProperty, "Line");
            _search.TextChanged += (_, __) => { if (_open == null) RenderCards(); };
            Grid.SetColumn(_search, 1);
            header.Children.Add(_search);

            var crumbRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(18, 0, 18, 6) };
            _crumb.Text = "全部插件";
            crumbRow.Children.Add(_crumb);
            var refresh = new Button { Content = "刷新", Padding = new Thickness(10, 4, 10, 4), Margin = new Thickness(12, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center };
            refresh.SetResourceReference(StyleProperty, "Ghost");
            refresh.Click += async (_, __) => await LoadCatalog();
            crumbRow.Children.Add(refresh);

            // ── 主体：卡片网格 / 详情 ─────────────────────────
            _detail.Margin = new Thickness(0, 0, 6, 0);
            _body.Content = new WrapPanel();
            _body.Margin = new Thickness(18, 0, 18, 0);

            // ── 底部：输出控制台（可拖高）──────────────────────
            var console = new Grid { Margin = new Thickness(18, 8, 18, 14) };
            console.RowDefinitions.Add(new RowDefinition { Height = new GridLength(4) });
            console.RowDefinitions.Add(new RowDefinition { Height = new GridLength(0.3, GridUnitType.Star), MinHeight = 80 });
            var split = new GridSplitter { Height = 4, HorizontalAlignment = HorizontalAlignment.Stretch, Background = Brushes.Transparent };
            console.Children.Add(split);
            var outBorder = new Border { CornerRadius = new CornerRadius(8), Padding = new Thickness(10, 8, 10, 8) };
            outBorder.SetResourceReference(Border.BackgroundProperty, "BgTop");
            outBorder.SetResourceReference(Border.BorderBrushProperty, "Line");
            outBorder.BorderThickness = new Thickness(1);
            var outStack = new StackPanel();
            outStack.Children.Add(_status);
            outStack.Children.Add(_output);
            outBorder.Child = outStack;
            Grid.SetRow(outBorder, 1);
            console.Children.Add(outBorder);

            var root = new Grid();
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(0.34, GridUnitType.Star) });
            root.Children.Add(header);
            Grid.SetRow(crumbRow, 1); root.Children.Add(crumbRow);
            Grid.SetRow(_chips, 2); _chips.Margin = new Thickness(18, 0, 18, 8); root.Children.Add(_chips);
            Grid.SetRow(_body, 3); root.Children.Add(_body);
            Grid.SetRow(console, 4); root.Children.Add(console);
            Content = root;

            Loaded += async (_, __) => { Activate(); await LoadCatalog(); };
        }

        /// <summary>调试/截图用：直接打开某个插件的详情页</summary>
        public void OpenById(string id)
        {
            _pendingId = id;
            foreach (var p in AllPlugins())
            {
                if (string.Equals(p.GetProperty("id").GetString(), id, StringComparison.OrdinalIgnoreCase))
                {
                    _pendingId = null;
                    OpenDetail(p);
                    return;
                }
            }
        }

        // ── 数据 ───────────────────────────────────────────────
        private static string ReadToken()
        {
            try
            {
                var file = Path.Combine(AppContext.BaseDirectory, "data", "config.json");
                if (!File.Exists(file)) return "";
                using var doc = JsonDocument.Parse(File.ReadAllText(file));
                if (doc.RootElement.TryGetProperty("gateway", out var g) && g.TryGetProperty("wechat", out var w) && w.TryGetProperty("inboundToken", out var t))
                    return t.GetString() ?? "";
            }
            catch { }
            return "";
        }

        private async Task LoadCatalog()
        {
            for (var attempt = 0; attempt < 15; attempt++)
            {
                try
                {
                    var text = await _http.GetStringAsync(KernelBase + "/api/market/plugins");
                    _catalog?.Dispose();
                    _catalog = JsonDocument.Parse(text);
                    _open = null;
                    RenderChips();
                    RenderCards();
                    _status.Text = "已连接内核 · " + DateTime.Now.ToString("HH:mm:ss");
                    if (!string.IsNullOrEmpty(_pendingId)) OpenById(_pendingId);
                    return;
                }
                catch (Exception ex)
                {
                    if (attempt == 0) _status.Text = "等内核起来…";
                    await Task.Delay(1000);
                    if (attempt == 14)
                    {
                        _status.Text = "内核还没起来";
                        _output.Text = "内核没连上：" + ex.Message + "\n先点主窗口右上角「启动」，再打开插件市场。";
                    }
                }
            }
        }

        private IEnumerable<JsonElement> AllPlugins()
        {
            if (_catalog == null) yield break;
            foreach (var p in _catalog.RootElement.GetProperty("plugins").EnumerateArray()) yield return p;
        }

        // ── 分类 chips ─────────────────────────────────────────
        private void RenderChips()
        {
            _chips.Children.Clear();
            var cats = new List<string> { "全部" };
            foreach (var p in AllPlugins())
            {
                var c = p.TryGetProperty("category", out var cv) ? cv.GetString() : "";
                if (!string.IsNullOrEmpty(c) && !cats.Contains(c)) cats.Add(c);
            }
            foreach (var cat in cats)
            {
                var b = new Button { Content = cat, Padding = new Thickness(11, 4, 11, 4), Margin = new Thickness(0, 0, 6, 6) };
                b.SetResourceReference(StyleProperty, cat == _category ? "Primary" : "Ghost");
                b.Click += (_, __) => { _category = cat; RenderChips(); RenderCards(); };
                _chips.Children.Add(b);
            }
        }

        // ── 卡片网格 ───────────────────────────────────────────
        private void RenderCards()
        {
            _open = null;
            _crumb.Text = "全部插件 · 点卡片看功能";
            var panel = new WrapPanel();
            var q = _search.Text.Trim();
            foreach (var p in AllPlugins())
            {
                var name = p.GetProperty("name").GetString() ?? "";
                var desc = p.GetProperty("desc").GetString() ?? "";
                var cat = p.TryGetProperty("category", out var cv) ? cv.GetString() : "";
                if (_category != "全部" && cat != _category) continue;
                if (q.Length > 0 && !(name.Contains(q, StringComparison.OrdinalIgnoreCase) || desc.Contains(q, StringComparison.OrdinalIgnoreCase))) continue;
                panel.Children.Add(BuildCard(p));
            }
            if (panel.Children.Count == 0)
            {
                panel.Children.Add(new TextBlock { Text = "没有匹配的插件。", Opacity = 0.6, Margin = new Thickness(4, 12, 0, 0) });
            }
            _body.Content = panel;
        }

        private Border BuildCard(JsonElement p)
        {
            var id = p.GetProperty("id").GetString() ?? "";
            var name = p.GetProperty("name").GetString() ?? "";
            var desc = p.GetProperty("desc").GetString() ?? "";
            var version = p.TryGetProperty("version", out var v) ? v.GetString() : "";
            var status = p.TryGetProperty("status", out var st) ? st.GetString() : "";
            var icon = p.TryGetProperty("icon", out var ic) ? ic.GetString() : "●";
            var count = p.TryGetProperty("panels", out var pn) ? pn.GetArrayLength() : 0;

            var card = new Border
            {
                Width = 330, Height = 120, Margin = new Thickness(0, 0, 10, 10), Padding = new Thickness(12),
                CornerRadius = new CornerRadius(10), Cursor = System.Windows.Input.Cursors.Hand
            };
            card.SetResourceReference(Border.BackgroundProperty, "BgTop");
            card.SetResourceReference(Border.BorderBrushProperty, "Line");
            card.BorderThickness = new Thickness(1);

            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(44) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var badge = new Border { Width = 36, Height = 36, CornerRadius = new CornerRadius(8), VerticalAlignment = VerticalAlignment.Top };
            badge.SetResourceReference(Border.BackgroundProperty, "Bg");
            badge.SetResourceReference(Border.BorderBrushProperty, "Line");
            badge.BorderThickness = new Thickness(1);
            badge.Child = new TextBlock { Text = icon, FontSize = 16, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            grid.Children.Add(badge);

            var stack = new StackPanel { Margin = new Thickness(12, 0, 0, 0) };
            var head = new StackPanel { Orientation = Orientation.Horizontal };
            head.Children.Add(new TextBlock { Text = name, FontWeight = FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis });
            head.Children.Add(new TextBlock { Text = "  v" + version, Opacity = 0.5, FontSize = 11 });
            stack.Children.Add(head);
            stack.Children.Add(new TextBlock
            {
                Text = desc, TextWrapping = TextWrapping.Wrap, MaxHeight = 34, Opacity = 0.7, FontSize = 11.5,
                Margin = new Thickness(0, 4, 0, 6), TextTrimming = TextTrimming.CharacterEllipsis
            });
            var meta = new StackPanel { Orientation = Orientation.Horizontal };
            meta.Children.Add(new TextBlock { Text = StatusText(status), FontSize = 11, Opacity = 0.75 });
            meta.Children.Add(new TextBlock { Text = "  ·  " + count + " 个功能", FontSize = 11, Opacity = 0.55 });
            stack.Children.Add(meta);
            Grid.SetColumn(stack, 1);
            grid.Children.Add(stack);
            card.Child = grid;
            card.MouseLeftButtonUp += (_, __) => OpenDetail(p);
            return card;
        }

        private static string StatusText(string s) => s switch
        {
            "ready" => "● 就绪",
            "bridge" => "● 桥接",
            "missing" => "○ 缺文件",
            _ => "○ " + s
        };

        // ── 详情页 ─────────────────────────────────────────────
        private void OpenDetail(JsonElement p)
        {
            _open = p;
            var name = p.GetProperty("name").GetString() ?? "";
            _crumb.Text = "插件市场 / " + name;
            _detail.Children.Clear();

            var back = new Button { Content = "← 返回插件列表", Padding = new Thickness(10, 4, 10, 4), HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 0, 0, 10) };
            back.SetResourceReference(StyleProperty, "Ghost");
            back.Click += (_, __) => RenderCards();
            _detail.Children.Add(back);

            // 头部
            var headGrid = new Grid { Margin = new Thickness(0, 0, 0, 10) };
            headGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(52) });
            headGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var icon = p.TryGetProperty("icon", out var ic) ? ic.GetString() : "●";
            var badge = new Border { Width = 44, Height = 44, CornerRadius = new CornerRadius(10), VerticalAlignment = VerticalAlignment.Top };
            badge.SetResourceReference(Border.BackgroundProperty, "BgTop");
            badge.SetResourceReference(Border.BorderBrushProperty, "Line");
            badge.BorderThickness = new Thickness(1);
            badge.Child = new TextBlock { Text = icon, FontSize = 18, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            headGrid.Children.Add(badge);
            var info = new StackPanel { Margin = new Thickness(12, 0, 0, 0) };
            var titleRow = new StackPanel { Orientation = Orientation.Horizontal };
            titleRow.Children.Add(new TextBlock { Text = name, FontSize = 18, FontWeight = FontWeights.SemiBold });
            titleRow.Children.Add(new TextBlock { Text = "  v" + (p.TryGetProperty("version", out var v) ? v.GetString() : ""), Opacity = 0.55, VerticalAlignment = VerticalAlignment.Center });
            titleRow.Children.Add(new TextBlock { Text = "  " + StatusText(p.TryGetProperty("status", out var st) ? st.GetString() : ""), Opacity = 0.7, FontSize = 11, VerticalAlignment = VerticalAlignment.Center });
            info.Children.Add(titleRow);
            info.Children.Add(new TextBlock { Text = p.GetProperty("desc").GetString() ?? "", TextWrapping = TextWrapping.Wrap, Opacity = 0.7, Margin = new Thickness(0, 4, 0, 0) });
            Grid.SetColumn(info, 1);
            headGrid.Children.Add(info);
            _detail.Children.Add(headGrid);

            // 功能列表
            _detail.Children.Add(new TextBlock { Text = "功能", FontSize = 13, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 4, 0, 8) });
            var features = new StackPanel();
            if (p.TryGetProperty("panels", out var panels))
            {
                foreach (var panel in panels.EnumerateArray())
                {
                    features.Children.Add(BuildFeatureRow(panel));
                }
            }
            _detail.Children.Add(features);

            // 写操作开关：只属于「刷抖音」这个插件
            if (string.Equals(p.GetProperty("id").GetString(), "douyin-watch", StringComparison.OrdinalIgnoreCase))
            {
                _detail.Children.Add(BuildOpsCard());
                _ = LoadOps();
            }

            _body.Content = _detail;
            _body.ScrollToTop();
        }

        private Border BuildFeatureRow(JsonElement panel)
        {
            var title = panel.TryGetProperty("title", out var t) ? t.GetString() : "功能";
            var desc = panel.TryGetProperty("desc", out var d) ? d.GetString() : "";
            var row = new Border
            {
                Margin = new Thickness(0, 0, 0, 7), Padding = new Thickness(12, 9, 12, 9),
                CornerRadius = new CornerRadius(8), Cursor = System.Windows.Input.Cursors.Hand
            };
            row.SetResourceReference(Border.BackgroundProperty, "BgTop");
            row.SetResourceReference(Border.BorderBrushProperty, "Line");
            row.BorderThickness = new Thickness(1);
            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var text = new StackPanel();
            text.Children.Add(new TextBlock { Text = title, FontWeight = FontWeights.SemiBold });
            if (!string.IsNullOrEmpty(desc)) text.Children.Add(new TextBlock { Text = desc, Opacity = 0.62, FontSize = 11.5, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 2, 0, 0) });
            grid.Children.Add(text);
            var go = new TextBlock { Text = "运行 ›", Opacity = 0.5, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(10, 0, 0, 0) };
            Grid.SetColumn(go, 1);
            grid.Children.Add(go);
            row.Child = grid;
            row.MouseLeftButtonUp += async (_, __) => await RunPanel(panel);
            return row;
        }

        private Border BuildOpsCard()
        {
            var card = new Border { Padding = new Thickness(12), Margin = new Thickness(0, 12, 0, 10), CornerRadius = new CornerRadius(8) };
            card.SetResourceReference(Border.BackgroundProperty, "BgTop");
            card.SetResourceReference(Border.BorderBrushProperty, "Line");
            card.BorderThickness = new Thickness(1);
            var stack = new StackPanel();
            stack.Children.Add(new TextBlock { Text = "写操作开关（只属于刷抖音，默认关）", FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 0, 0, 8) });
            _opsEnable.Checked += (_, __) => SyncOpsEnabled();
            _opsEnable.Unchecked += (_, __) => SyncOpsEnabled();
            _opsLike.IsEnabled = false;
            _opsCollect.IsEnabled = false;
            stack.Children.Add(_opsEnable);
            stack.Children.Add(_opsLike);
            stack.Children.Add(_opsCollect);
            var dailyRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 2, 0, 0) };
            dailyRow.Children.Add(new TextBlock { Text = "每天最多写几次：", VerticalAlignment = VerticalAlignment.Center, Opacity = 0.75 });
            _opsDaily.SetResourceReference(Control.BackgroundProperty, "Bg");
            _opsDaily.SetResourceReference(Control.BorderBrushProperty, "Line");
            dailyRow.Children.Add(_opsDaily);
            stack.Children.Add(dailyRow);
            var apply = new Button { Content = "保存开关", Padding = new Thickness(12, 5, 12, 5), Margin = new Thickness(0, 8, 0, 0), HorizontalAlignment = HorizontalAlignment.Left };
            apply.SetResourceReference(StyleProperty, "Primary");
            apply.Click += async (_, __) => await SaveOps();
            stack.Children.Add(apply);
            stack.Children.Add(_opsStatus);
            card.Child = stack;
            return card;
        }

        // ── 执行 ───────────────────────────────────────────────
        private async Task RunPanel(JsonElement panel)
        {
            var kind = panel.TryGetProperty("kind", out var k) ? k.GetString() : "";
            try
            {
                if (kind == "info")
                {
                    _output.Text = panel.TryGetProperty("text", out var t) ? t.GetString() : "";
                    _status.Text = "说明";
                    return;
                }
                if (string.IsNullOrEmpty(_token) && (kind == "douyin" || kind == "http"))
                {
                    _output.Text = "没读到内核 token（data/config.json），先启动一次内核。";
                    return;
                }
                var body = new JsonObjectLite();
                if (panel.TryGetProperty("args", out var args) && args.ValueKind == JsonValueKind.Object) body.MergeJson(args);
                if (panel.TryGetProperty("input", out var input) && input.TryGetProperty("field", out var fieldEl))
                {
                    var field = fieldEl.GetString() ?? "";
                    var hint = input.TryGetProperty("hint", out var h) ? h.GetString() : field;
                    var value = PromptInput(panel.GetProperty("title").GetString() ?? "输入", hint ?? field, body.GetString(field));
                    if (value == null) return;
                    body.Set(field, value);
                }
                if (panel.TryGetProperty("body", out var extra) && extra.ValueKind == JsonValueKind.Object) body.MergeJson(extra);

                string text;
                if (kind == "douyin")
                {
                    var op = panel.GetProperty("op").GetString() ?? "status";
                    body.Set("op", op);
                    text = await PostJson("/api/douyin/run", body);
                }
                else
                {
                    var method = panel.TryGetProperty("method", out var m) ? m.GetString() : "GET";
                    var path = panel.GetProperty("path").GetString() ?? "/api/status";
                    text = method == "POST" ? await PostJson(path, body) : await GetJson(path);
                }
                _output.Text = Pretty(text);
                _status.Text = "完成 · " + DateTime.Now.ToString("HH:mm:ss");
            }
            catch (Exception ex)
            {
                _status.Text = "失败";
                _output.Text = ex.Message;
            }
        }

        private async Task LoadOps()
        {
            try
            {
                var text = await GetJson("/api/market/ops");
                using var doc = JsonDocument.Parse(text);
                var root = doc.RootElement;
                _opsEnable.IsChecked = root.TryGetProperty("enableOps", out var e) && e.GetBoolean();
                _opsLike.IsChecked = root.TryGetProperty("allowLike", out var l) && l.GetBoolean();
                _opsCollect.IsChecked = root.TryGetProperty("allowCollect", out var c) && c.GetBoolean();
                _opsDaily.Text = (root.TryGetProperty("dailyWriteActions", out var d) ? d.GetInt32() : 0).ToString();
                SyncOpsEnabled();
                _opsStatus.Text = "现在：写操作" + (_opsEnable.IsChecked == true ? "开" : "关") + "，保存后 sidecar 下次启动生效";
            }
            catch (Exception ex)
            {
                _opsStatus.Text = "读开关失败：" + ex.Message;
            }
        }

        private void SyncOpsEnabled()
        {
            var on = _opsEnable.IsChecked == true;
            _opsLike.IsEnabled = on;
            _opsCollect.IsEnabled = on;
        }

        private async Task SaveOps()
        {
            if (string.IsNullOrEmpty(_token)) { _opsStatus.Text = "没有内核 token，无法保存"; return; }
            var body = new JsonObjectLite();
            body.Set("enableOps", _opsEnable.IsChecked == true);
            body.Set("allowLike", _opsLike.IsChecked == true);
            body.Set("allowCollect", _opsCollect.IsChecked == true);
            body.Set("dailyWriteActions", int.TryParse(_opsDaily.Text.Trim(), out var n) ? Math.Max(0, Math.Min(20, n)) : 0);
            try
            {
                var text = await PostJson("/api/market/ops", body);
                _opsStatus.Text = "已保存：" + Pretty(text);
            }
            catch (Exception ex)
            {
                _opsStatus.Text = "保存失败：" + ex.Message;
            }
        }

        private async Task<string> PostJson(string path, JsonObjectLite body)
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, KernelBase + path);
            if (!string.IsNullOrEmpty(_token)) req.Headers.TryAddWithoutValidation("x-bot-token", _token);
            req.Content = new StringContent(body.ToJson(), Encoding.UTF8, "application/json");
            using var res = await _http.SendAsync(req);
            return await res.Content.ReadAsStringAsync();
        }

        private async Task<string> GetJson(string path)
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, KernelBase + path);
            if (!string.IsNullOrEmpty(_token)) req.Headers.TryAddWithoutValidation("x-bot-token", _token);
            using var res = await _http.SendAsync(req);
            return await res.Content.ReadAsStringAsync();
        }

        private string PromptInput(string title, string hint, string current)
        {
            var win = new Window
            {
                Owner = this, Title = title, Width = 520, Height = 170, MinWidth = 360,
                WindowStartupLocation = WindowStartupLocation.CenterOwner, ResizeMode = ResizeMode.NoResize
            };
            win.SetResourceReference(BackgroundProperty, "Bg");
            win.SetResourceReference(ForegroundProperty, "Text");
            var box = new TextBox { Text = current ?? "", Height = 30, Margin = new Thickness(16, 16, 16, 8) };
            box.SetResourceReference(Control.BackgroundProperty, "BgTop");
            box.SetResourceReference(Control.BorderBrushProperty, "Line");
            var tip = new TextBlock { Text = hint, Margin = new Thickness(16, 0, 16, 8), Opacity = 0.65, TextWrapping = TextWrapping.Wrap };
            var ok = new Button { Content = "执行", Width = 90, Margin = new Thickness(0, 0, 12, 12), HorizontalAlignment = HorizontalAlignment.Right };
            ok.SetResourceReference(StyleProperty, "Primary");
            var cancel = new Button { Content = "取消", Width = 80, Margin = new Thickness(0, 0, 16, 12), HorizontalAlignment = HorizontalAlignment.Right };
            cancel.SetResourceReference(StyleProperty, "Ghost");
            string result = null;
            ok.Click += (_, __) => { result = box.Text; win.Close(); };
            cancel.Click += (_, __) => win.Close();
            var stack = new StackPanel();
            stack.Children.Add(box);
            stack.Children.Add(tip);
            var row = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
            row.Children.Add(cancel);
            row.Children.Add(ok);
            stack.Children.Add(row);
            win.Content = stack;
            win.ShowDialog();
            return result;
        }

        private static string Pretty(string text)
        {
            try
            {
                using var doc = JsonDocument.Parse(text);
                return JsonSerializer.Serialize(doc.RootElement, new JsonSerializerOptions { WriteIndented = true });
            }
            catch { return text; }
        }

        private sealed class JsonObjectLite
        {
            private readonly Dictionary<string, JsonElement> _items = new();
            public void Set(string key, string value) => Store(key, JsonSerializer.Serialize(value));
            public void Set(string key, bool value) => Store(key, value ? "true" : "false");
            public void Set(string key, int value) => Store(key, value.ToString());
            private void Store(string key, string json)
            {
                using var doc = JsonDocument.Parse(json);
                _items[key] = doc.RootElement.Clone();
            }
            public void MergeJson(JsonElement obj)
            {
                foreach (var p in obj.EnumerateObject()) _items[p.Name] = p.Value.Clone();
            }
            public string GetString(string key) => _items.TryGetValue(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            public string ToJson()
            {
                using var ms = new MemoryStream();
                using (var w = new Utf8JsonWriter(ms))
                {
                    w.WriteStartObject();
                    foreach (var kv in _items) { w.WritePropertyName(kv.Key); kv.Value.WriteTo(w); }
                    w.WriteEndObject();
                }
                return Encoding.UTF8.GetString(ms.ToArray());
            }
        }
    }
}
