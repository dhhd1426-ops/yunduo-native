// 云朵天气安卓移植：离屏渲染一张 Wallpaper Engine 场景并截图（验证用，不开窗口、不建交换链）。
// 用法：werender <assets 目录> <壁纸目录或 scene.json> <输出.ppm> [宽 高 [第几帧截图]]
//   壁纸目录里放 scene.pkg（安卓版 .mpkg 改名即可，格式相同）和 project.json（可选）
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <thread>

#include "SceneWallpaper.hpp"
#include "SceneWallpaperSurface.hpp"

int main(int argc, char** argv) {
    if (argc < 4) {
        std::fprintf(stderr, "usage: %s <assets> <scene> <out.ppm> [w h [frame]]\n", argv[0]);
        return 2;
    }
    std::string assets = argv[1], scene = argv[2], out = argv[3];
    int w = argc > 5 ? std::atoi(argv[4]) : 1080, h = argc > 5 ? std::atoi(argv[5]) : 2400;
    int frame = argc > 6 ? std::atoi(argv[6]) : 90;

    // 安卓 shell 下没有 HOME：渲染器的配置 / 管线缓存目录会落到只读的 "/.config"，统一指到缓存目录
    std::string cache = std::getenv("WE_CACHE") ? std::getenv("WE_CACHE") : "/tmp/we-cache";
    if (! std::getenv("HOME") || ! std::getenv("HOME")[0]) setenv("HOME", cache.c_str(), 1);
    if (! std::getenv("XDG_CONFIG_HOME")) setenv("XDG_CONFIG_HOME", (cache + "/config").c_str(), 1);
    if (! std::getenv("XDG_CACHE_HOME")) setenv("XDG_CACHE_HOME", (cache + "/xdg").c_str(), 1);

    wallpaper::RenderInitInfo info;
    info.offscreen     = true;
    info.deterministic = true;   // 固定步长：每次跑出来同一帧
    info.width         = (uint16_t)w;
    info.height        = (uint16_t)h;

    std::atomic<int> failed { 0 };
    auto* psw = new wallpaper::SceneWallpaper();
    if (! psw->init()) { std::fprintf(stderr, "init failed\n"); return 3; }
    psw->initVulkan(info);
    psw->setPropertyString(wallpaper::PROPERTY_CACHE_PATH, cache);
    psw->setPropertyString(wallpaper::PROPERTY_ASSETS, assets);
    psw->setPropertyString(wallpaper::PROPERTY_SOURCE, scene);
    psw->setPropertyInt32(wallpaper::PROPERTY_FPS, 30);
    psw->play();
    psw->requestScreenshotAtFrame(out, (uint64_t)frame);

    auto t0 = std::chrono::steady_clock::now();
    while (! psw->screenshotDone()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        double s = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
        if (s > (std::getenv("WE_TIMEOUT") ? std::atof(std::getenv("WE_TIMEOUT")) : 600.0)) {
            std::fprintf(stderr, "timeout waiting for frame %d\n", frame);
            failed = 1;
            break;
        }
    }
    std::printf("%s %s after %.1fs\n", failed ? "FAIL" : "OK", out.c_str(),
                std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count());
    std::fflush(stdout);
    std::_Exit(failed ? 5 : 0);   // 渲染线程还在跑：直接退出，不走析构
}
