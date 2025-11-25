{
  "targets": [
    {
      "target_name": "winrt_bridge",
      "sources": [
        "fileio_bridge.cc",
        "ocr_bridge.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "<(module_root_dir)/../../.winapp/include"
      ],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "cflags_cc": ["/std:c++20"],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1,
          "AdditionalOptions": [
            "/Zc:twoPhase-",
            "/bigobj"
          ]
        }
      },
      "libraries": ["runtimeobject.lib"],
      "defines": [
        "NODE_ADDON_API_CPP_EXCEPTIONS",
        "WINRT_LEAN_AND_MEAN",
        "WIN32_LEAN_AND_MEAN"
      ]
    }
  ]
}
