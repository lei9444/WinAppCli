using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Text.Json;

if (args.Length < 2)
{
    Console.Error.WriteLine("Usage: WinmdDump <path-to-winmd> <full-type-name> [output.json]");
    return 1;
}

var winmdPath = args[0];
var targetType = args[1];
var output = args.Length > 2 ? args[2] : "out.json";

if (!File.Exists(winmdPath))
{
    Console.Error.WriteLine($"WinMD not found: {winmdPath}");
    return 1;
}

using var peReader = new PEReader(File.OpenRead(winmdPath));
var metadata = peReader.GetMetadataReader();

var definitionHandle = metadata.TypeDefinitions
    .FirstOrDefault(handle =>
    {
        var definition = metadata.GetTypeDefinition(handle);
        var ns = metadata.GetString(definition.Namespace);
        var name = metadata.GetString(definition.Name);
        return $"{ns}.{name}" == targetType;
    });

if (definitionHandle.IsNil)
{
    Console.Error.WriteLine($"Type {targetType} not found in {winmdPath}");
    return 1;
}

var typeDefinition = metadata.GetTypeDefinition(definitionHandle);
var methodPayload = new List<object>();

foreach (var methodHandle in typeDefinition.GetMethods())
{
    var method = metadata.GetMethodDefinition(methodHandle);
    var signature = metadata.GetBlobReader(method.Signature);
    methodPayload.Add(new
    {
        name = metadata.GetString(method.Name),
        attributes = method.Attributes.ToString(),
        signature = Convert.ToBase64String(signature.ReadBytes(signature.RemainingBytes))
    });
}

var payload = new
{
    type = targetType,
    methods = methodPayload,
    generatedAt = DateTimeOffset.UtcNow
};

Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output)) ?? Directory.GetCurrentDirectory());
await File.WriteAllTextAsync(output, JsonSerializer.Serialize(payload, new JsonSerializerOptions
{
    WriteIndented = true
}));

Console.WriteLine($"Wrote {methodPayload.Count} methods for {targetType} to {output}");
return 0;
