# Minimal WinRT JS Projection Prototype

This note shows how to stitch together the core building blocks you listed (WinMD parser → JS proxy generator → native bridge → type conversions / async mapping / delegate wiring). Everything below is intentionally scoped to a **single Windows Runtime API** so you can iterate fast and then scale out.

## What's implemented in this repo
- `samples/electron/winrt-projection/tools/winmd-dump`: standalone .NET tool that can refresh the metadata JSON.
- `samples/electron/winrt-projection/addon`: Node-API + C++/WinRT bridge that maps `FileIO.ReadTextAsync` to a JS Promise.
- `samples/electron/winrt-projection/src/winrtProxy.js`: tiny proxy that exposes the WinRT surface to the preload script.
- `samples/electron/src/preload.js` & `samples/electron/src/index.html`: UI + bridge wiring that exercise the projection end-to-end.

Build the native bits with `npm run build-winrt-bridge` (already included in `npm run build-all`).

## 1. WinMD metadata reader (C# → JSON)
A tiny .NET console app can read `Windows.winmd` and dump a JSON description of a handful of types.

```
samples/electron/winrt-projection/tools/winmd-dump/
  WinmdDump.csproj
  Program.cs
```

**WinmdDump.csproj**
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="System.Reflection.Metadata" Version="8.0.0" />
  </ItemGroup>
</Project>
```

**Program.cs** (kept intentionally tiny / single-file)
```csharp
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Text.Json;

if (args.Length < 2)
{
    Console.WriteLine("Usage: WinmdDump <path-to-winmd> <fully.qualified.type> [out.json]");
    return;
}

var winmdPath = args[0];
var typeName = args[1];
var output = args.Length > 2 ? args[2] : "out.json";

using var pe = new PEReader(File.OpenRead(winmdPath));
var reader = pe.GetMetadataReader();

var target = reader.TypeDefinitions
    .Select(handle => reader.GetTypeDefinition(handle))
    .Select(td => (Handle: td, Name: reader.GetString(td.Name), Ns: reader.GetString(td.Namespace)))
    .First(td => $"{td.Ns}.{td.Name}" == typeName);

var methods = new List<object>();
foreach (var methodHandle in target.Handle.GetMethods())
{
    var method = reader.GetMethodDefinition(methodHandle);
    var sig = reader.GetBlobReader(method.Signature);
    methods.Add(new
    {
        name = reader.GetString(method.Name),
        attributes = method.Attributes.ToString(),
        signature = Convert.ToBase64String(sig.ReadBytes(sig.RemainingBytes))
    });
}

var payload = new
{
    type = typeName,
    methods,
    timestamp = DateTimeOffset.UtcNow,
};

File.WriteAllText(output, JsonSerializer.Serialize(payload, new JsonSerializerOptions
{
    WriteIndented = true
}));
Console.WriteLine($"Wrote {output}");
```

Run it directly from the Electron sample:

```pwsh
pwsh -c "cd samples/electron/winrt-projection/tools/winmd-dump; dotnet run -- \"$env:ProgramFiles(x86)\Windows Kits\10\UnionMetadata\10.0.22621.0\Windows.winmd\" Windows.Storage.FileIO ..\..\generated\windows.storage.fileio.json"
```

This JSON is the schema your JS proxy generator consumes. For a "real" projection you would parse the signature blob, but for the prototype you just need the method names to know what to expose.

## 2. Native bridge (Node-API + C++/WinRT)
The bridge converts JS arguments ↔ WinRT ABI types and executes the actual asynchronous operation. A single exported function is enough for a FileIO-only prototype.

```
samples/electron/winrt-projection/addon/
  binding.gyp
  fileio_bridge.cc
```

**binding.gyp**
```json
{
  "targets": [
    {
      "target_name": "winrt_bridge",
      "sources": ["fileio_bridge.cc"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "cflags_cc": ["/std:c++20"],
      "defines": ["WINRT_LEAN_AND_MEAN"],
      "msbuild_settings": {
        "ClCompile": {
          "PrecompiledHeader": "NotUsing"
        }
      }
    }
  ]
}
```

**fileio_bridge.cc**
```cpp
#include <napi.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Storage.h>

using namespace winrt::Windows::Storage;

class ReadTextWorker : public Napi::AsyncWorker {
public:
    ReadTextWorker(std::wstring path, Napi::Promise::Deferred deferred)
        : Napi::AsyncWorker(nullptr), path_(std::move(path)), deferred_(std::move(deferred)) {}

    void Execute() override
    {
        winrt::init_apartment();
        try
        {
            auto file = StorageFile::GetFileFromPathAsync(path_).get();
            auto text = FileIO::ReadTextAsync(file).get();
            result_ = winrt::to_string(text);
        }
        catch (const winrt::hresult_error& ex)
        {
            error_ = Napi::String::New(Env(), winrt::to_string(ex.message()));
        }
    }

    void OnOK() override
    {
        if (!error_.IsEmpty())
        {
            deferred_.Reject(error_);
        }
        else
        {
            deferred_.Resolve(Napi::String::New(Env(), result_));
        }
    }

private:
    std::wstring path_;
    std::string result_;
    Napi::Value error_;
    Napi::Promise::Deferred deferred_;
};

Napi::Value ReadText(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    if (info.Length() != 1 || !info[0].IsString())
    {
        Napi::TypeError::New(env, "Expected single path string").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto path = info[0].As<Napi::String>().Utf16Value();
    auto deferred = Napi::Promise::Deferred::New(env);
    auto* worker = new ReadTextWorker(path, deferred);
    worker->Queue();
    return deferred.Promise();
}

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    winrt::init_apartment();
    exports.Set("readText", Napi::Function::New(env, ReadText));
    return exports;
}

NODE_API_MODULE(winrt_bridge, Init)
```

Install dependencies and build:

```pwsh
cd samples/electron
npm install node-addon-api --save-dev
cd winrt-projection/addon
npm install
node-gyp configure build
```

## 3. JS proxy / type shim
With JSON metadata + the bridge you can emit JS proxies that feel "WinRT-like" while being just thin wrappers over the native addon.

```
samples/electron/winrt-projection/src/winrtProxy.js
```

```js
const path = require('node:path');
const fs = require('node:fs');
const native = require('../addon/build/Release/winrt_bridge.node');

const metadataPath = path.join(__dirname, '..', 'generated', 'windows.storage.fileio.json');
const fileioMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

function createMethodMap(meta, impl) {
  const map = {};
  for (const method of meta.methods) {
    const lower = method.name.charAt(0).toLowerCase() + method.name.slice(1);
    map[method.name] = impl;
    map[lower] = impl; // JS-style camelCase helper
  }
  return map;
}

const FileIO = createMethodMap(fileioMetadata, (filePath) => {
  if (typeof filePath !== 'string') {
    throw new TypeError('FileIO.ReadTextAsync currently accepts only a path string.');
  }
  return native.readText(filePath); // returns a Promise from the addon
});

module.exports = {
  Windows: {
    Storage: {
      FileIO
    }
  }
};
```

At runtime:

```js
const winrt = require('./winrt-projection/src/winrtProxy');
await winrt.Windows.Storage.FileIO.ReadTextAsync('C:/temp/demo.txt');
```

This gives you:
- WinMD metadata → JSON (defines the surface area).
- JS proxy generator (ensures API names stay aligned with metadata).
- Native bridge that performs ABI calls and maps `IAsyncOperation` to JS `Promise`.

## 4. Electron sample focused on `FileIO.ReadTextAsync`
Integrate the projection into `samples/electron` without touching the rest of the sample.

1. **Expose from the preload script**
   ```js
   // samples/electron/src/preload.js
   const { contextBridge } = require('electron');
   const winrt = require('../winrt-projection/src/winrtProxy');

   contextBridge.exposeInMainWorld('WinRT', {
     readTextAsync: (path) => winrt.Windows.Storage.FileIO.ReadTextAsync(path)
   });
   ```

2. **Consume in the renderer**
   ```js
   // samples/electron/src/index.js
   document.getElementById('pick-file').addEventListener('click', async () => {
     const result = await window.WinRT.readTextAsync('C:/temp/demo.txt');
     document.getElementById('output').textContent = result;
   });
   ```

3. **Ensure the file is accessible**
   - Use files inside the packaged app (`ms-appx:///`) or grant broad file-system access via capabilities in `samples/electron/appxmanifest.xml` (e.g., `broadFileSystemAccess`).
   - When debugging unpackaged (Forge dev server), running `npx winapp node add-electron-debug-identity` keeps the identity aligned with the manifest so `FileIO` APIs succeed.

4. **Build flow**
   ```pwsh
   cd samples/electron
   npm install
   npm run build-addon  # if you hook this command to build the new winrt_bridge
   npm start
   ```

### Can the Electron sample run a FileIO-only projection?
Yes. The existing sample already copies the Windows App SDK runtime and carries a native addon pipeline, so introducing a FileIO-only WinRT projection is straightforward:
- The C++ bridge builds with the same `node-gyp` flow already used by `samples/electron/addon/`.
- The preload/renderer surfaces match the pattern the sample uses for its notification demo, so no new infrastructure is required.
- Packaging-wise, the signed MSIX already contains `appxmanifest.xml` + assets — add any required capabilities and re-run `npm run package-msix(:x64)`. The projection code is just another JS + native asset under `resources/app`.

Once this thin slice works, you can iterate the parser/proxy to hydrate more APIs (e.g., StorageFolder, Streams, UI) by re-running the WinMD dump and regenerating the proxy.
