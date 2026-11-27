/**
 * Domain vocabulary handed to the recognizers that accept it.
 *
 * Two families can use these, in different ways. Fun-ASR-Nano takes them as prompt text, so the
 * list costs context from its fixed 1024-token budget. X-ASR takes them as biasing phrases, which
 * only apply under `modified_beam_search`, and too many phrases make the decoder hear them where
 * nobody said them. The list is therefore deliberately short and made of terms that are actually
 * misheard: proper nouns, product names, and the English words that Chinese speakers mix in.
 *
 * Everything here is developer and AI vocabulary; a caller appends their own through
 * `hotwordsEnabled` plus `hotwords` in the plugin configuration.
 */
/** Terms worth biasing, grouped the way a person would look for them. */
export const BUILTIN_HOTWORDS = [
    // Version control.
    'commit', 'merge', 'rebase', 'branch', 'stash', 'tag', 'diff', 'fork', 'cherry-pick', 'pull request',
    // Build and dependencies.
    '编译', '构建', '链接', '依赖', '快照', '缓存', '打包', '产物', '中间件', '版本号',
    // Containers and deployment.
    'Docker', 'Kubernetes', 'Pod', '容器', '镜像', '编排', '灰度', '蓝绿部署', '集群', '节点', '网关', '负载均衡',
    // Data and storage.
    'Redis', 'PostgreSQL', 'MySQL', 'MongoDB', 'Kafka', '消息队列', '索引', '事务', '分库分表', '慢查询', '幂等', '主从',
    // AI and large models.
    '大模型', '推理', '训练', '微调', '量化', '蒸馏', '提示词', '上下文', '上下文窗口', '向量', '嵌入',
    '检索增强', '智能体', '幻觉', '对齐', '数据集', '显存', '吞吐', '延迟', '参数量', '注意力', '分词器',
    // Engineering practice.
    'benchmark', '单元测试', '集成测试', '压测', '回归', '重构', '埋点', '告警', '日志', '堆栈',
    '超时', '并发', '线程池', '死锁', '降级', '熔断',
    // Terms and tools.
    'GitHub', 'GitLab', 'VSCode', 'CLI', 'API', 'SDK', 'JSON', 'YAML', 'HTTP', 'REST',
    'gRPC', 'WebSocket', '前端', '后端', '接口', '序列化',
    // Languages and frameworks.
    'Python', 'JavaScript', 'TypeScript', 'Rust', 'Go', 'Java', 'React', 'Vue', 'Node', 'ONNX', 'WebAssembly',
];
/**
 * Merge the built-in list with caller-supplied terms.
 *
 * Duplicates are dropped case-insensitively and later entries win, so a caller can correct the
 * spelling of a built-in term without editing this file.
 * @param extra - additional terms, in any order.
 * @returns one term per line of text, with the caller's spelling kept.
 */
export function mergeHotwords(extra = []) {
    const seen = new Map();
    for (const term of [...BUILTIN_HOTWORDS, ...extra]) {
        const trimmed = term.trim();
        if (trimmed.length === 0)
            continue;
        seen.set(trimmed.toLowerCase(), trimmed);
    }
    return [...seen.values()];
}
/**
 * Build the prompt fragment Fun-ASR reads.
 *
 * The model takes a plain string, and a comma-separated list reads as a vocabulary hint rather
 * than as a sentence to transcribe.
 * @param terms - merged hotwords.
 * @returns the prompt fragment, empty when there is nothing to add.
 */
export function promptFor(terms) {
    return terms.join('、');
}
/**
 * Build the biasing phrase list X-ASR reads.
 *
 * sherpa separates phrases with `/`, and with `modelingUnit: bpe` the phrases are ordinary words
 * rather than token sequences.
 * @param terms - merged hotwords.
 * @returns the phrase string, empty when there is nothing to add.
 */
export function phrasesFor(terms) {
    return terms.filter((term) => !term.includes('/')).join('/');
}
//# sourceMappingURL=hotwords.js.map