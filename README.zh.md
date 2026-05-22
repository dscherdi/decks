# Decks ![Downloads](https://img.shields.io/github/downloads/dscherdi/decks/total) ![Downloads Latest](https://img.shields.io/github/downloads/dscherdi/decks/latest/total?style=flat-square) ![Release](https://img.shields.io/github/v/release/dscherdi/decks)

[English](./README.md) · [Deutsch](./README.de.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Italiano](./README.it.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Shqip](./README.sq.md) · [العربية](./README.ar.md) · [हिन्दी](./README.hi.md) · **中文** · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md)

**将您的 Obsidian 笔记变成抽认卡（Flashcards）。无需特殊语法，无需建立单独的牌组。**

只需用 `#decks` 标记一个文件。您写的每一个标题都会变成卡片的正面；下方的内容都会变成背面。表格、图片遮挡和 `==填空==` 高亮显示也能以同样的方式工作。卡片复习调度由 FSRS —— 现代间隔重复算法来处理。

![Demo](./decks_showcase.gif)

[Discord](https://discord.com/channels/686053708261228577/1497268419861418035) · [版本说明](./release-notes/) · [赞助我一杯咖啡](https://www.buymeacoffee.com/dscherdil0)

## 为什么选择 Decks

- **您的笔记就是牌组。** 标记一个文件，每个标题都会变成正面，每个段落变成背面。如果您习惯使用 Anki，那么在这里您不需要重复编写两次。
- **四种格式，无需学习语法。** 标题、双列表格、图片遮挡以及您已经在使用的 `==填空==` 高亮。
- **FSRS 原生调度。** 三种配置文件（标准 / 强化 / 已训练），可按标签设定记忆保留目标，彻底告别旧版 SM-2 算法。
- **算法微调。** 一键优化器可根据您自己的复习历史训练 FSRS 权重 —— 为您的遗忘曲线提供更好的复习调度，全部在本地客户端完成。
- **真正的多设备同步。** 数据库通过 iCloud/Dropbox 自动合并 —— 在手机和桌面上复习，绝不丢失历史记录。
- **专为移动端打造。** 触控优化的复习界面，适配安全区域 (safe-area)，每天都在手机上进行测试。

## 60秒快速入门

1. 从社区插件库安装 **Decks** 并启用。
2. 打开任意笔记。在其 frontmatter 或正文内联标签中添加 `#decks`。
3. 写一个标题，然后在其下方写一段正文。需要多少张卡片就重复多少次：

   ```markdown
   ---
   tags: [decks/english]
   ---

   # "Hola" 是什么意思？

   你好 (Hello)。

   # 怎么用英语说 "谢谢"？

   Thank you.
   ```

4. 点击侧边栏中的 **大脑图标** 打开 Decks 面板。点击您的文件。开始复习。

文件名将成为牌组名称。卡片会在您保存笔记时自动同步。

## 卡片格式

Decks 支持四种编写卡片的方式。选择最适合您记录笔记习惯的一种。

<details>
<summary><b>标题 + 段落</b> — 默认格式。每个标题都是正面，正文下方是背面。</summary>

```markdown
---
tags: [decks/english]
---

# "Hola" 是什么意思？

你好。

# 怎么用英语说 "谢谢"？

Thank you.
```

文件名即为牌组名称。标题级别可以按配置文件进行更改。

</details>

<details>
<summary><b>表格</b> — 两列 Markdown 表格，带有一个可选的笔记列。</summary>

```markdown
## 核心概念

| 问题             | 答案                   |
| ---------------- | ---------------------- |
| 什么是光合作用？ | 植物用来转化阳光的过程 |
| 解释一下重力     | 吸引物体相互靠近的力   |
```

- 第一列 = 正面，第二列 = 背面。表头行将被忽略。
- 表格必须直接位于标题下方（内部不能有其他段落）。
- 添加第三个“笔记”列，用于在复习期间通过按 **N** 键切换显示的提示或记忆法。

</details>

<details>
<summary><b>填空 (Cloze)</b> — 使用 <code>==文本==</code> 高亮语法来挖空。</summary>

```markdown
## 太阳系

==太阳==是我们太阳系中心的恒星。距离最近的行星是==水星==，最大的行星是==木星==。
```

每个高亮都会成为一张独立的卡片。在复习时，活动的填空将显示为 `[...]`；点击即可显示。填空也可以在表格单元格内工作。每个配置文件支持两种上下文模式（隐藏或显示其他填空）。默认启用。

</details>

<details>
<summary><b>图片遮挡</b> — 一张图片加上一个编号列表。图片上的数字映射到列表中。</summary>

```markdown
## 手臂骨骼

![[arm_bones.png]]

1. ==肱骨==
2. ==桡骨==
3. ==尺骨==
```

列表中的每个项目都是一张卡片。图片（带有数字标签）显示在正面；匹配的项目在背面被挖空。由于它建立在填空功能之上，因此配置文件中必须启用填空功能。

</details>

<details>
<summary><b>更多：标题格式，翻转卡片，单卡标签</b></summary>

**标题格式** — 文件名成为正面，整个文件成为背面。在您的配置文件中将“标题”设置为标题级别。

**翻转卡片** — 将 `reverse: true` 添加到文件的 frontmatter 中，以自动生成每张卡片的翻转副本。复习进度按方向分别跟踪。

**单卡标签** — 直接在标题中添加 `#标签`（例如，`## 什么是光合作用？ #植物 #高中`）。标签会从显示的正面剥离，在复习期间作为标签片显示，并可由表格行和翻转卡片继承。利用它可以建立“过滤牌组”，将整个库中包含特定标签的所有卡片提取出来。

</details>

### Canvas 牌组

在 Obsidian Canvas (`.canvas`) 文件中编写卡片，而不是 Markdown 文件。已配置文件夹中的每个 canvas 都会成为一个牌组；每个文本节点都会按照上述相同的四种卡片格式进行解析。在 **设置 → Canvas 牌组** 中配置：文件夹和标签（默认 `#decks/canvas`）。复习中点击「跳转到源」会打开 canvas 并聚焦到源文本节点。首次安装（或升级）时会在 `Canvas decks/` 文件夹中自动创建一份 `Decks — Canvas 入门.canvas`。详情见 **[docs/CANVAS_DECKS.md](docs/CANVAS_DECKS.md)**。

## 个性化调度

FSRS 附带了开箱即用的合理默认设置。一旦您积累了约 100 次复习记录，就可以根据您自己的复习历史来训练算法的 21 个权重，并获得为您特定遗忘曲线量身定制的卡片调度安排 —— 这与 Anki 桌面版的作用一样，但完全在本地客户端运行，没有服务器，也没有数据遥测。

## 版本说明与支持

- 每次更新的 **版本说明** 都可以在 [`release-notes/`](./release-notes/) 中找到。
- **在 Discord 上讨论** — [加入服务器](https://discord.com/channels/686053708261228577/1497268419861418035)。
- **支持开发** — [赞助我一杯咖啡](https://www.buymeacoffee.com/dscherdil0)。
- **翻译指南** - [翻译指南](./docs/TRANSLATING.md)。

## 许可证

参见 [LICENSE](./LICENSE)。

---

> 本翻译为初稿 — 欢迎母语使用者提交 Pull Request。
