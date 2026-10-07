// 云朵天气安卓移植：VK_KHR_push_descriptor 的兼容垫片（被 vulkan_wrapper.hpp 在 DeviceDispatch 定义之后 #include）。
// 设备支持推送描述符就原样走；不支持（SwiftShader、安卓模拟器、部分老款 Mali）时，每次「推送」改成：
// 从当前轮次的描述符池里分配一个描述符集 → 写入 → 绑定。池子按 Begin() 次数轮换（16 轮），
// 轮到时整池重置——这时它上一次被用到已经是 16 个命令缓冲之前，GPU 早用完了（渲染器同时在飞的帧 ≤ 3）。
// 状态按设备分开存（以设备的函数表指针为键）：App 退到后台会销毁设备、回来再建新的，旧设备可能还在另一个线程里收尾，
// 两个设备的池子不能混在一起。
// 设 WE_EMULATE_PUSH=1 可以在支持的设备上也强制走垫片（测试用）。
// 注意：这个文件在 namespace vvk 里面被包含，标准库头文件由 vulkan_wrapper.hpp 顶部负责（<cstdlib> <mutex> <unordered_map>）
namespace pde
{
struct Dev {
    VkDevice                     dev {};
    const DeviceDispatch*        d {};
    PFN_vkResetDescriptorPool    reset {};
    bool                         on { false };
    static constexpr size_t      RING = 16;
    std::vector<VkDescriptorPool> ring[RING];
    size_t                       used[RING] {};   // 这一轮已经用到第几个池
    size_t                       cur { 0 };
};
struct State {
    std::mutex                                     mu;
    std::unordered_map<const DeviceDispatch*, Dev> devs;
    std::unordered_map<uint64_t, VkDescriptorSetLayout> layouts;   // (流水线布局, set 号) → 描述符集布局（布局句柄各设备不重复）
};
inline State& S() { static State s; return s; }
inline uint64_t key(VkPipelineLayout pl, uint32_t set) { return (uint64_t)(uintptr_t)pl * 131u + set; }

inline bool active(const DeviceDispatch* d) {
    auto& s = S();
    std::lock_guard<std::mutex> lk(s.mu);
    auto it = s.devs.find(d);
    return it != s.devs.end() && it->second.on;
}

inline void init(VkDevice dev, const DeviceDispatch* d, bool native) {
    auto& s = S();
    std::lock_guard<std::mutex> lk(s.mu);
    Dev& x = s.devs[d];
    x = Dev {};
    x.dev = dev; x.d = d;
    const char* f = std::getenv("WE_EMULATE_PUSH");
    x.on = ! native || (f && f[0] && f[0] != '0') || ! d->vkCmdPushDescriptorSetKHR;
    x.reset = reinterpret_cast<PFN_vkResetDescriptorPool>(d->vkGetDeviceProcAddr(dev, "vkResetDescriptorPool"));
    if (x.on) LOG_INFO("push descriptor: emulated with pooled descriptor sets");
}

// 设备销毁前调：把这个设备的池子都还掉
inline void shutdown(const DeviceDispatch* d) {
    auto& s = S();
    std::lock_guard<std::mutex> lk(s.mu);
    auto it = s.devs.find(d);
    if (it == s.devs.end()) return;
    Dev& x = it->second;
    if (x.dev && x.d && x.d->vkDestroyDescriptorPool)
        for (auto& r : x.ring) for (auto p : r) if (p) x.d->vkDestroyDescriptorPool(x.dev, p, nullptr);
    s.devs.erase(it);
}

inline void registerLayout(const DeviceDispatch* d, VkPipelineLayout pl, uint32_t set, VkDescriptorSetLayout dsl) {
    auto& s = S();
    std::lock_guard<std::mutex> lk(s.mu);
    auto it = s.devs.find(d);
    if (it == s.devs.end() || ! it->second.on) return;
    s.layouts[key(pl, set)] = dsl;
}

inline VkDescriptorPool newPool(Dev& x) {
    VkDescriptorPoolSize sz[] = {
        { VK_DESCRIPTOR_TYPE_SAMPLER, 1024 },               { VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 8192 },
        { VK_DESCRIPTOR_TYPE_SAMPLED_IMAGE, 4096 },         { VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 512 },
        { VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 4096 },        { VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 2048 },
        { VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER_DYNAMIC, 512 }, { VK_DESCRIPTOR_TYPE_STORAGE_BUFFER_DYNAMIC, 512 },
    };
    VkDescriptorPoolCreateInfo ci { .sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO, .pNext = nullptr, .flags = 0,
                                    .maxSets = 2048, .poolSizeCount = (uint32_t)(sizeof(sz) / sizeof(sz[0])), .pPoolSizes = sz };
    VkDescriptorPool p {};
    if (x.d->vkCreateDescriptorPool(x.dev, &ci, nullptr, &p) != VK_SUCCESS) return VK_NULL_HANDLE;
    return p;
}

// 每个命令缓冲 Begin() 时调：换到下一轮，并把那一轮的池子整池重置
inline void onBegin(const DeviceDispatch* d) {
    auto& s = S();
    std::lock_guard<std::mutex> lk(s.mu);
    auto it = s.devs.find(d);
    if (it == s.devs.end() || ! it->second.on) return;
    Dev& x = it->second;
    x.cur = (x.cur + 1) % Dev::RING;
    for (size_t i = 0; i < x.used[x.cur] && i < x.ring[x.cur].size(); i++)
        if (x.reset) x.reset(x.dev, x.ring[x.cur][i], 0);
    x.used[x.cur] = 0;
}

inline void push(const DeviceDispatch* d, VkCommandBuffer cb, VkPipelineBindPoint bp, VkPipelineLayout pl, uint32_t set,
                 uint32_t n, const VkWriteDescriptorSet* w) {
    auto& s = S();
    std::lock_guard<std::mutex> lk(s.mu);
    auto dv = s.devs.find(d);
    if (dv == s.devs.end()) return;
    Dev& x = dv->second;
    auto it = s.layouts.find(key(pl, set));
    if (it == s.layouts.end()) { LOG_ERROR("push descriptor emu: unknown pipeline layout"); return; }
    VkDescriptorSet ds {};
    for (int attempt = 0; attempt < 4 && ! ds; attempt++) {
        auto& pools = x.ring[x.cur];
        size_t& u   = x.used[x.cur];
        if (u == 0) u = 1;
        while (pools.size() < u) { VkDescriptorPool p = newPool(x); if (! p) return; pools.push_back(p); }
        VkDescriptorSetAllocateInfo ai { .sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO, .pNext = nullptr,
                                         .descriptorPool = pools[u - 1], .descriptorSetCount = 1, .pSetLayouts = &it->second };
        if (x.d->vkAllocateDescriptorSets(x.dev, &ai, &ds) != VK_SUCCESS) { ds = VK_NULL_HANDLE; u++; }   // 这个池满了：换下一个
    }
    if (! ds) { LOG_ERROR("push descriptor emu: allocation failed"); return; }
    std::vector<VkWriteDescriptorSet> ws(w, w + n);
    for (auto& y : ws) y.dstSet = ds;
    x.d->vkUpdateDescriptorSets(x.dev, n, ws.data(), 0, nullptr);
    x.d->vkCmdBindDescriptorSets(cb, bp, pl, set, 1, &ds, 0, nullptr);
}
} // namespace pde
