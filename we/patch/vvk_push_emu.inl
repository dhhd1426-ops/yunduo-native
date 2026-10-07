// 云朵天气安卓移植：VK_KHR_push_descriptor 的兼容垫片（被 vulkan_wrapper.hpp 在 DeviceDispatch 定义之后 #include）。
// 设备支持推送描述符就原样走；不支持（SwiftShader、安卓模拟器、部分老款 Mali）时，每次「推送」改成：
// 从当前轮次的描述符池里分配一个描述符集 → 写入 → 绑定。池子按 Begin() 次数轮换（16 轮），
// 轮到时整池重置——这时它上一次被用到已经是 16 个命令缓冲之前，GPU 早用完了（渲染器同时在飞的帧 ≤ 3）。
// 设 WE_EMULATE_PUSH=1 可以在支持的设备上也强制走垫片（测试用）。
// 注意：这个文件在 namespace vvk 里面被包含，标准库头文件由 vulkan_wrapper.hpp 顶部负责（<cstdlib> <mutex> <unordered_map>）
namespace pde
{
struct State {
    VkDevice                     dev {};
    const DeviceDispatch*        d {};
    PFN_vkResetDescriptorPool    reset {};
    bool                         on { false };
    std::mutex                   mu;
    std::unordered_map<uint64_t, VkDescriptorSetLayout> layouts;   // (流水线布局, set 号) → 描述符集布局
    static constexpr size_t      RING = 16;
    std::vector<VkDescriptorPool> ring[RING];
    size_t                       used[RING] {};   // 这一轮已经用到第几个池
    size_t                       cur { 0 };
};
inline State& S() { static State s; return s; }
inline bool   active() { return S().on; }
inline uint64_t key(VkPipelineLayout pl, uint32_t set) { return (uint64_t)(uintptr_t)pl * 131u + set; }

inline void init(VkDevice dev, const DeviceDispatch* d, bool native) {
    auto& s = S();
    std::lock_guard<std::mutex> lk(s.mu);
    s.dev = dev; s.d = d;
    const char* f = std::getenv("WE_EMULATE_PUSH");
    s.on = ! native || (f && f[0] && f[0] != '0') || ! d->vkCmdPushDescriptorSetKHR;
    s.reset = reinterpret_cast<PFN_vkResetDescriptorPool>(d->vkGetDeviceProcAddr(dev, "vkResetDescriptorPool"));
    if (s.on) LOG_INFO("push descriptor: emulated with pooled descriptor sets");
}
inline void registerLayout(VkPipelineLayout pl, uint32_t set, VkDescriptorSetLayout dsl) {
    auto& s = S();
    if (! s.on) return;
    std::lock_guard<std::mutex> lk(s.mu);
    s.layouts[key(pl, set)] = dsl;
}
inline VkDescriptorPool newPool(State& s) {
    VkDescriptorPoolSize sz[] = {
        { VK_DESCRIPTOR_TYPE_SAMPLER, 1024 },               { VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 8192 },
        { VK_DESCRIPTOR_TYPE_SAMPLED_IMAGE, 4096 },         { VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 512 },
        { VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 4096 },        { VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, 2048 },
        { VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER_DYNAMIC, 512 }, { VK_DESCRIPTOR_TYPE_STORAGE_BUFFER_DYNAMIC, 512 },
    };
    VkDescriptorPoolCreateInfo ci { .sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO, .pNext = nullptr, .flags = 0,
                                    .maxSets = 2048, .poolSizeCount = (uint32_t)(sizeof(sz) / sizeof(sz[0])), .pPoolSizes = sz };
    VkDescriptorPool p {};
    if (s.d->vkCreateDescriptorPool(s.dev, &ci, nullptr, &p) != VK_SUCCESS) return VK_NULL_HANDLE;
    return p;
}
// 每个命令缓冲 Begin() 时调：换到下一轮，并把那一轮的池子整池重置
inline void onBegin() {
    auto& s = S();
    if (! s.on || ! s.dev) return;
    std::lock_guard<std::mutex> lk(s.mu);
    s.cur = (s.cur + 1) % State::RING;
    for (size_t i = 0; i < s.used[s.cur] && i < s.ring[s.cur].size(); i++)
        if (s.reset) s.reset(s.dev, s.ring[s.cur][i], 0);
    s.used[s.cur] = 0;
}
inline void push(VkCommandBuffer cb, VkPipelineBindPoint bp, VkPipelineLayout pl, uint32_t set,
                 uint32_t n, const VkWriteDescriptorSet* w) {
    auto& s = S();
    std::lock_guard<std::mutex> lk(s.mu);
    auto it = s.layouts.find(key(pl, set));
    if (it == s.layouts.end()) { LOG_ERROR("push descriptor emu: unknown pipeline layout"); return; }
    VkDescriptorSet ds {};
    for (int attempt = 0; attempt < 4 && ! ds; attempt++) {
        auto& pools = s.ring[s.cur];
        size_t& u   = s.used[s.cur];
        if (u == 0) u = 1;
        while (pools.size() < u) { VkDescriptorPool p = newPool(s); if (! p) return; pools.push_back(p); }
        VkDescriptorSetAllocateInfo ai { .sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO, .pNext = nullptr,
                                         .descriptorPool = pools[u - 1], .descriptorSetCount = 1, .pSetLayouts = &it->second };
        if (s.d->vkAllocateDescriptorSets(s.dev, &ai, &ds) != VK_SUCCESS) { ds = VK_NULL_HANDLE; u++; }   // 这个池满了：换下一个
    }
    if (! ds) { LOG_ERROR("push descriptor emu: allocation failed"); return; }
    std::vector<VkWriteDescriptorSet> ws(w, w + n);
    for (auto& x : ws) x.dstSet = ds;
    s.d->vkUpdateDescriptorSets(s.dev, n, ws.data(), 0, nullptr);
    s.d->vkCmdBindDescriptorSets(cb, bp, pl, set, 1, &ds, 0, nullptr);
}
} // namespace pde
