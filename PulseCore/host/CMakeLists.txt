cmake_minimum_required(VERSION 3.15)
project(PulseCore LANGUAGES CXX)

# Host process for the Xeno core.
#
# Upstream Xeno builds Xeno.dll only. PulseCore.exe loads that DLL, calls
# Initialize() and keeps the process alive while the core serves its HTTP
# control plane on 127.0.0.1:19283. main.js spawns it with child_process.

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()

add_executable(PulseCore pulse_core_host.cpp)

target_include_directories(PulseCore PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/../include")

if(WIN32)
  target_compile_definitions(PulseCore PRIVATE _CRT_SECURE_NO_WARNINGS)
  set_target_properties(PulseCore PROPERTIES WIN32_EXECUTABLE FALSE)
else()
  find_package(Threads QUIET)
  target_link_libraries(PulseCore PRIVATE ${CMAKE_DL_LIBS})
endif()

# The binary is copied to Xeno/bin, which is where main.js looks for it.
add_custom_command(TARGET PulseCore POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
          $<TARGET_FILE:PulseCore>
          ${CMAKE_CURRENT_SOURCE_DIR}/../bin/$<TARGET_FILE_NAME:PulseCore>)
