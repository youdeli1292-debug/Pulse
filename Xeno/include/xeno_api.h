/*
 * xeno_api.h — the binary contract between the Xeno C++ core and any host.
 *
 * Pulse is the Electron front-end that replaces the original WPF shell
 * (XenoUI). Both shells talk to the very same compiled core, so the
 * signatures below mirror the exports of Xeno.dll / Xeno.exe exactly:
 *
 *     extern "C" __declspec(dllexport) void            Initialize(void);
 *     extern "C" __declspec(dllexport) ClientInfo*     GetClients(void);
 *     extern "C" __declspec(dllexport) void            Execute(const char*, const char**, int);
 *     extern "C" __declspec(dllexport) const char*     Compilable(const char*);
 *
 * The header is used in two directions:
 *   • by the core, compiled with XENO_CORE_EXPORTS defined — it then declares
 *     the exported functions with the platform export attribute;
 *   • by hosts (Pulse's Node-API bridge), which resolve the same names with
 *     GetProcAddress / dlsym and cast them to the XENO_CALL pointers.
 *
 * ABI notes
 * ---------
 *   • the calling convention is cdecl on 32-bit Windows (matches the
 *     `CallingConvention = CallingConvention.Cdecl` P/Invoke of XenoUI);
 *   • GetClients returns a NULL-terminated array — the last entry is
 *     { nullptr, nullptr, 0 } — owned by the core, never freed by the host;
 *   • Compilable returns "success" or the Luau compiler error, as a static
 *     buffer owned by the core. Do not free it, copy it if you need to keep it.
 */

#ifndef XENO_API_H
#define XENO_API_H

#include <stddef.h>

#if defined(_WIN32) && !defined(_WIN64)
#  define XENO_CALL __cdecl
#else
#  define XENO_CALL
#endif

#if defined(_WIN32) || defined(_WIN64) || defined(__CYGWIN__)
#  ifdef XENO_CORE_EXPORTS
#    define XENO_API __declspec(dllexport)
#  else
#    define XENO_API
#  endif
#else
#  ifdef XENO_CORE_EXPORTS
#    define XENO_API __attribute__((visibility("default")))
#  else
#    define XENO_API
#  endif
#endif

#ifdef __cplusplus
extern "C" {
#endif

/** One attached Roblox client, as reported by the core. */
struct XenoClientInfo {
  const char* Version;   /* client build version, may be NULL */
  const char* Username;  /* Roblox account name, may be NULL          */
  int PID;               /* process id                                */
};

/** The port the built-in HTTP control plane listens on (see server.cpp). */
#define XENO_DEFAULT_PORT 19283

/**
 * Bootstraps the core: resolves ntdll, starts the client scanner thread
 * (RobloxPlayerBeta.exe / eurotrucks2.exe, 250 ms poll) and opens the HTTP
 * control plane on 127.0.0.1:19283.
 */
XENO_API void XENO_CALL Initialize(void);

/**
 * Snapshot of every client the core currently sees. The returned array stays
 * valid until the next call and is terminated by { NULL, NULL, 0 }.
 * May return NULL when no client is present yet.
 */
XENO_API struct XenoClientInfo* XENO_CALL GetClients(void);

/**
 * Compiles `script_source` with Luau and schedules it inside every client
 * whose Username is listed in `client_users` (num_users entries).
 * Passing NULL / 0 targets all known clients.
 */
XENO_API void XENO_CALL Execute(const char* script_source, const char** client_users, int num_users);

/**
 * Syntax check only. Returns "success" when the source compiles, otherwise
 * the Luau compiler error text.
 */
XENO_API const char* XENO_CALL Compilable(const char* script_source);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* XENO_API_H */
