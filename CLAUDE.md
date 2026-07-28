# CLAUDE.md

給之後接手這個專案的 Claude（或人類）看的說明。

## 這是什麼

部隊打飯班的便當分箱計數網頁。使用情境：一個人站在打飯線上，單手拿手機，每放一個便當進保麗龍箱就按一下 `+1`，程式負責記住「現在是哪一連、第幾箱、第幾層第幾格、還差幾個」。

## 硬性限制（改動時請遵守）

1. **純 HTML / CSS / JS，不引入任何套件、框架、build step。** 使用者要求的就是這個。confetti、音效都是自己寫的，不要換成函式庫。
2. **不使用 ES modules。** 用傳統 `<script>` 依序載入 + 全域 `App` 命名空間。理由：ES modules 在 `file://` 下會被 CORS 擋掉，這樣使用者下載整個資料夾雙擊 `index.html` 也能用，不綁死在 GitHub Pages。載入順序寫在 `index.html` 最下面，有相依性。
3. **手機優先。** 主要使用情境是單手拿手機。`+1` 按鈕必須留在拇指區、觸控目標 ≥ 44px。任何改動都要確認「箱子的 24 格」和「+1 按鈕」能同時看到（見下方 `keepBoxInView`）。
4. **不可混裝。** 每個連隊獨立起箱，最後一箱可以不滿。這是使用者明確確認過的規則，不要「順手優化」成連續裝填。

## 檔案結構

```
index.html          單頁，兩個 <section>（setup / work）用 class 切換
css/style.css       全部樣式。開頭是設計 token（CSS 變數），改配色只要動那一段
js/units.js         常數（一箱 24 個 = 4 層 × 6 格）、餐別、預設單位、解析用的別名表
js/parser.js        班長訊息 → 結構化資料。純函式，不碰 state / DOM
js/state.js         狀態、localStorage、所有裝箱計算
js/effects.js       WebAudio 合成音效、震動、彩帶
js/ui.js            所有 render 與浮層
js/app.js           啟動、事件綁定、把 state 事件翻譯成提醒
sw.js + manifest.json   PWA（離線可用、可加到主畫面）
tests/parser.test.js    解析器測試，`node tests/parser.test.js`，零相依
```

## 資料模型

`localStorage` key = `amb-tracker-v1`（改結構請一併升 `version` 並處理遷移）。

```js
{
  version: 1,
  dateLabel: "7/28 (二)",
  configured: false,            // 有沒有按過「開始打飯」
  activeMeal: "dinner",         // breakfast | lunch | dinner
  activeUnitId: "zhan",
  settings: { sound, haptic, theme, vegPosition },
  units:    [ { id, name, short, order } ],
  plan:     { dinner: { zhan: { meat: 63, veg: 1 } } },   // 需求量
  progress: { dinner: { zhan: 40 } },                     // 已裝量
}
```

**衍生資料一律用純函式現算，不存進 state**（`unitStats` / `mealStats` / `dayStats`）。
箱子座標的算法都在 `state.js` 的 `unitStats()`：

```
boxIndex    = floor(packed / 24)          目前正在裝第幾箱（0-based）
packedInBox = packed - boxIndex * 24
boxCapacity = min(24, total - boxIndex*24)   最後一箱會小於 24
layer       = floor(packedInBox / 6)      0-based，UI 顯示成 1F~4F
slot        = packedInBox % 6
```

注意 `done` 的特例：打完時 `packed % 24` 可能是 0，這時 `boxIndex` 要停在最後一箱，不能往前跳一箱（否則畫面會顯示不存在的第 4 箱）。

## 事件流

`State.pack(±1)` 是唯一改變進度的入口，它回傳事件陣列，`app.js` 的 `handleEvents()` 再把事件翻成提醒：

| 事件 | 觸發時機 | 提醒 |
|---|---|---|
| `layerDone` | 剛好滿 6 的倍數（但不是滿箱、不是完成） | 該層閃一下 + 短音 + toast |
| `boxSealed` | 剛好滿 24 的倍數（但不是完成） | 全螢幕封箱卡片，1.5 秒自動關 |
| `unitDone` | 這一連打完 | 全螢幕慶祝 + 預告下一連要幾箱幾個，並自動切換 activeUnit |
| `mealDone` | 這一餐全部打完 | 彩帶 + 收工卡片 |
| `vegNext` | 下一個要放素食 | 綠色橫幅 + 目標格轉綠 + 不同音色 |

`busy` 旗標會在浮層播放期間擋掉 `+1`，避免連按疊在一起。

## 容易踩到的坑

- **`[hidden]` 會被 `display` 蓋掉。** `.sheet`、`.counter-bar`、`.veg-banner` 都有自己的 `display`，所以 `css/style.css` 開頭有一條 `[hidden] { display: none !important }`。拿掉的話設定面板會隱形但擋住整個畫面的點擊。
- **CSS animation 會蓋掉一般的 `box-shadow` 宣告。** 「下一格」的呼吸光暈是動畫，所以素食版本必須用獨立的 `@keyframes breathe-veg`，光靠 `.is-veg-pending` 的 `box-shadow` 是沒用的。
- **設定畫面的數字輸入不能觸發整表重繪**，否則游標會跳掉。`setPlan(..., quiet=true)` 只存檔不 emit，由 `app.js` 手動更新那一列的小計與總覽。
- **`ui.js` 的 `keepBoxInView()`** 只在「換連隊或換箱」時捲動，而且箱子已經完整可見時不動作。同一箱內按 `+1` 不捲，否則畫面會一直跳。
- **AudioContext 要等使用者互動才能 resume**，所以 `Effects.unlock()` 綁在第一次 pointerdown 與各個按鈕上。

## 驗證

```bash
node tests/parser.test.js          # 解析器，14 個案例
python3 -m http.server 8000        # 手動測 UI
```

改到解析器或裝箱邏輯時，最低限度要確認範例訊息算出來是 **306 個便當 / 21 箱**，且戰的晚餐是 64 個（63 葷 + 1 素）/ 3 箱、最後一箱 16 個。
