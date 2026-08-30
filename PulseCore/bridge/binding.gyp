{
  "targets": [
    {
      "target_name": "pulse_core",
      "sources": [
        "pulse_core.cpp"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "BUILDING_NODE_EXTENSION"
      ],
      "cflags!": [
        "-fno-exceptions"
      ],
      "cflags_cc!": [
        "-fno-exceptions"
      ],
      "conditions": [
        [
          "OS==\"win\"",
          {
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1,
                "AdditionalOptions": [
                  "/std:c++17",
                  "/utf-8",
                  "/EHsc"
                ]
              }
            }
          },
          {
            "cflags_cc": [
              "-std=c++17",
              "-fexceptions"
            ],
            "libraries": [
              "-ldl"
            ]
          }
        ],
        [
          "OS==\"mac\"",
          {
            "xcode_settings": {
              "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
              "CLANG_CXX_LIBRARY": "libc++",
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "MACOSX_DEPLOYMENT_TARGET": "10.15"
            }
          }
        ]
      ]
    }
  ]
}
