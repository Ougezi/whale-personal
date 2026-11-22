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
    /// 插件市场：可缩放的自适应三段布局。
    ///   左：插件卡片（可调宽，跟着窗口伸缩）
    ///   右上：该插件的面板按钮（Wrap，窗口窄了自动换行）
    ///   右下：写操作开关（默认关）+ 执行输出
    /// 写操作开关只改 sidecar 的 state/ops.json，sidecar 下次启动按它注册 ops_like/ops_collect。
    /// </summary>
    public sealed class PluginMarketWindow : Window
    {
        private const string KernelBase = "http://127.0.0.1:8787";
        private readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromMinutes(4) };
        private readonly ListBox _list = new ListBox { Background = Brushes.Transparent, BorderThickness = new Thickness(0) };
        private readonly StackPanel _detail = new StackPanel { Margin = new Thickness(0, 0, 6, 0) };
        private readonly TextBox _search = new TextBox { Height = 30, Margin = new Thickness(0, 0, 0, 8) };
        private readonly TextBox _output = new TextBox
        {
            IsReadOnly = true, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            FontFamily = new FontFamily("Consolas"), Margin = new Thickness(0)
        };
        private readonly TextBlock _status = new TextBlock { Margin = new Thickness(0, 0, 0, 6), Opacity = 0.7 };
        private readonly CheckBox _opsEnable = new CheckBox { Content = "启用写操作（点赞 / 收藏）", Margin = new Thickness(0, 0, 0, 6) };
        private readonly CheckBox _opsLike = new CheckBox { Content = "允许点赞", Margin = new Thickness(0, 0, 0, 6) };
        private readonly CheckBox _opsCollect = new CheckBox { Content = "允许收藏", Margin = new Thickness(0, 0, 0, 6) };
        private readonly TextBox _opsDaily = new TextBox { Width = 70, Height = 26, Text = "0", HorizontalAlignment = HorizontalAlignment.Left };
        private readonly TextBlock _opsStatus = new TextBlock { Opacity = 0.6, FontSize = 11.5, Margin = new Thickness(0, 6, 0, 0), TextWrapping = TextWrapping.Wrap };
        private readonly string _token;
        private JsonDocument _catalog;
        private bool _opsLoaded;

        public PluginMarketWindow(Window owner)
        {
            Owner = owner;
            Title = "插件市场 · 鲸鲸";
            Width = 1080; Height = 720;
            MinWidth = 720; MinHeight = 460;
            WindowStartupLocation = WindowStartupLocation.CenterOwner;
            ResizeMode = ResizeMode.CanResize;
            Topmost = true; ShowInTaskbar = false;
            SetResourceReference(BackgroundProperty, "Bg");
            SetResourceReference(ForegroundProperty, "Text");
            FontSize = 12.5;
            _token = ReadToken();

            // ── 头部 ──────────────────────────────────────────────
            var header = new Grid { Margin = new Thickness(16, 14, 16, 10) };
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var titleRow = new StackPanel { Orientation = Orientation.Horizontal };
            titleRow.Children.Add(new TextBlock { Text = "插件市场", FontSize = 19, FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center });
            titleRow.Children.Add(new TextBlock { Text = "所有已安装插件的面板都在这", Margin = new Thickness(12, 0, 0, 0), Opacity = 0.62, VerticalAlignment = VerticalAlignment.Center });
            header.Children.Add(titleRow);
            var refresh = new Button { Content = "刷新", Padding = new Thickness(12, 5, 12, 5), VerticalAlignment = VerticalAlignment.Center };
            refresh.SetResourceReference(StyleProperty, "Ghost");
            refresh.Click += async (_, __) => await LoadCatalog();
            Grid.SetColumn(refresh, 1);
            header.Children.Add(refresh);

            // ── 主体：左列表（可拖） + 右面板 ────────────────────────
            var body = new Grid { Margin = new Thickness(16, 0, 16, 0) };
            var c0 = new ColumnDefinition { Width = new GridLength(0.3, GridUnitType.Star), MinWidth = 230, MaxWidth = 380 };
            body.ColumnDefinitions.Add(c0);
            body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(6) });
            body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var left = new Grid();
            left.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            left.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            var filterBox = new StackPanel();
            filterBox.Children.Add(new TextBlock { Text = "筛选", Opacity = 0.6, FontSize = 11.5, Margin = new Thickness(0, 0, 0, 4) });
            _search.SetResourceReference(Control.BackgroundProperty, "BgTop");
            _search.SetResourceReference(Control.BorderBrushProperty, "Line");
            _search.TextChanged += (_, __) => RenderList();
            filterBox.Children.Add(_search);
            left.Children.Add(filterBox);
            _list.SelectionChanged += (_, __) => RenderDetail();
            _list.SetValue(ScrollViewer.HorizontalScrollBarVisibilityProperty, ScrollBarVisibility.Disabled);
            var listScroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
            listScroll.Content = _list;
            Grid.SetRow(listScroll, 1);
            left.Children.Add(listScroll);
            body.Children.Add(left);

            var splitter = new GridSplitter
            {
                Width = 6, HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Stretch,
                ResizeBehavior = GridResizeBehavior.PreviousAndNext, Background = Brushes.Transparent
            };
            Grid.SetColumn(splitter, 1);
            body.Children.Add(splitter);

            var right = new Grid { Margin = new Thickness(10, 0, 0, 0), MinWidth = 380 };
            right.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            right.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            right.Children.Add(BuildOpsCard());
            Grid.SetRow(_detail, 1);
            var detailScroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
            detailScroll.Content = _detail;
            Grid.SetRow(detailScroll, 1);
            right.Children.Add(detailScroll);
            Grid.SetColumn(right, 2);
            body.Children.Add(right);

            // ── 底部输出（可拖高）──────────────────────────────────
            var outputWrap = new Grid { Margin = new Thickness(16, 8, 16, 14) };
            outputWrap.RowDefinitions.Add(new RowDefinition { Height = new GridLength(4) });
            outputWrap.RowDefinitions.Add(new RowDefinition { Height = new GridLength(0.34, GridUnitType.Star) });
            var outSplit = new GridSplitter { Height = 4, HorizontalAlignment = HorizontalAlignment.Stretch, Background = Brushes.Transparent };
            outputWrap.Children.Add(outSplit);
            var outBorder = new Border { CornerRadius = new CornerRadius(8), Padding = new Thickness(8) };
            outBorder.SetResourceReference(Border.BackgroundProperty, "BgTop");
            outBorder.SetResourceReference(Border.BorderBrushProperty, "Line");
            outBorder.BorderThickness = new Thickness(1);
            var outStack = new StackPanel();
            outStack.Children.Add(_status);
            outStack.Children.Add(_output);
            outBorder.Child = outStack;
            Grid.SetRow(outBorder, 1);
            outputWrap.Children.Add(outBorder);

            var root = new Grid();
            root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(0.42, GridUnitType.Star), MinHeight = 90 });
            root.Children.Add(header);
            Grid.SetRow(body, 1);
            root.Children.Add(body);
            Grid.SetRow(outputWrap, 2);
            root.Children.Add(outputWrap);

            Content = root;
            Loaded += async (_, __) => { Activate(); await LoadCatalog(); await LoadOps(); };
        }

        private Border BuildOpsCard()
        {
            var card = new Border { Padding = new Thickness(12), Margin = new Thickness(0, 0, 0, 10), CornerRadius = new CornerRadius(8) };
            card.SetResourceReference(Border.BackgroundProperty, "BgTop");
            card.SetResourceReference(Border.BorderBrushProperty, "Line");
            card.BorderThickness = new Thickness(1);
            var stack = new StackPanel();
            stack.Children.Add(new TextBlock { Text = "写操作开关（默认关）", FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 0, 0, 8) });
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
                    RenderList();
                    _status.Text = "已连接内核 · " + DateTime.Now.ToString("HH:mm:ss");
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

        private void RenderList()
        {
            _list.Items.Clear();
            if (_catalog == null) return;
            var q = _search.Text.Trim();
            foreach (var p in _catalog.RootElement.GetProperty("plugins").EnumerateArray())
            {
                var name = p.GetProperty("name").GetString() ?? "";
                var desc = p.GetProperty("desc").GetString() ?? "";
                if (q.Length > 0 && !(name.Contains(q, StringComparison.OrdinalIgnoreCase) || desc.Contains(q, StringComparison.OrdinalIgnoreCase))) continue;
                var status = p.GetProperty("status").GetString() ?? "";
                var card = new Border { Padding = new Thickness(10, 8, 10, 8), Margin = new Thickness(0, 0, 6, 6), CornerRadius = new CornerRadius(8), HorizontalAlignment = HorizontalAlignment.Stretch };
                card.SetResourceReference(Border.BackgroundProperty, "BgTop");
                card.SetResourceReference(Border.BorderBrushProperty, "Line");
                card.BorderThickness = new Thickness(1);
                var stack = new StackPanel();
                var head = new StackPanel { Orientation = Orientation.Horizontal };
                head.Children.Add(new TextBlock { Text = name, FontWeight = FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap });
                head.Children.Add(new TextBlock { Text = "  " + StatusText(status), Opacity = 0.6, FontSize = 11 });
                stack.Children.Add(head);
                stack.Children.Add(new TextBlock { Text = desc, TextWrapping = TextWrapping.Wrap, Opacity = 0.7, FontSize = 11.5, Margin = new Thickness(0, 4, 0, 0) });
                card.Child = stack;
                var item = new ListBoxItem { Content = card, Tag = p, Padding = new Thickness(0), Background = Brushes.Transparent, HorizontalContentAlignment = HorizontalAlignment.Stretch };
                _list.Items.Add(item);
            }
            if (_list.Items.Count == 0)
            {
                var empty = new Border { Padding = new Thickness(12), Margin = new Thickness(0, 6, 6, 0), CornerRadius = new CornerRadius(8) };
                empty.SetResourceReference(Border.BackgroundProperty, "BgTop");
                empty.SetResourceReference(Border.BorderBrushProperty, "Line");
                empty.BorderThickness = new Thickness(1);
                empty.Child = new TextBlock { Text = "还没有插件条目：内核没起来时会这样。先点主窗口右上角「启动」。", TextWrapping = TextWrapping.Wrap, Opacity = 0.7 };
                _list.Items.Add(new ListBoxItem { Content = empty, Background = Brushes.Transparent, HorizontalContentAlignment = HorizontalAlignment.Stretch });
            }
            if (_list.Items.Count > 0 && _catalog != null) _list.SelectedIndex = 0;
        }

        private static string StatusText(string s) => s switch
        {
            "ready" => "● 就绪",
            "bridge" => "● 桥接",
            "missing" => "○ 缺文件",
            _ => "○ " + s
        };

        private void RenderDetail()
        {
            _detail.Children.Clear();
            if (_list.SelectedItem is not ListBoxItem item || item.Tag is not JsonElement plugin) return;
            var head = new StackPanel { Orientation = Orientation.Horizontal };
            head.Children.Add(new TextBlock
            {
                Text = (plugin.GetProperty("name").GetString() ?? "") + "  v" + (plugin.TryGetProperty("version", out var v) ? v.GetString() : ""),
                FontSize = 17, FontWeight = FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap
            });
            _detail.Children.Add(head);
            _detail.Children.Add(new TextBlock { Text = plugin.GetProperty("desc").GetString() ?? "", TextWrapping = TextWrapping.Wrap, Opacity = 0.75, Margin = new Thickness(0, 6, 0, 12) });
            var wrap = new WrapPanel();
            foreach (var panel in plugin.GetProperty("panels").EnumerateArray())
            {
                var btn = new Button { Content = panel.GetProperty("title").GetString() ?? "面板", Margin = new Thickness(0, 0, 8, 8), Padding = new Thickness(12, 7, 12, 7) };
                btn.SetResourceReference(StyleProperty, "Primary");
                btn.Click += async (_, __) => await RunPanel(panel);
                wrap.Children.Add(btn);
            }
            _detail.Children.Add(wrap);
        }

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
            for (var attempt = 0; attempt < 10; attempt++)
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
                _opsLoaded = true;
                SyncOpsEnabled();
                    _opsStatus.Text = "现在：写操作" + (_opsEnable.IsChecked == true ? "开" : "关") + "，保存后 sidecar 下次启动生效";
                    return;
                }
                catch (Exception ex)
                {
                    await Task.Delay(800);
                    if (attempt == 9) _opsStatus.Text = "读开关失败：" + ex.Message;
                }
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
