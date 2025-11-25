#include <napi.h>
#include <string>
#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.Storage.Streams.h>
#include <winrt/Windows.Graphics.Imaging.h>
#include <winrt/Microsoft.Graphics.Imaging.h>
#include <winrt/Microsoft.Windows.AI.h>
#include <winrt/Microsoft.Windows.AI.Imaging.h>

using namespace winrt;
using namespace Windows::Storage;
using namespace Windows::Storage::Streams;
using namespace Windows::Graphics::Imaging;
using namespace Microsoft::Graphics::Imaging;
using namespace Microsoft::Windows::AI;
using namespace Microsoft::Windows::AI::Imaging;

namespace
{
class AITextRecognitionWorker final : public Napi::AsyncWorker
{
public:
    AITextRecognitionWorker(Napi::Env env, winrt::hstring path, Napi::Promise::Deferred deferred)
        : Napi::AsyncWorker(env), path_(std::move(path)), deferred_(std::move(deferred))
    {
    }

    void Execute() override
    {
        init_apartment(apartment_type::multi_threaded);
        try
        {
            // 1. Check if AI feature is ready
            auto readyState = TextRecognizer::GetReadyState();
            
            if (readyState == AIFeatureReadyState::NotSupportedOnCurrentSystem || readyState == AIFeatureReadyState::DisabledByUser)
            {
                hasError_ = true;
                errorMessage_ = "Text recognition is not supported on this system or disabled";
                return;
            }

            // 2. Ensure model is ready (download if needed)
            TextRecognizer textRecognizer{ nullptr };
            if (readyState == AIFeatureReadyState::NotReady)
            {
                // Download and install AI model
                auto ensureOp = TextRecognizer::EnsureReadyAsync().get();
                if (ensureOp.Status() != AIFeatureReadyResultState::Success)
                {
                    hasError_ = true;
                    errorMessage_ = "Failed to prepare AI model. Status: " + std::to_string(static_cast<int>(ensureOp.Status()));
                    return;
                }
            }
            
            // 3. Create text recognizer
            textRecognizer = TextRecognizer::CreateAsync().get();

            // 4. Load image file
            auto file = StorageFile::GetFileFromPathAsync(path_).get();
            auto stream = file.OpenAsync(FileAccessMode::Read).get();
            
            // 5. Decode image to SoftwareBitmap
            auto decoder = Windows::Graphics::Imaging::BitmapDecoder::CreateAsync(stream).get();
            auto softwareBitmap = decoder.GetSoftwareBitmapAsync().get();
            
            // 6. Create ImageBuffer from SoftwareBitmap
            auto imageBuffer = ImageBuffer::CreateForSoftwareBitmap(softwareBitmap);

            // 7. Recognize text
            auto result = textRecognizer.RecognizeTextFromImage(imageBuffer);

            // 8. Extract text from all lines
            if (result)
            {
                auto lines = result.Lines();
                std::string allText;
                for (auto const& line : lines)
                {
                    if (!allText.empty())
                    {
                        allText += "\n";
                    }
                    allText += winrt::to_string(line.Text());
                }
                recognizedText_ = allText;
            }
            else
            {
                recognizedText_ = "";  // No result
            }

            // 9. Cleanup
            textRecognizer.Close();
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
            deferred_.Resolve(Napi::String::New(Env(), recognizedText_));
        }
    }

private:
    winrt::hstring path_;
    std::string recognizedText_;
    bool hasError_ = false;
    std::string errorMessage_;
    Napi::Promise::Deferred deferred_;
};
}

Napi::Value RecognizeText(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    if (info.Length() != 1 || !info[0].IsString())
    {
        Napi::TypeError::New(env, "Expected image path string").ThrowAsJavaScriptException();
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
    auto* worker = new AITextRecognitionWorker(env, std::move(hPath), deferred);
    worker->Queue();
    return deferred.Promise();
}

Napi::Value CheckAIAvailability(const Napi::CallbackInfo& info)
{
    auto env = info.Env();
    try
    {
        init_apartment(apartment_type::multi_threaded);
        auto readyState = TextRecognizer::GetReadyState();
        
        auto result = Napi::Object::New(env);
        result.Set("state", static_cast<int>(readyState));
        
        switch (readyState)
        {
        case AIFeatureReadyState::Ready:
            result.Set("state", "Ready");
            result.Set("message", "AI feature is ready");
            break;
        case AIFeatureReadyState::NotReady:
            result.Set("state", "NotReady");
            result.Set("message", "AI model needs to be downloaded");
            break;
        case AIFeatureReadyState::NotSupportedOnCurrentSystem:
            result.Set("state", "NotSupported");
            result.Set("message", "AI feature not supported on this system");
            break;
        case AIFeatureReadyState::DisabledByUser:
            result.Set("state", "NotSupported");
            result.Set("message", "AI feature disabled by user");
            break;
        default:
            result.Set("state", "Unknown");
            result.Set("message", "Unknown state");
        }
        
        return result;
    }
    catch (const winrt::hresult_error& ex)
    {
        Napi::Error::New(env, winrt::to_string(ex.message())).ThrowAsJavaScriptException();
        return env.Undefined();
    }
}

Napi::Object InitOcr(Napi::Env env, Napi::Object exports)
{
    exports.Set("recognizeText", Napi::Function::New(env, RecognizeText, "recognizeText"));
    exports.Set("checkAIAvailability", Napi::Function::New(env, CheckAIAvailability, "checkAIAvailability"));
    return exports;
}
