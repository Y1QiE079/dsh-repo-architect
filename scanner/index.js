const fs = require('fs');
const path = require('path');
const { defineTool } = require('@deepseek-ai/dsh-tools');

module.exports.name = 'repo-scanner';
module.exports.inject = ['tools'];

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.cache']);
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB，超过则跳过读取

// ---------- 工具函数 ----------
function safeReaddir(dir) {
    try {
        return fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
        return [];
    }
}

function safeStat(full) {
    try {
        return fs.statSync(full);
    } catch (e) {
        return null;
    }
}

function safeReadFile(full) {
    try {
        const stat = fs.statSync(full);
        if (stat.size > MAX_FILE_SIZE) return null;
        return fs.readFileSync(full, 'utf-8');
    } catch (e) {
        return null;
    }
}

// 解析相对路径为真实文件路径
function resolveDep(fromFile, dep) {
    const dir = path.dirname(fromFile);
    const candidates = [];
    const base = path.resolve(dir, dep);
    candidates.push(base);
    candidates.push(base + '.js');
    candidates.push(base + '.json');
    candidates.push(path.join(base, 'index.js'));
    for (const c of candidates) {
        try {
            if (fs.statSync(c).isFile()) return c;
        } catch (e) { /* 继续试下一个 */ }
    }
    return null;
}

// ---------- 插件主体 ----------
module.exports.apply = function(ctx) {

    // ========== scan_repo ==========
    ctx.tools.register(defineTool({
        name: 'scan_repo',
        description: '扫描指定目录的仓库结构。当用户要求分析仓库架构、查看项目结构或了解代码组织方式时使用。',
        parameters: {
            root: { type: 'string', required: true, description: '要扫描的仓库根目录绝对路径' },
            maxDepth: { type: 'number', description: '最大扫描深度，默认 2，范围 1-6' }
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }]
        },
        async execute(args) {
            const root = args.root;
            let maxDepth = Number(args.maxDepth) || 2;
            if (maxDepth < 1) maxDepth = 1;
            if (maxDepth > 6) maxDepth = 6;

            if (!root || typeof root !== 'string') return '错误：root 参数必须是字符串。';
            const stat = safeStat(root);
            if (!stat || !stat.isDirectory()) return `错误：路径不存在或不是目录 ${root}`;

            const visited = new Set();

            function walk(dir, depth, prefix) {
                if (depth > maxDepth) return [];
                const real = (() => { try { return fs.realpathSync(dir); } catch (e) { return dir; } })();
                if (visited.has(real)) return [`${prefix}🔁 (符号链接循环，已跳过)`];
                visited.add(real);

                const entries = safeReaddir(dir);
                const lines = [];
                for (const entry of entries) {
                    if (IGNORE_DIRS.has(entry.name)) continue;
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        lines.push(`${prefix}📁 ${entry.name}/`);
                        lines.push(...walk(full, depth + 1, prefix + '  '));
                    } else if (entry.isFile()) {
                        const s = safeStat(full);
                        const size = s ? s.size : 0;
                        lines.push(`${prefix}📄 ${entry.name} (${size}B)`);
                    }
                }
                return lines;
            }

            const tree = walk(root, 1, '');

            let pkgSummary = '';
            const pkgPath = path.join(root, 'package.json');
            const pkgContent = safeReadFile(pkgPath);
            if (pkgContent) {
                try {
                    const pkg = JSON.parse(pkgContent);
                    pkgSummary = [
                        `项目名：${pkg.name || '未知'}`,
                        `版本：${pkg.version || '未知'}`,
                        `描述：${pkg.description || '无'}`,
                        `依赖数：${Object.keys(pkg.dependencies || {}).length}`,
                        `开发依赖数：${Object.keys(pkg.devDependencies || {}).length}`
                    ].join('\n');
                } catch (e) {
                    pkgSummary = `package.json 解析失败：${e.message}`;
                }
            }

            return [
                `# 仓库扫描结果：${root}`,
                '',
                '## 目录结构',
                '```',
                ...tree,
                '```',
                '',
                '## package.json 摘要',
                pkgSummary || '未找到 package.json'
            ].join('\n');
        }
    }));

    // ========== analyze_dependencies ==========
    ctx.tools.register(defineTool({
        name: 'analyze_dependencies',
        description: '分析仓库中 JS 文件的依赖关系。当用户要求分析模块依赖、生成依赖图时使用。',
        parameters: {
            root: { type: 'string', required: true, description: '仓库根目录绝对路径' },
            subDir: { type: 'string', description: '要分析的子目录，默认 lib' }
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }]
        },
        async execute(args) {
            const root = args.root;
            const subDir = args.subDir || 'lib';
            if (!root || typeof root !== 'string') return '错误：root 参数必须是字符串。';
            const baseDir = path.join(root, subDir);
            const stat = safeStat(baseDir);
            if (!stat || !stat.isDirectory()) return `错误：子目录不存在 ${baseDir}`;

            const files = [];
            const visited = new Set();

            function collect(dir) {
                const real = (() => { try { return fs.realpathSync(dir); } catch (e) { return dir; } })();
                if (visited.has(real)) return;
                visited.add(real);
                const entries = safeReaddir(dir);
                for (const entry of entries) {
                    if (IGNORE_DIRS.has(entry.name)) continue;
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        collect(full);
                    } else if (entry.isFile() && entry.name.endsWith('.js')) {
                        files.push(full);
                    }
                }
            }
            collect(baseDir);

            if (files.length === 0) return `错误：${subDir} 目录下没有 JS 文件。`;

            const graph = {};
            const missing = {};      // 记录解析不到的依赖
            const fileMap = {};      // 绝对路径 -> 相对路径

            // 先建立文件索引
            for (const file of files) {
                const rel = path.relative(root, file).replace(/\\/g, '/');
                fileMap[file] = rel;
                graph[rel] = [];
            }

            for (const file of files) {
                const rel = path.relative(root, file).replace(/\\/g, '/');
                const content = safeReadFile(file);
                if (content === null) {
                    graph[rel] = ['(文件过大或不可读，已跳过)'];
                    continue;
                }
                const deps = new Set();

                // require('...')
                const requireRegex = /require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
                // import ... from '...'
                const importRegex = /from\s+['"](\.[^'"]+)['"]/g;
                // export ... from '...'
                const exportRegex = /export\s+[^'"]*from\s+['"](\.[^'"]+)['"]/g;

                let match;
                while ((match = requireRegex.exec(content)) !== null) deps.add(match[1]);
                while ((match = importRegex.exec(content)) !== null) deps.add(match[1]);
                while ((match = exportRegex.exec(content)) !== null) deps.add(match[1]);

                const resolved = [];
                for (const dep of deps) {
                    const abs = resolveDep(file, dep);
                    if (abs && fileMap[abs]) {
                        resolved.push(fileMap[abs]);
                    } else {
                        missing[rel] = missing[rel] || [];
                        missing[rel].push(dep);
                    }
                }
                graph[rel] = resolved;
            }

            // 检测循环依赖（简单 DFS）
            const cycles = [];
            const color = {}; // 0=未访问 1=访问中 2=已完成
            function dfs(node, stack) {
                if (color[node] === 1) {
                    const idx = stack.indexOf(node);
                    if (idx >= 0) cycles.push(stack.slice(idx).concat(node).join(' → '));
                    return;
                }
                if (color[node] === 2) return;
                color[node] = 1;
                for (const next of graph[node] || []) {
                    dfs(next, [...stack, node]);
                }
                color[node] = 2;
            }
            for (const node of Object.keys(graph)) {
                if (!color[node]) dfs(node, []);
            }

            const result = {
                graph,
                missing,
                cycles: [...new Set(cycles)]
            };
            return JSON.stringify(result, null, 2);
        }
    }));

    // ========== generate_mermaid ==========
    ctx.tools.register(defineTool({
        name: 'generate_mermaid',
        description: '根据依赖关系数据生成 Mermaid 流程图。当用户要求可视化依赖关系时使用。',
        parameters: {
            graphJson: { type: 'string', required: true, description: 'analyze_dependencies 返回的 JSON 字符串' }
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }]
        },
        async execute(args) {
            let parsed;
            try {
                parsed = JSON.parse(args.graphJson);
            } catch (e) {
                return `错误：无法解析 JSON - ${e.message}`;
            }

            // 兼容两种输入：直接 graph 对象，或 { graph, missing, cycles }
            const graph = parsed.graph || parsed;
            if (typeof graph !== 'object' || graph === null) {
                return '错误：graphJson 必须是一个 JSON 对象。';
            }

            // 生成唯一节点 ID（用索引，避免路径冲突）
            const nodeIdMap = {};
            let counter = 0;
            function nodeId(key) {
                if (!nodeIdMap[key]) {
                    nodeIdMap[key] = `n${counter++}`;
                }
                return nodeIdMap[key];
            }

            const lines = ['graph TD'];
            const edges = new Set();

            for (const [file, deps] of Object.entries(graph)) {
                if (!Array.isArray(deps)) continue;
                const from = nodeId(file);
                for (const dep of deps) {
                    if (typeof dep !== 'string') continue;
                    const to = nodeId(dep);
                    const edge = `    ${from} --> ${to}`;
                    if (!edges.has(edge)) {
                        edges.add(edge);
                        lines.push(edge);
                    }
                }
            }

            // 追加节点标签
            const labels = [];
            for (const [key, id] of Object.entries(nodeIdMap)) {
                const safeLabel = key.replace(/"/g, '\\"');
                labels.push(`    ${id}["${safeLabel}"]`);
            }

            // 标注缺失依赖和循环
            const notes = [];
            if (parsed.missing && Object.keys(parsed.missing).length > 0) {
                notes.push('');
                notes.push('%% 缺失的依赖（未在分析目录中找到）：');
                for (const [file, deps] of Object.entries(parsed.missing)) {
                    notes.push(`%% ${file} -> ${deps.join(', ')}`);
                }
            }
            if (parsed.cycles && parsed.cycles.length > 0) {
                notes.push('');
                notes.push('%% ⚠️ 检测到循环依赖：');
                for (const c of parsed.cycles) {
                    notes.push(`%% ${c}`);
                }
            }

            return [...labels, ...lines, ...notes].join('\n');
        }
    }));

    console.log('✅ repo-scanner 插件已加载！scan_repo / analyze_dependencies / generate_mermaid 已注册。');
};