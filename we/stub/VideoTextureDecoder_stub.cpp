// 云朵天气安卓移植：视频贴图解码的替身（上游用 libmpv，安卓上没有）。
// 接口和上游 VideoTextureDecoder.hpp 一致；open() 一律失败，渲染器会走「视频解码失败」的回退。
// 以后可以换成 MediaCodec 实现。
#include "VideoTextureDecoder.hpp"
#include "Utils/Logging.h"
#include <cstring>

namespace wallpaper
{
VideoTextureDecoder::VideoTextureDecoder(int width, int height)
    : m_width(width), m_height(height), m_stride((size_t)width * 4) {
    for (int i = 0; i < NUM_BUFFERS; i++) {
        m_buffers[i] = std::make_unique<uint8_t[]>(m_stride * (size_t)m_height);
        std::memset(m_buffers[i].get(), 0, m_stride * (size_t)m_height);
    }
}
VideoTextureDecoder::~VideoTextureDecoder() = default;
bool VideoTextureDecoder::open(const std::string& path, std::string* outError) {
    LOG_ERROR("video texture not supported in android port: %s", path.c_str());
    if (outError) *outError = "video textures are not supported on this platform yet";
    return false;
}
void   VideoTextureDecoder::play() { m_playing = true; }
void   VideoTextureDecoder::pause() { m_playing = false; }
void   VideoTextureDecoder::stop() { m_playing = false; }
double VideoTextureDecoder::getCurrentTimeSec() const { return 0; }
double VideoTextureDecoder::getDurationSec() const { return 0; }
void   VideoTextureDecoder::setCurrentTimeSec(double) {}
void   VideoTextureDecoder::setRate(double) {}
bool   VideoTextureDecoder::hasNewFrame() { return false; }
const uint8_t* VideoTextureDecoder::acquireFrame() { return nullptr; }
void           VideoTextureDecoder::releaseFrame() {}
void VideoTextureDecoder::onMpvRenderUpdate(void*) {}
void VideoTextureDecoder::renderFrame() {}
void VideoTextureDecoder::publishFrame() {}
void VideoTextureDecoder::fillAlpha(uint8_t*) {}
bool VideoTextureDecoder::initMpv(std::string* outError) { if (outError) *outError = "no mpv"; return false; }
bool VideoTextureDecoder::loadFile(const std::string&) { return false; }
} // namespace wallpaper
