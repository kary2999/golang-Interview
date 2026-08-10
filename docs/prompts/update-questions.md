<!-- [skill: go-team-standards · dev-dna] 提供可复制的题库更新审查提示词 -->
# 更新题库提示词

复制下面整段给维护本仓库的 AI：

> 你正在维护 Golang Interview 离线题库。先阅读 `AGENTS.md`、`docs/CONTENT-SOURCES.md`、`docs/AI-MAINTENANCE.md`、现有提取/构建脚本和测试，再说明本次内容来源、修改范围与来源标签判断。
>
> 必须先审查来源和可追溯性：不要复制原始文章或 `_files` 目录进仓库，不要把无法确认来源的文字标成 `zhihu-archive`。ID 73、89、90 是 `supplemented`，不得冒充源文章内容；其他记录的标签也不得在无证据时改变。除明确要求外，不要静默事实改写全部 97 条导入答案。
>
> 保持数据契约：恰好 100 条，ID 按 1..100 排列且唯一；`question` 与 `answerHtml` 非空；`promptHtml` 可选，用于答案揭晓前必须可见的题目代码或示例；`source` 只能是 `zhihu-archive` 或 `supplemented`。如果题干出现“下面这句代码”“如下代码”等指代，必须确认对应内容位于 `promptHtml`，不能藏进 `answerHtml`。两类 HTML 都只能使用提取器允许的安全标签和合法 code 语言类，禁止脚本、事件属性、样式、远程资源或可执行内容。
>
> 不要手改 `data/questions.js`。先为新行为或新边界写测试并观察预期失败，再修改 `scripts/extract_questions.py` 或 `scripts/build_questions.py`，用本地源文件重新生成确定性数据。不要把题库移入 `index.html`，也不要引入第三方依赖或运行时网络请求。
>
> 完成后运行并原样报告：
>
> ```bash
> python3 -m unittest discover -s tests -v
> node --test tests/test_app.js
> python3 scripts/verify_project.py
> node --check assets/app.js
> ```
>
> 最终列出来源证据、变更题号、每条 provenance 判断、RED/GREEN 结果、生成命令、完整验证结果和仍未核实的内容。不得在未运行命令时声称通过。
