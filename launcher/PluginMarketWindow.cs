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
    /// 插件市场：把已经装到她身上的插件列成一张张卡片，点插件在右边展开面板，
    /// 每个面板就是一个按钮；点按钮就地执行（抖音走 sidecar，抓取/状态走内核 HTTP）。
    /// 只读入口为主，写操作（点赞/收藏）仍由 sidecar 的 enableOps 门控，这里不越权。
    /// </summary>
    public sealed class PluginMarketWindow : Window
    {
        private const string KernelBase = "http://127.0.0.1:8787";
        private readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromMinutes(4) };
        private readonly ListBox _list = new ListBox { Width = 250, Background = Brushes.Transparent, BorderThickness = new Thickness(0) };
        private readonly StackPanel _detail = new StackPanel();
        private readonly TextBox _search = new TextBox { Height = 30, Margin = new Thickness(0, 0, 0, 10) };
        private readonly TextBox _output = new TextBox
        {
            IsReadOnly = true, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Height = 190,
            Margin = new Thickness(0, 12, 0, 0), FontFamily = new FontFamily("Consolas")
        };
        private readonly TextBlock _status = new TextBlock { Margin = new Thickness(0, 8, 0, 0) };
        private readonly string _token;
        private JsonDocument _catalog;

        public PluginMarketWindow(Window owner)
        {
            Owner = owner;
            Title = "插件市场 · 鲸鲸";
            Width = 1000; Height = 680; WindowStartupLocation = WindowStartupLocation.CenterOwner;
            Topmost = true; ShowInTaskbar = false;
            SetResourceReference(BackgroundProperty, "Bg");
            SetResourceReference(ForegroundProperty, "Text");
            FontSize = 12.5;
            _token = ReadToken();

            var root = new DockPanel { Margin = new Thickness(16) };
            var head = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 12) };
            head.Children.Add(new TextBlock { Text = "插件市场", FontSize = 19, FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center });
            head.Children.Add(new TextBlock { Text = "已安装的插件都在这里，点卡片看面板", Margin = new Thickness(12, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center, Opacity = 0.65 });
            DockPanel.SetDock(head, Dock.Top);
            root.Children.Add(head);

            _search.SetResourceReference(Control.BackgroundProperty, "BgTop");
            _search.SetResourceReference(Control.BorderBrushProperty, "Line");
            _search.TextChanged += (_, __) => RenderList();
            var searchWrap = new StackPanel { Margin = new Thickness(0, 0, 0, 8) };
            searchWrap.Children.Add(new TextBlock { Text = "筛选", Opacity = 0.6, Margin = new Thickness(0, 0, 0, 4) });
            searchWrap.Children.Add(_search);
            root.Children.Add(searchWrap);

            var body = new Grid();
            body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(270) });
            body.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            _list.SelectionChanged += (_, __) => RenderDetail();
            body.Children.Add(_list);

            var right = new Grid { Margin = new Thickness(16, 0, 0, 0) };
            right.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            right.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Auto) });
            var scroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
            scroll.Content = _detail;
            Grid.SetRow(scroll, 0);
            right.Children.Add(scroll);
            var bottom = new StackPanel();
            bottom.Children.Add(_status);
            bottom.Children.Add(_output);
            Grid.SetRow(bottom, 1);
            right.Children.Add(bottom);
            Grid.SetColumn(right, 1);
            body.Children.Add(right);
            root.Children.Add(body);

            Content = root;
            Loaded += async (_, __) => { Activate(); await LoadCatalog(); };
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
                        _output.Text = "内核没连上：" + ex.Message + "\n先点主窗口右下角「启动」，再打开插件市场。";
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
                var card = new Border { Padding = new Thickness(10, 8, 10, 8), Margin = new Thickness(0, 0, 0, 6), CornerRadius = new CornerRadius(8) };
                card.SetResourceReference(Border.BackgroundProperty, "BgTop");
                card.SetResourceReference(Border.BorderBrushProperty, "Line");
                card.BorderThickness = new Thickness(1);
                var stack = new StackPanel();
                var head = new StackPanel { Orientation = Orientation.Horizontal };
                head.Children.Add(new TextBlock { Text = name, FontWeight = FontWeights.SemiBold });
                head.Children.Add(new TextBlock { Text = "  " + StatusText(status), Opacity = 0.6, FontSize = 11 });
                stack.Children.Add(head);
                stack.Children.Add(new TextBlock { Text = desc, TextWrapping = TextWrapping.Wrap, Opacity = 0.7, FontSize = 11.5, Margin = new Thickness(0, 4, 0, 0) });
                card.Child = stack;
                var item = new ListBoxItem { Content = card, Tag = p };
                item.Padding = new Thickness(0);
                item.Background = Brushes.Transparent;
                item.HorizontalContentAlignment = HorizontalAlignment.Stretch;
                _list.Items.Add(item);
            }
            if (_list.Items.Count == 0)
            {
                var empty = new Border { Padding = new Thickness(12), Margin = new Thickness(0, 6, 0, 0), CornerRadius = new CornerRadius(8) };
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
            var title = new TextBlock
            {
                Text = (plugin.GetProperty("name").GetString() ?? "") + "  v" + (plugin.TryGetProperty("version", out var v) ? v.GetString() : ""),
                FontSize = 18, FontWeight = FontWeights.SemiBold
            };
            _detail.Children.Add(title);
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
                    return;
                }
                if (string.IsNullOrEmpty(_token) && (kind == "douyin" || kind == "http"))
                {
                    _output.Text = "没读到内核 token（data/config.json），先启动一次内核。";
                    return;
                }
                JsonObjectLite body = new JsonObjectLite();
                if (panel.TryGetProperty("args", out var args) && args.ValueKind == JsonValueKind.Object)
                    body.MergeJson(args);
                if (panel.TryGetProperty("input", out var input) && input.TryGetProperty("field", out var fieldEl))
                {
                    var field = fieldEl.GetString() ?? "";
                    var hint = input.TryGetProperty("hint", out var h) ? h.GetString() : field;
                    var value = PromptInput(panel.GetProperty("title").GetString() ?? "输入", hint ?? field, body.GetString(field));
                    if (value == null) return;
                    body.Set(field, value);
                }
                if (panel.TryGetProperty("body", out var extra) && extra.ValueKind == JsonValueKind.Object)
                    body.MergeJson(extra);

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
                Owner = this, Title = title, Width = 520, Height = 160,
                WindowStartupLocation = WindowStartupLocation.CenterOwner, ResizeMode = ResizeMode.NoResize
            };
            win.SetResourceReference(BackgroundProperty, "Bg");
            win.SetResourceReference(ForegroundProperty, "Text");
            var box = new TextBox { Text = current ?? "", Height = 30, Margin = new Thickness(16, 16, 16, 8) };
            box.SetResourceReference(Control.BackgroundProperty, "BgTop");
            box.SetResourceReference(Control.BorderBrushProperty, "Line");
            var tip = new TextBlock { Text = hint, Margin = new Thickness(16, 0, 16, 8), Opacity = 0.65 };
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

        /// <summary>极小的 JSON 构造器，避免依赖 Newtonsoft。</summary>
        private sealed class JsonObjectLite
        {
            private readonly Dictionary<string, JsonElement> _items = new();

            public void Set(string key, string value)
            {
                using var doc = JsonDocument.Parse(JsonSerializer.Serialize(value));
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
                    foreach (var kv in _items)
                    {
                        w.WritePropertyName(kv.Key);
                        kv.Value.WriteTo(w);
                    }
                    w.WriteEndObject();
                }
                return Encoding.UTF8.GetString(ms.ToArray());
            }
        }
    }
}
