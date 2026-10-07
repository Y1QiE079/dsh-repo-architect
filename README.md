✨ 功能特性  
仓库结构扫描：快速获取目录树和 package.json 摘要。

模块依赖分析：提取 JS 文件间的 require / import 关系，检测缺失依赖和循环依赖。

Mermaid 依赖图：自动生成可直接渲染的 Mermaid 流程图。

Workflow 编排：并行分析多个子目录，汇总成完整报告。

Skill 触发：一句话即可启动完整分析流程。

📦 安装   
从 GitHub 直接安装：
dsh plugin --profile web add github:Y1QiE079/dsh-repo-architect

🚀 使用   
新建会话，选择预设 “仓库架构分析师”。

输入指令：分析当前仓库的架构。

Agent 会自动调用 scan_repo → analyze_dependencies → generate_mermaid，并输出一份 Markdown 报告，包含：

·项目概览

·目录结构

·模块依赖说明

·Mermaid 依赖图

·架构总结
