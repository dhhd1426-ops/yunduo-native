// 云朵天气安卓移植：系统字体回退的替身（上游用 fontconfig）。安卓字体在 /system/fonts，按常见文件名找。
#include "SystemFontFallback.hpp"
#include <filesystem>
#include <fstream>
#include <sstream>

namespace wallpaper
{
static std::string firstExisting(std::initializer_list<const char*> c) {
    for (auto* p : c) { std::error_code ec; if (std::filesystem::exists(p, ec)) return p; }
    return {};
}
std::string ResolveSystemFontFallback(const std::string& we_name) {
    bool mono = we_name.find("consol") != std::string::npos || we_name.find("courier") != std::string::npos;
    bool serif = we_name.find("times") != std::string::npos || we_name.find("georgia") != std::string::npos;
    if (mono) return firstExisting({ "/system/fonts/DroidSansMono.ttf", "/system/fonts/CutiveMono.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf" });
    if (serif) return firstExisting({ "/system/fonts/NotoSerif-Regular.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf" });
    return firstExisting({ "/system/fonts/Roboto-Regular.ttf", "/system/fonts/RobotoStatic-Regular.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf" });
}
std::string ReadSystemFile(const std::string& path) {
    std::ifstream f(path, std::ios::binary); if (! f) return {};
    std::ostringstream s; s << f.rdbuf(); return s.str();
}
std::string ResolveCJKHanFallback() {
    return firstExisting({ "/system/fonts/NotoSansCJK-Regular.ttc", "/system/fonts/MiSansVF.ttf", "/system/fonts/NotoSansSC-Regular.otf", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc" });
}
} // namespace wallpaper
