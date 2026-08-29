// pulse_xeno.cpp — Node-API bridge between Electron (main.js) and the Xeno
// C++ core.
//
// The addon is the "compiled data-exchange module" of Pulse: it loads
// Xeno.dll into the Electron process with LoadLibrary, resolves the four
// exports of the core (Initialize / GetClients / Execute / Compilable) and
// exposes them to JavaScript.
//
// When the addon is not built, main.js automatically falls back to spawning
// the compiled core executable (Xeno.exe) with child_process and driving it
// over its built-in HTTP channel on 127.0.0.1:19283, so Pulse works either
// way — this file only removes the process hop.
//
// Build (see build.cmd / build.sh):
//     node-gyp rebuild --target=<electron version> --dist-url=https://electronjs.org/headers

#include "../include/xeno_api.h"

#include <node_api.h>

#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#if defined(_WIN32)
#  define WIN32_LEAN_AND_MEAN
#  include <windows.h>
using xeno_module = HMODULE;
#else
#  include <dlfcn.h>
using xeno_module = void*;
#endif

namespace {

/* ------------------------------------------------------------------ state */

xeno_module g_module = nullptr;
std::string g_module_path;
std::string g_last_error;

void(XENO_CALL* g_initialize)() = nullptr;
struct XenoClientInfo*(XENO_CALL* g_get_clients)() = nullptr;
void(XENO_CALL* g_execute)(const char*, const char**, int) = nullptr;
const char*(XENO_CALL* g_compilable)(const char*) = nullptr;

/* ---------------------------------------------------------------- helpers */

napi_value null_value(napi_env env) {
  napi_value result;
  napi_get_null(env, &result);
  return result;
}

napi_value boolean_value(napi_env env, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  return result;
}

napi_value string_value(napi_env env, const std::string& value) {
  napi_value result;
  if (napi_create_string_utf8(env, value.c_str(), NAPI_AUTO_LENGTH, &result) != napi_ok) {
    return null_value(env);
  }
  return result;
}

/** Throws a JS Error and returns nullptr so callers can bail out in one line. */
napi_value fail(napi_env env, const std::string& message) {
  g_last_error = message;
  napi_throw_error(env, nullptr, message.c_str());
  return nullptr;
}

/** Reads argument `index` as a UTF-8 string. */
bool argument_string(napi_env env, napi_callback_info info, size_t index, std::string* out) {
  napi_value argv[8];
  size_t argc = 8;
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (index >= argc) return false;

  napi_valuetype type;
  if (napi_typeof(env, argv[index], &type) != napi_ok) return false;
  if (type == napi_undefined || type == napi_null) return false;

  size_t length = 0;
  if (napi_get_value_string_utf8(env, argv[index], nullptr, 0, &length) != napi_ok) return false;
  out->assign(length + 1, '\0');
  if (napi_get_value_string_utf8(env, argv[index], &(*out)[0], length + 1, &length) != napi_ok) return false;
  out->resize(length);
  return true;
}

/** Reads argument `index` as an array of UTF-8 strings (may be absent). */
bool argument_string_array(napi_env env, napi_callback_info info, size_t index,
                           std::vector<std::string>* out) {
  napi_value argv[8];
  size_t argc = 8;
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (index >= argc) return true;

  napi_valuetype type;
  if (napi_typeof(env, argv[index], &type) != napi_ok) return false;
  if (type == napi_undefined || type == napi_null) return true;

  bool is_array = false;
  if (napi_is_array(env, argv[index], &is_array) != napi_ok || !is_array) {
    // A single user name is accepted as well: execute(source, "Builderman").
    std::string single;
    if (type == napi_string && argument_string(env, info, index, &single)) {
      out->push_back(single);
      return true;
    }
    return false;
  }

  uint32_t length = 0;
  if (napi_get_array_length(env, argv[index], &length) != napi_ok) return false;

  for (uint32_t i = 0; i < length; ++i) {
    napi_value element;
    if (napi_get_element(env, argv[index], i, &element) != napi_ok) continue;

    size_t size = 0;
    if (napi_get_value_string_utf8(env, element, nullptr, 0, &size) != napi_ok) continue;
    std::string value(size + 1, '\0');
    if (napi_get_value_string_utf8(env, element, &value[0], size + 1, &size) != napi_ok) continue;
    value.resize(size);
    out->push_back(value);
  }
  return true;
}

/* -------------------------------------------------------- module loaders */

#if defined(_WIN32)

std::wstring utf8_to_wide(const std::string& text) {
  if (text.empty()) return std::wstring();
  int size = MultiByteToWideChar(CP_UTF8, 0, text.c_str(), static_cast<int>(text.size()), nullptr, 0);
  if (size <= 0) return std::wstring();
  std::wstring wide(static_cast<size_t>(size), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, text.c_str(), static_cast<int>(text.size()), &wide[0], size);
  return wide;
}

xeno_module load_library(const std::string& path, std::string* error) {
  HMODULE handle = LoadLibraryW(utf8_to_wide(path).c_str());
  if (!handle) {
    DWORD code = GetLastError();
    char buffer[256];
    std::snprintf(buffer, sizeof(buffer), "LoadLibrary failed for \"%s\" (Win32 error %lu)",
                  path.c_str(), static_cast<unsigned long>(code));
    *error = buffer;
    return nullptr;
  }
  return handle;
}

void* resolve_symbol(xeno_module handle, const char* name) {
  return reinterpret_cast<void*>(GetProcAddress(handle, name));
}

void close_library(xeno_module handle) { if (handle) FreeLibrary(handle); }

std::string last_platform_error() {
  char buffer[256];
  std::snprintf(buffer, sizeof(buffer), "Win32 error %lu", static_cast<unsigned long>(GetLastError()));
  return std::string(buffer);
}

#else

xeno_module load_library(const std::string& path, std::string* error) {
  void* handle = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
  if (!handle) {
    const char* message = dlerror();
    *error = std::string("dlopen failed for \"") + path + "\": " + (message ? message : "unknown error");
    return nullptr;
  }
  return handle;
}

void* resolve_symbol(xeno_module handle, const char* name) { return dlsym(handle, name); }

void close_library(xeno_module handle) { if (handle) dlclose(handle); }

std::string last_platform_error() {
  const char* message = dlerror();
  return message ? std::string(message) : std::string("unknown dynamic loader error");
}

#endif

void reset_state() {
  g_module = nullptr;
  g_module_path.clear();
  g_initialize = nullptr;
  g_get_clients = nullptr;
  g_execute = nullptr;
  g_compilable = nullptr;
}

bool ensure_loaded(napi_env env) {
  if (g_module && g_initialize && g_get_clients && g_execute && g_compilable) return true;
  fail(env, "the Xeno core is not loaded — call load(path) with the path of Xeno.dll first");
  return false;
}

/* --------------------------------------------------------------- exports */

/** load(path) -> { path, exports: string[] } */
napi_value js_load(napi_env env, napi_callback_info info) {
  std::string path;
  if (!argument_string(env, info, 0, &path)) {
    return fail(env, "load(path): a path to the compiled Xeno core is required");
  }

  if (g_module) {
    std::string next;
    argument_string(env, info, 0, &next);
    if (next == g_module_path) {
      napi_value result;
      if (napi_create_object(env, &result) == napi_ok) {
        napi_set_named_property(env, result, "path", string_value(env, g_module_path));
        napi_set_named_property(env, result, "already", boolean_value(env, true));
        return result;
      }
      return null_value(env);
    }
    return fail(env, "another core is already loaded (" + g_module_path + ") — call unload() first");
  }

  std::string error;
  xeno_module handle = load_library(path, &error);
  if (!handle) return fail(env, error);

  void* initialize = resolve_symbol(handle, "Initialize");
  void* get_clients = resolve_symbol(handle, "GetClients");
  void* execute = resolve_symbol(handle, "Execute");
  void* compilable = resolve_symbol(handle, "Compilable");

  std::string missing;
  if (!initialize) missing += "Initialize ";
  if (!get_clients) missing += "GetClients ";
  if (!execute) missing += "Execute ";
  if (!compilable) missing += "Compilable ";

  if (!missing.empty()) {
    close_library(handle);
    return fail(env, "\"" + path + "\" does not export the Xeno API (missing: " + missing + ")");
  }

  g_module = handle;
  g_module_path = path;
  g_last_error.clear();
  g_initialize = reinterpret_cast<void(XENO_CALL*)()>(initialize);
  g_get_clients = reinterpret_cast<struct XenoClientInfo*(XENO_CALL*)()>(get_clients);
  g_execute = reinterpret_cast<void(XENO_CALL*)(const char*, const char**, int)>(execute);
  g_compilable = reinterpret_cast<const char*(XENO_CALL*)(const char*)>(compilable);

  napi_value result;
  if (napi_create_object(env, &result) != napi_ok) return null_value(env);
  napi_set_named_property(env, result, "path", string_value(env, g_module_path));

  napi_value exported;
  if (napi_create_array_with_length(env, 4, &exported) == napi_ok) {
    const char* names[4] = {"Initialize", "GetClients", "Execute", "Compilable"};
    for (uint32_t i = 0; i < 4; ++i) {
      napi_set_element(env, exported, i, string_value(env, names[i]));
    }
    napi_set_named_property(env, result, "exports", exported);
  }

  return result;
}

/** unload() -> boolean */
napi_value js_unload(napi_env env, napi_callback_info info) {
  (void)info;
  if (!g_module) return boolean_value(env, false);
  close_library(g_module);
  reset_state();
  return boolean_value(env, true);
}

/** initialize() — boots the client scanner and the HTTP control plane. */
napi_value js_initialize(napi_env env, napi_callback_info info) {
  (void)info;
  if (!ensure_loaded(env)) return nullptr;
  g_initialize();
  return boolean_value(env, true);
}

/** getClients() -> [{ pid, id, name, user, version }] */
napi_value js_get_clients(napi_env env, napi_callback_info info) {
  (void)info;
  if (!ensure_loaded(env)) return nullptr;

  napi_value array;
  if (napi_create_array(env, &array) != napi_ok) return null_value(env);

  struct XenoClientInfo* clients = g_get_clients();
  if (!clients) return array;

  uint32_t index = 0;
  for (int i = 0; i < 4096; ++i) {
    const struct XenoClientInfo& entry = clients[i];
    if (!entry.Version && !entry.Username && entry.PID == 0) break;  // terminator

    napi_value object;
    if (napi_create_object(env, &object) != napi_ok) break;

    napi_value pid;
    if (napi_create_int32(env, entry.PID, &pid) == napi_ok) {
      napi_set_named_property(env, object, "pid", pid);
      napi_set_named_property(env, object, "id", pid);
    }

    const char* name = entry.Username ? entry.Username : "";
    napi_set_named_property(env, object, "name", string_value(env, name));
    napi_set_named_property(env, object, "user", string_value(env, name));
    napi_set_named_property(env, object, "version", string_value(env, entry.Version ? entry.Version : ""));

    napi_set_element(env, array, index++, object);
  }

  return array;
}

/** execute(source, users?) -> number of targeted clients */
napi_value js_execute(napi_env env, napi_callback_info info) {
  if (!ensure_loaded(env)) return nullptr;

  std::string source;
  argument_string(env, info, 0, &source);

  std::vector<std::string> users;
  argument_string_array(env, info, 1, &users);

  std::vector<const char*> raw;
  raw.reserve(users.size());
  for (size_t i = 0; i < users.size(); ++i) raw.push_back(users[i].c_str());

  g_execute(source.c_str(), raw.empty() ? nullptr : raw.data(), static_cast<int>(raw.size()));

  napi_value count;
  if (napi_create_uint32(env, static_cast<uint32_t>(raw.size()), &count) != napi_ok) return null_value(env);
  return count;
}

/** compilable(source) -> "success" | <luau error text> */
napi_value js_compilable(napi_env env, napi_callback_info info) {
  if (!ensure_loaded(env)) return nullptr;

  std::string source;
  argument_string(env, info, 0, &source);

  const char* result = g_compilable(source.c_str());
  if (!result) return string_value(env, "success");
  return string_value(env, result);
}

/** info() -> { loaded, path, exports, error } */
napi_value js_info(napi_env env, napi_callback_info info) {
  (void)info;

  napi_value result;
  if (napi_create_object(env, &result) != napi_ok) return null_value(env);

  napi_set_named_property(env, result, "loaded", boolean_value(env, g_module != nullptr));
  napi_set_named_property(env, result, "path", string_value(env, g_module_path));
  napi_set_named_property(env, result, "error", string_value(env, g_last_error));
  napi_set_named_property(env, result, "platform",
#if defined(_WIN32)
                          string_value(env, "win32"));
#else
                          string_value(env, "posix"));
#endif

  napi_value exported;
  if (napi_create_array(env, &exported) == napi_ok) {
    napi_set_named_property(env, result, "exports", exported);
  }

  return result;
}

void define_function(napi_env env, napi_value exports, const char* name, napi_callback callback) {
  napi_value function;
  if (napi_create_function(env, name, NAPI_AUTO_LENGTH, callback, nullptr, &function) == napi_ok) {
    napi_set_named_property(env, exports, name, function);
  }
}

napi_value init_module(napi_env env, napi_value exports) {
  define_function(env, exports, "load", js_load);
  define_function(env, exports, "unload", js_unload);
  define_function(env, exports, "initialize", js_initialize);
  define_function(env, exports, "getClients", js_get_clients);
  define_function(env, exports, "execute", js_execute);
  define_function(env, exports, "compilable", js_compilable);
  define_function(env, exports, "info", js_info);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, init_module)
