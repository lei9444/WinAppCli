#include <napi.h>
#include <string>
#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Storage.h>

using namespace winrt;
using namespace Windows::Storage;

namespace
{
class ReadTextWorker final : public Napi::AsyncWorker
{
public:
    ReadTextWorker(Napi::Env env, winrt::hstring path, Napi::Promise::Deferred deferred)
        : Napi::AsyncWorker(env), path_(std::move(path)), deferred_(std::move(deferred))
    {
    }

    void Execute() override
    {
        init_apartment(apartment_type::multi_threaded);
        try
        {
            auto file = StorageFile::GetFileFromPathAsync(path_).get();
            auto text = FileIO::ReadTextAsync(file).get();
            result_ = winrt::to_string(text);
        }
        catch (const winrt::hresult_error& ex)
        {
            hasError_ = true;
            errorMessage_ = winrt::to_string(ex.message());
        }
        catch (const std::exception& ex)
        {
            hasError_ = true;
            errorMessage_ = ex.what();
        }
    }

    void OnOK() override
    {
        if (hasError_)
        {
            deferred_.Reject(Napi::Error::New(Env(), errorMessage_).Value());
        }
        else
        {
            deferred_.Resolve(Napi::String::New(Env(), result_));
        }
    }

private:
    winrt::hstring path_;
    std::string result_;
    bool hasError_ = false;
    std::string errorMessage_;
    Napi::Promise::Deferred deferred_;
};
}

Napi::Value ReadText(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    if (info.Length() != 1 || !info[0].IsString())
    {
        Napi::TypeError::New(env, "Expected file path string").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto utf16Path = info[0].As<Napi::String>().Utf16Value();
    std::wstring widePath;
    widePath.reserve(utf16Path.size());
    for (char16_t ch : utf16Path)
    {
        widePath.push_back(static_cast<wchar_t>(ch));
    }
    winrt::hstring hPath(widePath.c_str(), widePath.size());
    auto deferred = Napi::Promise::Deferred::New(env);
    auto* worker = new ReadTextWorker(env, std::move(hPath), deferred);
    worker->Queue();
    return deferred.Promise();
}

// Forward declaration for OCR module
Napi::Object InitOcr(Napi::Env env, Napi::Object exports);

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    init_apartment(apartment_type::single_threaded);
    exports.Set("readText", Napi::Function::New(env, ReadText, "readText"));
    
    // Initialize OCR module
    InitOcr(env, exports);
    
    return exports;
}

NODE_API_MODULE(winrt_bridge, Init)
