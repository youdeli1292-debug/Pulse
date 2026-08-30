// pulse_core_host.cpp — tiny host process for the Pulse core.
//
// The upstream C++ project builds a single artifact: the core DLL (Visual
// Studio project Xeno.vcxproj, ConfigurationType=DynamicLibrary, v143, C++20).
// Pulse can load that DLL straight into the Electron process through the
// Node-API bridge in PulseCore/bridge, but it is often preferable to keep it in
// own process:
//
//   • a crash inside the core cannot take the editor down;
//   • Electron and the core no longer share an address space;
//   • the core keeps running while the UI is restarted.
//
// This file is that process. main.js spawns it with child_process, waits
// until 127.0.0.1:19283 accepts connections and then drives the core through
// its HTTP control plane (POST /loadstring, /compilable, /send, …).
//
// Build
//   Windows (MSVC):
//     cl /std:c++17 /O2 /EHsc /Fe:PulseCore.exe pulse_core_host.cpp
//   MinGW / GCC:
//     g++ -std=c++17 -O2 -o PulseCore.exe pulse_core_host.cpp
//   CMake:
//     cmake -B build && cmake --build build --config Release
//
// Usage
//   PulseCore.exe [--dll <path to the core DLL>] [--port 19283]

#include "../include/pulse_core.h"

#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#if defined(_WIN32)
#  define WIN32_LEAN_AND_MEAN
#  include <windows.h>
#else
#  include <csignal>
#  include <dlfcn.h>
#  include <unistd.h>
#endif

namespace {

std::atomic<bool> g_running(true);
void* g_module = nullptr;

void(PULSE_CORE_CALL* g_initialize)() = nullptr;
struct PulseClientInfo*(PULSE_CORE_CALL* g_get_clients)() = nullptr;
const char*(PULSE_CORE_CALL* g_compilable)(const char*) = nullptr;

void sleep_ms(unsigned int ms) {
#if defined(_WIN32)
  Sleep(ms);
#else
  usleep(static_cast<useconds_t>(ms) * 1000);
#endif
}

#if defined(_WIN32)

std::wstring utf8_to_wide(const std::string& text) {
  if (text.empty()) return std::wstring();
  int size = MultiByteToWideChar(CP_UTF8, 0, text.c_str(), static_cast<int>(text.size()), nullptr, 0);
  if (size <= 0) return std::wstring();
  std::wstring wide(static_cast<size_t>(size), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, text.c_str(), static_cast<int>(text.size()), &wide[0], size);
  return wide;
}

void* open_core(const std::string& path, std::string* error) {
  HMODULE handle = LoadLibraryW(utf8_to_wide(path).c_str());
  if (!handle) {
    char buffer[256];
    std::snprintf(buffer, sizeof(buffer), "LoadLibrary failed (Win32 error %lu)",
                  static_cast<unsigned long>(GetLastError()));
    *error = buffer;
    return nullptr;
  }
  return handle;
}

void* symbol(void* module, const char* name) {
  return reinterpret_cast<void*>(GetProcAddress(static_cast<HMODULE>(module), name));
}

#else

void* open_core(const std::string& path, std::string* error) {
  void* handle = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
  if (!handle) {
    const char* message = dlerror();
    *error = message ? message : "dlopen failed";
    return nullptr;
  }
  return handle;
}

void* symbol(void* module, const char* name) { return dlsym(module, name); }

#endif

std::string directory_of(const std::string& path) {
  const size_t slash = path.find_last_of("/\\");
  return slash == std::string::npos ? std::string(".") : path.substr(0, slash);
}

#if !defined(_WIN32)
/** Electron kills the host with SIGTERM — leave the core a chance to unwind. */
void handle_signal(int) { g_running = false; }
#endif

}  // namespace

int main(int argc, char** argv) {
  std::string dll = "Xeno.dll";
  int port = PULSE_CORE_DEFAULT_PORT;

  for (int i = 1; i < argc; ++i) {
    const std::string arg = argv[i];
    if ((arg == "--dll" || arg == "-d") && i + 1 < argc) {
      dll = argv[++i];
    } else if ((arg == "--port" || arg == "-p") && i + 1 < argc) {
      port = std::atoi(argv[++i]);
    } else if (arg == "--help" || arg == "-h") {
      std::printf("PulseCore — Pulse core host\n"
                  "  --dll  <path>   core DLL to load (default: Xeno.dll next to this exe)\n"
                  "  --port <n>      control-plane port (default: %d)\n", PULSE_CORE_DEFAULT_PORT);
      return 0;
    }
  }

  std::string error;
  g_module = open_core(dll, &error);
  if (!g_module) {
    // Fall back to any core DLL lying next to this executable.
    const char* candidates[] = {"Xeno.dll", "PulseCore.dll", "Pulse.dll"};
    for (int i = 0; i < 3 && !g_module; ++i) {
      const std::string sibling = directory_of(std::string(argv[0])) + "/" + candidates[i];
      g_module = open_core(sibling, &error);
      if (g_module) dll = sibling;
    }
  }

  if (!g_module) {
    std::fprintf(stderr, "[PulseCore] cannot load the core: %s\n", error.c_str());
    return 2;
  }

  g_initialize = reinterpret_cast<void(PULSE_CORE_CALL*)()>(symbol(g_module, "Initialize"));
  g_get_clients = reinterpret_cast<struct PulseClientInfo*(PULSE_CORE_CALL*)()>(symbol(g_module, "GetClients"));
  g_compilable = reinterpret_cast<const char*(PULSE_CORE_CALL*)(const char*)>(symbol(g_module, "Compilable"));

  if (!g_initialize) {
    std::fprintf(stderr, "[PulseCore] %s does not export Initialize()\n", dll.c_str());
    return 3;
  }

  std::printf("[PulseCore] loaded %s\n", dll.c_str());
  std::printf("[PulseCore] starting the client scanner and the control plane on 127.0.0.1:%d\n", port);
  std::fflush(stdout);

  g_initialize();

#if !defined(_WIN32)
  std::signal(SIGTERM, handle_signal);
  std::signal(SIGINT, handle_signal);
#endif

  std::printf("[PulseCore] ready — waiting for commands from Pulse\n");
  std::fflush(stdout);

  // The core owns the HTTP server and its scanner thread; the host only keeps
  // the process alive and mirrors the client count on stdout. Pulse stops it
  // with child.kill() (SIGTERM) when you press Detach or close the window.
  unsigned int idle = 0;
  while (g_running) {
    sleep_ms(500);
    idle += 1;

    if (idle % 20 == 0 && g_get_clients) {
      struct PulseClientInfo* clients = g_get_clients();
      int count = 0;
      if (clients) {
        for (int i = 0; i < 4096; ++i) {
          const struct PulseClientInfo& entry = clients[i];
          if (!entry.Version && !entry.Username && entry.PID == 0) break;
          count += 1;
        }
      }
      std::printf("[PulseCore] clients: %d\n", count);
      std::fflush(stdout);
    }

  }

  std::printf("[PulseCore] shutting down\n");
  std::fflush(stdout);

  // Deliberately no FreeLibrary: the core keeps detached threads alive and
  // unloading it while they run would crash the process. The OS reclaims
  // everything on exit.
  return 0;
}
