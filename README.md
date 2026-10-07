# dsh-repo-architect

> 一句话分析任意 Node.js 仓库的架构，自动生成模块依赖图和架构报告。

## ✨ 功能特性

本插件（Plugin）提供以下三个核心工具：
- **`scan_repo`**：扫描仓库结构，获取目录树和 package.json 摘要。
- **`analyze_dependencies`**：提取 JS 文件依赖，检测缺失和循环依赖。
- **`generate_mermaid`**：将依赖数据转换为 Mermaid 流程图。

## 📦 安装

### 从 GitHub 安装

```bash
dsh plugin --profile web add github:Y1QiE079/dsh-repo-architect
```

## 🚀 使用
新建会话，确定代码仓库工作区，输入指令：分析当前仓库的架构。

Agent 会自动调用 scan_repo → analyze_dependencies → generate_mermaid，并输出一份 Markdown 报告，包含：

·项目概览

·目录结构

·模块依赖说明

·Mermaid 依赖图

·架构总结
