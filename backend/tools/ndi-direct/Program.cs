using System.Buffers.Binary;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

static class Program
{
    static int Main(string[] args)
    {
        var options = Args.Parse(args);
        try
        {
            var runtimeDll = options.Get("runtimeDll");
            if (string.IsNullOrWhiteSpace(runtimeDll) || !File.Exists(runtimeDll))
            {
                Console.Error.WriteLine("Missing --runtimeDll path.");
                return 2;
            }

            Ndi.Configure(runtimeDll);
            if (!Ndi.Initialize())
            {
                Console.Error.WriteLine("NDI runtime failed to initialize.");
                return 3;
            }

            try
            {
                var command = args.FirstOrDefault(a => !a.StartsWith("--", StringComparison.Ordinal)) ?? "list";
                return command switch
                {
                    "list" => ListSources(options),
                    "capture" => CaptureLoop(options),
                    "stream" => StreamLoop(options),
                    _ => Fail($"Unknown command: {command}", 2),
                };
            }
            finally
            {
                Ndi.Destroy();
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.ToString());
            return 1;
        }
    }

    static int ListSources(Args options)
    {
        var timeoutMs = options.GetInt("timeoutMs", 2500);
        var sources = Ndi.FindSources(timeoutMs);
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            ok = true,
            sources,
        }));
        return 0;
    }

    static int CaptureLoop(Args options)
    {
        var sourceName = options.Get("sourceName");
        var output = options.Get("output");
        var status = options.Get("status");
        if (string.IsNullOrWhiteSpace(sourceName)) return Fail("Missing --sourceName.", 2);
        if (string.IsNullOrWhiteSpace(output)) return Fail("Missing --output.", 2);
        if (string.IsNullOrWhiteSpace(status)) return Fail("Missing --status.", 2);

        Directory.CreateDirectory(Path.GetDirectoryName(output)!);
        Directory.CreateDirectory(Path.GetDirectoryName(status)!);

        var timeoutMs = options.GetInt("timeoutMs", 5000);
        var maxFps = Math.Clamp(options.GetInt("maxFps", 30), 1, 60);
        var frameDelayMs = Math.Max(1, 1000 / maxFps);
        var sources = Ndi.FindSources(timeoutMs);
        var sourceUrl = options.Get("sourceUrl");
        var source = sources.FirstOrDefault(item =>
            string.Equals(item.name, sourceName, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(item.id, sourceName, StringComparison.OrdinalIgnoreCase));
        if (source is null)
        {
            source = new NdiSource(sourceName, sourceName, string.IsNullOrWhiteSpace(sourceUrl) ? null : sourceUrl);
            WriteStatus(status, new { ok = true, connected = false, source = source.name, width = 0, height = 0, frames = 0, lastFrameAt = (string?)null, warning = "Source was not discovered; trying direct NDI receiver connect by name." });
        }

        using var receiver = NdiReceiver.Connect(source);
        var frames = 0L;
        var lastWrite = DateTimeOffset.UtcNow;
        var lastStatusWrite = DateTimeOffset.MinValue;
        var hasReceivedFrame = false;
        WriteStatus(status, new { ok = true, connected = true, source = source.name, width = 0, height = 0, frames, lastFrameAt = (string?)null });

        while (true)
        {
            var started = Stopwatch.GetTimestamp();
            if (receiver.CaptureRgba(timeoutMs: 1000) is { } frame)
            {
                frames++;
                hasReceivedFrame = true;
                AtomicWrite(output, frame.Rgba);
                lastWrite = DateTimeOffset.UtcNow;
                if ((lastWrite - lastStatusWrite).TotalMilliseconds >= 250)
                {
                    lastStatusWrite = lastWrite;
                    WriteStatus(status, new
                    {
                        ok = true,
                        connected = true,
                        source = source.name,
                        frame.Width,
                        frame.Height,
                        frame.Aspect,
                        frame.FourCc,
                        frame.FourCcText,
                        frame.FrameRateN,
                        frame.FrameRateD,
                        format = "rgba",
                        stride = frame.Width * 4,
                        byteLength = frame.Rgba.Length,
                        frames,
                        lastFrameAt = lastWrite.ToString("O"),
                    });
                }
            }
            else if (!hasReceivedFrame && (DateTimeOffset.UtcNow - lastWrite).TotalSeconds > 3)
            {
                WriteStatus(status, new { ok = true, connected = false, source = source.name, width = 0, height = 0, frames, lastFrameAt = lastWrite.ToString("O"), error = "Waiting for NDI video frames." });
            }
            SleepRemainingFrameBudget(started, frameDelayMs);
        }
    }

    static int StreamLoop(Args options)
    {
        var sourceName = options.Get("sourceName");
        if (string.IsNullOrWhiteSpace(sourceName)) return Fail("Missing --sourceName.", 2);

        var timeoutMs = options.GetInt("timeoutMs", 3000);
        var maxFps = Math.Clamp(options.GetInt("maxFps", 30), 1, 120);
        var frameDelayMs = Math.Max(1, 1000 / maxFps);
        var sources = Ndi.FindSources(timeoutMs);
        var sourceUrl = options.Get("sourceUrl");
        var source = sources.FirstOrDefault(item =>
            string.Equals(item.name, sourceName, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(item.id, sourceName, StringComparison.OrdinalIgnoreCase));
        if (source is null)
        {
            source = new NdiSource(sourceName, sourceName, string.IsNullOrWhiteSpace(sourceUrl) ? null : sourceUrl);
            Console.Error.WriteLine(JsonSerializer.Serialize(new { ok = true, connected = false, source = source.name, warning = "Source was not discovered; trying direct NDI receiver connect by name." }));
        }

        using var receiver = NdiReceiver.Connect(source);
        using var output = Console.OpenStandardOutput();
        var frames = 0L;
        Console.Error.WriteLine(JsonSerializer.Serialize(new { ok = true, connected = true, source = source.name, stream = "rgba" }));

        while (true)
        {
            var started = Stopwatch.GetTimestamp();
            if (receiver.CaptureRgba(timeoutMs: 1000) is { } frame)
            {
                frames++;
                WriteStreamFrame(output, frame, frames);
            }
            SleepRemainingFrameBudget(started, frameDelayMs);
        }
    }

    static void SleepRemainingFrameBudget(long startedTimestamp, int frameDelayMs)
    {
        var elapsedMs = (Stopwatch.GetTimestamp() - startedTimestamp) * 1000.0 / Stopwatch.Frequency;
        var remainingMs = frameDelayMs - elapsedMs;
        if (remainingMs > 1) Thread.Sleep((int)remainingMs);
    }

    static void WriteStreamFrame(Stream output, NdiFrame frame, long frames)
    {
        Span<byte> header = stackalloc byte[32];
        header[0] = (byte)'N';
        header[1] = (byte)'D';
        header[2] = (byte)'I';
        header[3] = (byte)'R';
        BinaryPrimitives.WriteInt32LittleEndian(header[4..], frame.Width);
        BinaryPrimitives.WriteInt32LittleEndian(header[8..], frame.Height);
        BinaryPrimitives.WriteInt32LittleEndian(header[12..], frame.Rgba.Length);
        BinaryPrimitives.WriteInt32LittleEndian(header[16..], frame.FrameRateN);
        BinaryPrimitives.WriteInt32LittleEndian(header[20..], frame.FrameRateD);
        BinaryPrimitives.WriteUInt32LittleEndian(header[24..], frame.FourCc);
        BinaryPrimitives.WriteInt32LittleEndian(header[28..], unchecked((int)(frames & 0x7fffffff)));
        output.Write(header);
        output.Write(frame.Rgba);
        output.Flush();
    }

    static void AtomicWrite(string path, byte[] bytes)
    {
        var temp = $"{path}.{Environment.ProcessId}.tmp";
        File.WriteAllBytes(temp, bytes);
        if (File.Exists(path))
        {
            File.Replace(temp, path, null, ignoreMetadataErrors: true);
        }
        else
        {
            File.Move(temp, path, overwrite: true);
        }
    }

    static void WriteStatus(string path, object payload)
    {
        AtomicWrite(path, JsonSerializer.SerializeToUtf8Bytes(payload));
    }

    static int Fail(string message, int code)
    {
        Console.Error.WriteLine(message);
        return code;
    }
}

sealed record NdiSource(string id, string name, string? url);

sealed class Args
{
    readonly Dictionary<string, string> values = new(StringComparer.OrdinalIgnoreCase);

    public static Args Parse(string[] args)
    {
        var parsed = new Args();
        for (var i = 0; i < args.Length; i++)
        {
            var arg = args[i];
            if (!arg.StartsWith("--", StringComparison.Ordinal)) continue;
            var key = arg[2..];
            var value = i + 1 < args.Length && !args[i + 1].StartsWith("--", StringComparison.Ordinal) ? args[++i] : "true";
            parsed.values[key] = value;
        }
        return parsed;
    }

    public string Get(string key, string fallback = "") => values.TryGetValue(key, out var value) ? value : fallback;
    public int GetInt(string key, int fallback) => int.TryParse(Get(key), out var value) ? value : fallback;
}

sealed class NdiReceiver : IDisposable
{
    readonly IntPtr receiver;
    readonly IntPtr sourceNamePtr;
    readonly IntPtr sourceUrlPtr;
    readonly IntPtr receiverNamePtr;
    bool disposed;

    NdiReceiver(IntPtr receiver, IntPtr sourceNamePtr, IntPtr sourceUrlPtr, IntPtr receiverNamePtr)
    {
        this.receiver = receiver;
        this.sourceNamePtr = sourceNamePtr;
        this.sourceUrlPtr = sourceUrlPtr;
        this.receiverNamePtr = receiverNamePtr;
    }

    public static NdiReceiver Connect(NdiSource source)
    {
        var namePtr = Marshal.StringToHGlobalAnsi(source.name);
        var urlPtr = source.url is null ? IntPtr.Zero : Marshal.StringToHGlobalAnsi(source.url);
        var sourceStruct = new Ndi.Source { p_ndi_name = namePtr, p_url_address = urlPtr };
        var receiverNamePtr = Marshal.StringToHGlobalAnsi("MLBB Co-Pilot Direct NDI");
        var create = new Ndi.RecvCreate
        {
            source_to_connect_to = sourceStruct,
            color_format = Ndi.RecvColorFormat.RGBX_RGBA,
            bandwidth = Ndi.RecvBandwidth.Highest,
            allow_video_fields = false,
            p_ndi_recv_name = receiverNamePtr,
        };
        var createPtr = Marshal.AllocHGlobal(Marshal.SizeOf<Ndi.RecvCreate>());
        var receiver = IntPtr.Zero;
        try
        {
            Marshal.StructureToPtr(create, createPtr, false);
            receiver = Ndi.RecvCreateV3(createPtr);
            if (receiver == IntPtr.Zero) throw new InvalidOperationException("Could not create NDI receiver.");
            Ndi.RecvConnect(receiver, ref sourceStruct);
            return new NdiReceiver(receiver, namePtr, urlPtr, receiverNamePtr);
        }
        catch
        {
            if (receiver != IntPtr.Zero) Ndi.RecvDestroy(receiver);
            Marshal.FreeHGlobal(namePtr);
            if (urlPtr != IntPtr.Zero) Marshal.FreeHGlobal(urlPtr);
            Marshal.FreeHGlobal(receiverNamePtr);
            throw;
        }
        finally
        {
            Marshal.FreeHGlobal(createPtr);
        }
    }

    public NdiFrame? CaptureRgba(uint timeoutMs)
    {
        var video = new Ndi.VideoFrame();
        var type = Ndi.RecvCaptureV3(receiver, ref video, IntPtr.Zero, IntPtr.Zero, timeoutMs);
        if (type != Ndi.FrameType.Video || video.p_data == IntPtr.Zero || video.xres <= 0 || video.yres <= 0) return null;
        try
        {
            var rgba = Rgba.FromNdiFrame(video.p_data, video.xres, video.yres, video.line_stride_in_bytes, video.FourCC);
            return new NdiFrame(rgba, video.xres, video.yres, video.picture_aspect_ratio, video.FourCC, FourCc.ToText(video.FourCC), video.frame_rate_N, video.frame_rate_D);
        }
        finally
        {
            Ndi.RecvFreeVideoV2(receiver, ref video);
        }
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        if (receiver != IntPtr.Zero) Ndi.RecvDestroy(receiver);
        if (sourceNamePtr != IntPtr.Zero) Marshal.FreeHGlobal(sourceNamePtr);
        if (sourceUrlPtr != IntPtr.Zero) Marshal.FreeHGlobal(sourceUrlPtr);
        if (receiverNamePtr != IntPtr.Zero) Marshal.FreeHGlobal(receiverNamePtr);
    }
}

sealed record NdiFrame(byte[] Rgba, int Width, int Height, float Aspect, uint FourCc, string FourCcText, int FrameRateN, int FrameRateD);

static class FourCc
{
    public static string ToText(uint fourCc)
    {
        var bytes = BitConverter.GetBytes(fourCc);
        return Encoding.ASCII.GetString(bytes).TrimEnd('\0', ' ');
    }
}

static class Rgba
{
    public static byte[] FromNdiFrame(IntPtr data, int width, int height, int stride, uint fourCc)
    {
        var rowBytes = checked(width * 4);
        var bytes = new byte[checked(rowBytes * height)];
        var fourCcText = FourCc.ToText(fourCc);

        if (string.Equals(fourCcText, "RGBA", StringComparison.Ordinal))
        {
            CopyRows(data, width, height, stride, bytes, setAlpha: false);
        }
        else if (string.Equals(fourCcText, "RGBX", StringComparison.Ordinal))
        {
            CopyRows(data, width, height, stride, bytes, setAlpha: true);
        }
        else if (string.Equals(fourCcText, "BGRA", StringComparison.Ordinal) || string.Equals(fourCcText, "BGRX", StringComparison.Ordinal))
        {
            WriteBgraRows(data, width, height, stride, bytes);
        }
        else if (string.Equals(fourCcText, "UYVY", StringComparison.Ordinal) || Math.Abs(stride) < rowBytes)
        {
            WriteUyvyRows(data, width, height, stride, bytes);
        }
        else
        {
            CopyRows(data, width, height, stride, bytes, setAlpha: true);
        }

        return bytes;
    }

    static void CopyRows(IntPtr data, int width, int height, int stride, byte[] output, bool setAlpha)
    {
        var rowBytes = width * 4;
        for (var y = 0; y < height; y++)
        {
            Marshal.Copy(IntPtr.Add(data, y * stride), output, y * rowBytes, rowBytes);
            if (!setAlpha) continue;
            var rowStart = y * rowBytes;
            for (var x = 0; x < width; x++) output[rowStart + x * 4 + 3] = 255;
        }
    }

    static void WriteBgraRows(IntPtr data, int width, int height, int stride, byte[] output)
    {
        var inputRowBytes = Math.Abs(stride);
        var rowBytes = width * 4;
        var row = new byte[inputRowBytes];
        for (var y = 0; y < height; y++)
        {
            Marshal.Copy(IntPtr.Add(data, y * stride), row, 0, inputRowBytes);
            var outIndex = y * rowBytes;
            for (var x = 0; x < width; x++)
            {
                var sourceIndex = x * 4;
                var targetIndex = outIndex + sourceIndex;
                output[targetIndex] = row[sourceIndex + 2];
                output[targetIndex + 1] = row[sourceIndex + 1];
                output[targetIndex + 2] = row[sourceIndex];
                output[targetIndex + 3] = 255;
            }
        }
    }

    static void WriteUyvyRows(IntPtr data, int width, int height, int stride, byte[] output)
    {
        var inputRowBytes = Math.Abs(stride);
        var row = new byte[inputRowBytes];
        for (var y = 0; y < height; y++)
        {
            Marshal.Copy(IntPtr.Add(data, y * stride), row, 0, inputRowBytes);
            var outIndex = y * width * 4;
            for (var x = 0; x < width; x += 2)
            {
                var sourceIndex = x * 2;
                if (sourceIndex + 3 >= row.Length) break;
                var u = row[sourceIndex + 0];
                var y0 = row[sourceIndex + 1];
                var v = row[sourceIndex + 2];
                var y1 = row[sourceIndex + 3];
                WriteRgb(output, outIndex + x * 4, y0, u, v);
                if (x + 1 < width) WriteRgb(output, outIndex + (x + 1) * 4, y1, u, v);
            }
        }
    }

    static void WriteRgb(byte[] output, int index, byte y, byte u, byte v)
    {
        var c = Math.Max(0, y - 16);
        var d = u - 128;
        var e = v - 128;
        output[index + 0] = Clamp((298 * c + 409 * e + 128) >> 8);
        output[index + 1] = Clamp((298 * c - 100 * d - 208 * e + 128) >> 8);
        output[index + 2] = Clamp((298 * c + 516 * d + 128) >> 8);
        output[index + 3] = 255;
    }

    static byte Clamp(int value) => (byte)Math.Min(255, Math.Max(0, value));
}

static class Bmp
{
    public static byte[] FromNdiFrame(IntPtr data, int width, int height, int stride, uint fourCc)
    {
        var rowBytes = checked(width * 4);
        var pixelBytes = checked(rowBytes * height);
        var bytes = new byte[54 + pixelBytes];

        bytes[0] = (byte)'B';
        bytes[1] = (byte)'M';
        BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(2), bytes.Length);
        BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(10), 54);
        BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(14), 40);
        BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(18), width);
        BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(22), -height);
        BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(26), 1);
        BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(28), 32);
        BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(34), pixelBytes);

        var strideAbs = Math.Abs(stride);
        if (IsUyvy(fourCc) || strideAbs < rowBytes)
        {
            WriteUyvyRows(data, width, height, stride, bytes, 54);
        }
        else
        {
            for (var y = 0; y < height; y++)
            {
                var source = IntPtr.Add(data, y * stride);
                Marshal.Copy(source, bytes, 54 + y * rowBytes, rowBytes);
            }
        }

        return bytes;
    }

    static bool IsUyvy(uint fourCc)
    {
        var text = Encoding.ASCII.GetString(BitConverter.GetBytes(fourCc));
        return string.Equals(text, "UYVY", StringComparison.Ordinal);
    }

    static void WriteUyvyRows(IntPtr data, int width, int height, int stride, byte[] output, int outputOffset)
    {
        var inputRowBytes = Math.Abs(stride);
        var row = new byte[inputRowBytes];
        for (var y = 0; y < height; y++)
        {
            Marshal.Copy(IntPtr.Add(data, y * stride), row, 0, inputRowBytes);
            var outIndex = outputOffset + y * width * 4;
            for (var x = 0; x < width; x += 2)
            {
                var sourceIndex = x * 2;
                if (sourceIndex + 3 >= row.Length) break;
                var u = row[sourceIndex + 0];
                var y0 = row[sourceIndex + 1];
                var v = row[sourceIndex + 2];
                var y1 = row[sourceIndex + 3];
                WriteBgrx(output, outIndex + x * 4, y0, u, v);
                if (x + 1 < width) WriteBgrx(output, outIndex + (x + 1) * 4, y1, u, v);
            }
        }
    }

    static void WriteBgrx(byte[] output, int index, byte y, byte u, byte v)
    {
        var c = Math.Max(0, y - 16);
        var d = u - 128;
        var e = v - 128;
        output[index + 2] = Clamp((298 * c + 409 * e + 128) >> 8);
        output[index + 1] = Clamp((298 * c - 100 * d - 208 * e + 128) >> 8);
        output[index + 0] = Clamp((298 * c + 516 * d + 128) >> 8);
        output[index + 3] = 255;
    }

    static byte Clamp(int value) => (byte)Math.Min(255, Math.Max(0, value));
}

static class Ndi
{
    const string Library = "Processing.NDI.Lib.x64";
    static string runtimeDll = "";

    public static void Configure(string dllPath)
    {
        runtimeDll = dllPath;
        NativeLibrary.SetDllImportResolver(typeof(Ndi).Assembly, (libraryName, _, _) =>
            libraryName == Library ? NativeLibrary.Load(runtimeDll) : IntPtr.Zero);
    }

    public static List<NdiSource> FindSources(int timeoutMs)
    {
        var finder = FindCreateV2(IntPtr.Zero);
        if (finder == IntPtr.Zero) throw new InvalidOperationException("Could not create NDI finder.");
        try
        {
            var deadline = DateTimeOffset.UtcNow.AddMilliseconds(Math.Max(100, timeoutMs));
            var sources = CurrentSources(finder);
            while (sources.Count == 0 && DateTimeOffset.UtcNow < deadline)
            {
                var remaining = Math.Max(100, (int)(deadline - DateTimeOffset.UtcNow).TotalMilliseconds);
                FindWaitForSources(finder, (uint)Math.Min(500, remaining));
                sources = CurrentSources(finder);
            }
            return sources;
        }
        finally
        {
            FindDestroy(finder);
        }
    }

    static List<NdiSource> CurrentSources(IntPtr finder)
    {
        uint count = 0;
        var sourcesPtr = FindGetCurrentSources(finder, ref count);
        var sources = new List<NdiSource>();
        var size = Marshal.SizeOf<Source>();
        for (var i = 0; i < count; i++)
        {
            var item = Marshal.PtrToStructure<Source>(IntPtr.Add(sourcesPtr, i * size));
            var name = Marshal.PtrToStringAnsi(item.p_ndi_name) ?? "";
            var url = item.p_url_address == IntPtr.Zero ? null : Marshal.PtrToStringAnsi(item.p_url_address);
            if (name.Length > 0) sources.Add(new NdiSource(name, name, url));
        }
        return sources;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct Source
    {
        public IntPtr p_ndi_name;
        public IntPtr p_url_address;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct FindCreate
    {
        [MarshalAs(UnmanagedType.I1)]
        public bool show_local_sources;
        public IntPtr p_groups;
        public IntPtr p_extra_ips;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RecvCreate
    {
        public Source source_to_connect_to;
        public RecvColorFormat color_format;
        public RecvBandwidth bandwidth;
        [MarshalAs(UnmanagedType.I1)]
        public bool allow_video_fields;
        public IntPtr p_ndi_recv_name;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MetadataFrame
    {
        public int length;
        public long timecode;
        public IntPtr p_data;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct VideoFrame
    {
        public int xres;
        public int yres;
        public uint FourCC;
        public int frame_rate_N;
        public int frame_rate_D;
        public float picture_aspect_ratio;
        public int frame_format_type;
        public long timecode;
        public IntPtr p_data;
        public int line_stride_in_bytes;
        public MetadataFrame metadata;
        public long timestamp;
    }

    public enum RecvColorFormat
    {
        BGRX_BGRA = 0,
        UYVY_BGRA = 1,
        RGBX_RGBA = 2,
        UYVY_RGBA = 3,
        Fastest = 100,
        Best = 101,
    }

    public enum RecvBandwidth
    {
        MetadataOnly = -10,
        AudioOnly = 10,
        Lowest = 0,
        Highest = 100,
    }

    public enum FrameType
    {
        None = 0,
        Video = 1,
        Audio = 2,
        Metadata = 3,
        Error = 4,
        StatusChange = 100,
    }

    [return: MarshalAs(UnmanagedType.I1)]
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "NDIlib_initialize")]
    public static extern bool Initialize();

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "NDIlib_destroy")]
    public static extern void Destroy();

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "NDIlib_find_create_v2")]
    public static extern IntPtr FindCreateV2(IntPtr create);

    [return: MarshalAs(UnmanagedType.I1)]
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "NDIlib_find_wait_for_sources")]
    public static extern bool FindWaitForSources(IntPtr finder, uint timeoutMs);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "NDIlib_find_get_current_sources")]
    public static extern IntPtr FindGetCurrentSources(IntPtr finder, ref uint count);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "NDIlib_find_destroy")]
    public static extern void FindDestroy(IntPtr finder);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "NDIlib_recv_create_v3")]
    public static extern IntPtr RecvCreateV3(IntPtr create);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "NDIlib_recv_connect")]
    public static extern void RecvConnect(IntPtr receiver, ref Source source);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "NDIlib_recv_capture_v3")]
    public static extern FrameType RecvCaptureV3(IntPtr receiver, ref VideoFrame video, IntPtr audio, IntPtr metadata, uint timeoutMs);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "NDIlib_recv_free_video_v2")]
    public static extern void RecvFreeVideoV2(IntPtr receiver, ref VideoFrame video);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl, EntryPoint = "NDIlib_recv_destroy")]
    public static extern void RecvDestroy(IntPtr receiver);
}
