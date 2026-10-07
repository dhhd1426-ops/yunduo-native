// 云朵天气 · Wallpaper Engine 原生渲染：JNI 接口（Java 类 com.cloudweather.xiaoyu.WeNative）
// 一个句柄 = 一个 SceneWallpaper + 一块 ANativeWindow。SurfaceView 的表面建好时 create，表面销毁前 destroy（同步收掉渲染线程）。
#include <jni.h>
#include <android/log.h>
#include <android/native_window_jni.h>
#include <vulkan/vulkan.h>
#include <vulkan/vulkan_android.h>

#include <atomic>
#include <cstdlib>
#include <memory>
#include <mutex>
#include <string>

#include "SceneWallpaper.hpp"
#include "SceneWallpaperSurface.hpp"

namespace wallpaper
{
void YdSetView(float x0, float y0, float w, float h);   // VulkanRender.cpp（移植补丁）
}

#define TAG "WE"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

namespace
{
struct Handle {
    ANativeWindow*                         window { nullptr };
    std::unique_ptr<wallpaper::SceneWallpaper> sw;
    std::atomic<int>                       state { 0 };   // 0 加载中 / 1 第一帧出来了 / -1 失败
    std::mutex                             mu;
    std::string                            err;
};

std::string str(JNIEnv* env, jstring s) {
    if (! s) return {};
    const char* c = env->GetStringUTFChars(s, nullptr);
    std::string r = c ? c : "";
    if (c) env->ReleaseStringUTFChars(s, c);
    return r;
}

Handle* H(jlong h) { return reinterpret_cast<Handle*>(h); }
} // namespace

extern "C" {

JNIEXPORT jlong JNICALL Java_com_cloudweather_xiaoyu_WeNative_nCreate(JNIEnv* env, jclass, jobject surface, jstring jassets,
                                                                     jstring jcache, jint w, jint h, jint fps) {
    std::string assets = str(env, jassets), cache = str(env, jcache);
    // 渲染器的配置 / 管线缓存目录按 HOME / XDG 找：安卓进程里没有，统一指到缓存目录
    setenv("HOME", cache.c_str(), 1);
    setenv("XDG_CONFIG_HOME", (cache + "/config").c_str(), 1);
    setenv("XDG_CACHE_HOME", (cache + "/xdg").c_str(), 1);

    auto* hd   = new Handle();
    hd->window = ANativeWindow_fromSurface(env, surface);
    if (! hd->window) {
        delete hd;
        LOGE("ANativeWindow_fromSurface failed");
        return 0;
    }
    hd->sw = std::make_unique<wallpaper::SceneWallpaper>();
    if (! hd->sw->init()) {
        LOGE("SceneWallpaper init failed");
        ANativeWindow_release(hd->window);
        delete hd;
        return 0;
    }
    ANativeWindow* win = hd->window;

    wallpaper::RenderInitInfo info;
    info.offscreen = false;
    info.width     = (uint16_t)w;
    info.height    = (uint16_t)h;
    info.surface_info.instanceExts = { VK_KHR_SURFACE_EXTENSION_NAME, VK_KHR_ANDROID_SURFACE_EXTENSION_NAME };
    info.surface_info.createSurfaceOp = [win](VkInstance inst, VkSurfaceKHR* out) -> VkResult {
        auto fn = (PFN_vkCreateAndroidSurfaceKHR)vkGetInstanceProcAddr(inst, "vkCreateAndroidSurfaceKHR");
        if (! fn) return VK_ERROR_EXTENSION_NOT_PRESENT;
        VkAndroidSurfaceCreateInfoKHR ci { VK_STRUCTURE_TYPE_ANDROID_SURFACE_CREATE_INFO_KHR, nullptr, 0, win };
        return fn(inst, &ci, nullptr, out);
    };

    Handle* self = hd;
    hd->sw->setPropertyObject(wallpaper::PROPERTY_FIRST_FRAME_CALLBACK,
                              std::make_shared<wallpaper::FirstFrameCallback>([self]() {
                                  int z = 0;
                                  self->state.compare_exchange_strong(z, 1);
                                  LOGI("first frame");
                              }));
    hd->sw->setPropertyObject(wallpaper::PROPERTY_SCENE_LOAD_FAILED_CALLBACK,
                              std::make_shared<wallpaper::SceneLoadFailedCallback>([self](const std::string& why) {
                                  {
                                      std::lock_guard<std::mutex> lk(self->mu);
                                      self->err = why;
                                  }
                                  self->state.store(-1);
                              }));
    hd->sw->initVulkan(info);
    hd->sw->setPropertyString(wallpaper::PROPERTY_CACHE_PATH, cache);
    hd->sw->setPropertyString(wallpaper::PROPERTY_ASSETS, assets);
    hd->sw->setPropertyInt32(wallpaper::PROPERTY_FPS, fps > 0 ? fps : 30);
    hd->sw->setPropertyBool(wallpaper::PROPERTY_MUTED, true);   // 壁纸自带的声音先不放（App 里有自己的声音设置）
    hd->sw->setPropertyFloat(wallpaper::PROPERTY_VOLUME, 0.0f);
    hd->sw->setPropertyInt32(wallpaper::PROPERTY_FILLMODE, (int32_t)wallpaper::FillMode::ASPECTCROP);
    LOGI("create %dx%d fps=%d assets=%s", w, h, fps, assets.c_str());
    return reinterpret_cast<jlong>(hd);
}

JNIEXPORT void JNICALL Java_com_cloudweather_xiaoyu_WeNative_nLoad(JNIEnv* env, jclass, jlong h, jstring src) {
    if (! h) return;
    std::string s = str(env, src);
    H(h)->state.store(0);
    H(h)->sw->setPropertyString(wallpaper::PROPERTY_SOURCE, s);
    H(h)->sw->play();
    LOGI("load %s", s.c_str());
}

JNIEXPORT void JNICALL Java_com_cloudweather_xiaoyu_WeNative_nView(JNIEnv*, jclass, jlong h, jfloat x0, jfloat y0, jfloat w,
                                                                  jfloat hh) {
    wallpaper::YdSetView(x0, y0, w, hh);
    if (h) H(h)->sw->setPropertyInt32(wallpaper::PROPERTY_FILLMODE, (int32_t)wallpaper::FillMode::ASPECTCROP);   // 让渲染线程按新取景框重算相机
}

JNIEXPORT void JNICALL Java_com_cloudweather_xiaoyu_WeNative_nPlay(JNIEnv*, jclass, jlong h) {
    if (h) H(h)->sw->play();
}

JNIEXPORT void JNICALL Java_com_cloudweather_xiaoyu_WeNative_nPause(JNIEnv*, jclass, jlong h) {
    if (h) H(h)->sw->pause();
}

JNIEXPORT void JNICALL Java_com_cloudweather_xiaoyu_WeNative_nSpeed(JNIEnv*, jclass, jlong h, jfloat speed) {
    if (h) H(h)->sw->setPropertyFloat(wallpaper::PROPERTY_SPEED, speed);
}

JNIEXPORT jint JNICALL Java_com_cloudweather_xiaoyu_WeNative_nState(JNIEnv*, jclass, jlong h) {
    return h ? H(h)->state.load() : -1;
}

// "宽,高|错误"：场景的正交尺寸（网页按它算取景框）
JNIEXPORT jstring JNICALL Java_com_cloudweather_xiaoyu_WeNative_nInfo(JNIEnv* env, jclass, jlong h) {
    if (! h) return env->NewStringUTF("0,0|no handle");
    auto        o = H(h)->sw->getOrthoSize();
    std::string e;
    {
        std::lock_guard<std::mutex> lk(H(h)->mu);
        e = H(h)->err;
    }
    std::string r = std::to_string(o[0]) + "," + std::to_string(o[1]) + "|" + e;
    return env->NewStringUTF(r.c_str());
}

JNIEXPORT void JNICALL Java_com_cloudweather_xiaoyu_WeNative_nMouse(JNIEnv*, jclass, jlong h, jfloat x, jfloat y) {
    if (h) H(h)->sw->mouseInput(x, y);
}

JNIEXPORT void JNICALL Java_com_cloudweather_xiaoyu_WeNative_nDestroy(JNIEnv*, jclass, jlong h) {
    if (! h) return;
    Handle* hd = H(h);
    hd->sw.reset();   // 析构里同步停掉主循环和渲染线程
    if (hd->window) ANativeWindow_release(hd->window);
    delete hd;
    LOGI("destroyed");
}

} // extern "C"
