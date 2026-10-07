# 云朵天气 · Wallpaper Engine 原生渲染移植层
# 上游：CaptSilver/wallpaper-scene-renderer（GPL-2.0，Vulkan 1.1 / C++20），按固定提交拉到 WSR_DIR，不改上游源码。
# 这里只做三件事：① 换掉 Linux 专用依赖（mpv / fontconfig / 桌面 GL / pulse）为替身 ② lz4、freetype 从源码编 ③ 出一个离屏验证工具 werender。
# 本机（Linux + SwiftShader）和安卓 NDK 用同一份配置：
#   cmake -S we -B build -G Ninja -DWSR_DIR=… -DLZ4_DIR=… [-DFREETYPE_DIR=…] [-DCMAKE_TOOLCHAIN_FILE=$NDK/build/cmake/android.toolchain.cmake -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=29]
cmake_minimum_required(VERSION 3.22)
project(wenative C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

set(WSR_DIR "" CACHE PATH "上游 wallpaper-scene-renderer 源码目录")
set(LZ4_DIR "" CACHE PATH "lz4 源码目录")
set(FREETYPE_DIR "" CACHE PATH "freetype 源码目录（安卓必填；本机可用系统的）")
if(NOT EXISTS "${WSR_DIR}/src/SceneWallpaper.cpp")
  message(FATAL_ERROR "WSR_DIR 不对：${WSR_DIR}")
endif()
set(WSR "${WSR_DIR}")

# 上游子目录里要用到的几个 cmake 辅助函数（wek_apply_mull_instrumentation 等）
set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
include(${WSR}/cmake/WekSanitize.cmake)
include(${WSR}/cmake/WekWarnings.cmake)
include(${WSR}/cmake/WekHardening.cmake)
include(${WSR}/cmake/WekMullInstrument.cmake)
set(warn_opts -Wno-everything CACHE INTERNAL "")   # 上游开了一大堆 -W，移植层不关心

# ---------- lz4 ----------
add_library(we_lz4 STATIC ${LZ4_DIR}/lib/lz4.c ${LZ4_DIR}/lib/lz4hc.c ${LZ4_DIR}/lib/lz4frame.c ${LZ4_DIR}/lib/xxhash.c)
target_include_directories(we_lz4 PUBLIC ${LZ4_DIR}/lib)

# ---------- freetype ----------
if(FREETYPE_DIR)
  set(FT_DISABLE_ZLIB ON CACHE BOOL "" FORCE)
  set(FT_DISABLE_BZIP2 ON CACHE BOOL "" FORCE)
  set(FT_DISABLE_PNG ON CACHE BOOL "" FORCE)
  set(FT_DISABLE_HARFBUZZ ON CACHE BOOL "" FORCE)
  set(FT_DISABLE_BROTLI ON CACHE BOOL "" FORCE)
  add_subdirectory(${FREETYPE_DIR} freetype EXCLUDE_FROM_ALL)
  if(NOT TARGET Freetype::Freetype)
    add_library(Freetype::Freetype ALIAS freetype)
  endif()
else()
  find_package(Freetype REQUIRED)
endif()

find_package(Threads REQUIRED)
find_package(Vulkan REQUIRED)
include_directories(SYSTEM ${Vulkan_INCLUDE_DIRS})   # 上游有几个子模块默认 vulkan/vulkan.h 在系统目录里（NDK 是，本机不是）

# ---------- 上游第三方库和各子模块 ----------
add_subdirectory(${WSR}/third_party third_party)
foreach(d Fs Utils Timer Audio Scene Looper Vulkan Particle VulkanRender RenderGraph)
  add_subdirectory(${WSR}/src/${d} src/${d})
endforeach()

# ---------- 主库（源文件清单照上游 src/CMakeLists.txt，视频解码 / 字体回退换成替身） ----------
add_library(wescene-renderer STATIC
  ${WSR}/src/WPJson.cpp
  ${WSR}/src/WPPkgFs.cpp
  ${WSR}/src/Type.cpp
  ${WSR}/src/wpscene/WPImageObject.cpp
  ${WSR}/src/wpscene/WPParticleObject.cpp
  ${WSR}/src/wpscene/WPMaterial.cpp
  ${WSR}/src/wpscene/WPScene.cpp
  ${WSR}/src/wpscene/WPLightObject.cpp
  ${WSR}/src/wpscene/WPModelObject.cpp
  ${WSR}/src/wpscene/WPTextObject.cpp
  ${WSR}/src/WPTextRenderer.cpp
  ${WSR}/src/WPParticleParser.cpp
  ${WSR}/src/WPShaderParser.cpp
  ${WSR}/src/WPSceneParser.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/stub/SystemFontFallback_stub.cpp
  ${WSR}/src/WPShaderValueUpdater.cpp
  ${WSR}/src/WPTexImageParser.cpp
  ${WSR}/src/WPSoundParser.cpp
  ${WSR}/src/WPMdlParser.cpp
  ${WSR}/src/CameraLayer.cpp
  ${WSR}/src/WPPuppet.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/stub/VideoTextureDecoder_stub.cpp
  ${WSR}/src/SceneWallpaper.cpp)
set(WE_INTERNAL wpAudio wpLooper wpVulkanRender wpFs wpScene wpVulkan wpRGraph wpParticle wpTimer)
target_link_libraries(wescene-renderer
  PUBLIC wpUtils ${WE_INTERNAL}
  PRIVATE nlohmann_json Eigen3::Eigen we_lz4 Freetype::Freetype Threads::Threads ${CMAKE_DL_LIBS})
if(ANDROID)
  target_link_libraries(wescene-renderer PUBLIC log android)
endif()
target_include_directories(wescene-renderer PUBLIC ${WSR}/src ${WSR}/src/Swapchain)

# ---------- 离屏验证工具 ----------
add_executable(werender tool/werender.cpp)
target_link_libraries(werender PRIVATE wescene-renderer)

# ---------- App 用的 JNI 库 libwe.so（只在安卓编） ----------
if(ANDROID)
  add_library(we SHARED jni/we_jni.cpp)
  target_link_libraries(we PRIVATE wescene-renderer Vulkan::Vulkan android log)
  # 只导出 JNI 入口，其余符号藏起来（库小一些，也避免和系统库撞名）
  target_link_options(we PRIVATE -Wl,--exclude-libs,ALL -Wl,--gc-sections)
endif()
