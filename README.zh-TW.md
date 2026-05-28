# Decks ![Downloads](https://img.shields.io/github/downloads/dscherdi/decks/total) ![Downloads Latest](https://img.shields.io/github/downloads/dscherdi/decks/latest/total?style=flat-square) ![Release](https://img.shields.io/github/v/release/dscherdi/decks)

[English](./README.md) · [Deutsch](./README.de.md) · [Español](./README.es.md) · [Français](./README.fr.md) · [Italiano](./README.it.md) · [Русский](./README.ru.md) · [Türkçe](./README.tr.md) · [Shqip](./README.sq.md) · [العربية](./README.ar.md) · [हिन्दी](./README.hi.md) · [中文](./README.zh.md) · **繁體中文** · [日本語](./README.ja.md)

**將您的 Obsidian 筆記變成閃卡 (Flashcards)。無需特殊語法，無需建立單獨的牌組。**

只需用 `#decks` 標記一個檔案。每個 `##` 標題都會變成卡片的正面；其下方的文字會變成背面。表格、圖片遮罩 (Image occlusion) 和 `==填空==` (Cloze) 也能以同樣的方式運作。卡片複習排程由 FSRS-6 —— 現代的間隔重複演算法來處理。

![Demo](./decks_showcase.gif)

[Discord](https://discord.com/channels/686053708261228577/1497268419861418035) · [版本說明](./release-notes/) · [贊助我一杯咖啡](https://www.buymeacoffee.com/dscherdil0)

## 為什麼選擇 Decks

- **您的筆記就是牌組。** 標記一個檔案，所選層級的每個標題都會變成正面，其下方的文字變成背面。如果您習慣使用 Anki，那麼在這裡您不需要重複編寫兩次。
- **四種格式，無需學習語法。** 標題、雙列表格、圖片遮罩以及您已經在使用的 `==填空==` 標記。
- **FSRS 原生排程。** 三種設定檔（標準 / 高強度 / 經過訓練），可按標籤設定記憶留存率目標，徹底告別舊版 SM-2 演算法。
- **演算法微調。** 一鍵最佳化工具可根據您自己的複習歷史訓練 FSRS 權重 —— 為您的遺忘曲線提供更好的複習排程，全部在本地端完成。
- **真正的多裝置同步。** 資料庫透過 iCloud/Dropbox 自動合併 —— 在手機和電腦上複習，絕不遺失歷史記錄。
- **專為行動裝置打造。** 觸控最佳化的複習介面，適配安全區域 (safe-area)，每天都在手機上進行測試。

## 60秒快速入門

1. 從社群外掛程式中安裝 **Decks** 並啟用。
2. 打開任意筆記。在其 frontmatter 或內文中新增 `#decks` 標籤。
3. 寫一個 `##` 標題，然後在其下方寫一段內文。需要多少張卡片就重複多少次：

   ```markdown
   ---
   tags: [decks/english]
   ---

   ## "Hola" 是什麼意思？

   你好 (Hello)。

   ## 怎麼用英文說 "謝謝"？

   Thank you.
   ```

4. 點擊側邊欄中的 **大腦圖示** 打開 Decks 面板。點擊您的檔案以開始複習。

檔案名稱將成為牌組名稱。卡片會在您儲存筆記時自動同步。

## 卡片格式

Decks 支援四種編寫卡片的方式。選擇最適合您記錄筆記習慣的一種。

<details>
<summary><b>標題 + 段落</b> — 預設格式。所配置層級（預設 H2）的每個標題都是正面，內文下方是背面。</summary>

```markdown
---
tags: [decks/english]
---

## "Hola" 是什麼意思？

你好。

## 怎麼用英文說 "謝謝"？

Thank you.
```

檔案名稱即為牌組名稱。標題層級可以按設定檔進行更改（預設 H2）。高於所配置層級的標題不會變成卡片 —— 它們會作為麵包屑路徑（例如 `第 1 章 > 第 2 節`）附加到每張卡片上以提供上下文。

</details>

<details>
<summary><b>表格</b> — 雙列 Markdown 表格，帶有一個選填的筆記欄。</summary>

```markdown
## 核心概念

| 問題             | 答案                   |
| ---------------- | ---------------------- |
| 什麼是光合作用？ | 植物用來轉化陽光的過程 |
| 解釋一下重力     | 吸引物體相互靠近的力   |
```

- 第一欄 = 正面，第二欄 = 背面。標題列將被忽略。
- 表格必須直接位於標題下方（內部不能有其他段落）。
- 新增第三個「筆記」欄，用於在複習期間透過按 **N** 鍵切換顯示的提示或記憶法。

</details>

<details>
<summary><b>填空 (Cloze)</b> — 使用 <code>==文字==</code> 語法來挖空。</summary>

```markdown
## 太陽系

==太陽==是我們太陽系中心的恆星。距離最近的行星是==水星==，最大的行星是==木星==。
```

每個標記的部分都會成為一張獨立的卡片。在複習時，活動的填空將顯示為 `[...]`；點擊即可顯示。填空也可以在表格儲存格內運作。預設為啟用。

</details>

<details>
<summary><b>圖片遮罩 (Image occlusion)</b> — 一張圖片加上一個編號列表。圖片上的數字對應到列表中。</summary>

```markdown
## 手臂骨骼

![[arm_bones.png]]

1. ==肱骨==
2. ==橈骨==
3. ==尺骨==
```

列表中的每個項目都是一張卡片。圖片（帶有數字標籤）顯示在正面；對應的項目在背面被挖空。

</details>

### Canvas 牌組

在 Obsidian Canvas (`.canvas`) 檔案中編寫卡片，而非 Markdown 檔案。已設定資料夾中的每個 canvas 都會成為一個牌組；每個文字節點都會以上述相同的四種卡片格式進行解析。透過 **設定 → Canvas 牌組** 設定：資料夾與標籤（預設 `#decks/canvas`）。在複習中點選「前往來源」會開啟 canvas 並聚焦到來源文字節點。首次安裝（或升級）時，會在 `Canvas decks/` 資料夾中自動建立一份 `Decks — Canvas 入門.canvas`。

**空間卡片（Spatial cards）**：用連線連接文字節點，每條連線都會變成一張卡片——起始節點是正面（問題），終點節點是反面（答案），連線上的標籤作為提示。支援鏈式連接（A → B → C）、一對多、多對一；未連接的節點仍按上述四種格式解析。詳情請見 **[docs/CANVAS_DECKS.md](docs/CANVAS_DECKS.md)**。

![Canvas Spatial Cards Demo](./canvas_spatial_cards_demo.gif)

## 個人化排程

FSRS 附帶了開箱即用的合理預設設定。一旦您累積了約 100 次複習記錄，就可以根據您自己的複習歷史來訓練演算法的 21 個權重，並獲得為您特定遺忘曲線量身打造的卡片排程 —— 這與 Anki 電腦版的作用一樣，但完全在本地端運行，沒有伺服器，也沒有資料遙測。

## 版本說明與支援

- 每次更新的 **版本說明** 可以在 [`release-notes/`](./release-notes/) 中找到。
- **在 Discord 上討論** — [加入伺服器](https://discord.com/channels/686053708261228577/1497268419861418035)。
- **支持開發** — [贊助我一杯咖啡](https://www.buymeacoffee.com/dscherdil0)。
- **翻譯指南** - [翻譯指南](./docs/TRANSLATING.md)。

## 授權

參見 [LICENSE](./LICENSE)。

---

> 本翻譯為草稿 — 歡迎母語使用者提交 Pull Request。
