# CLAUDE.md

給之後接手這個專案的 Claude（或人類）看的說明。

## 這是什麼

部隊打飯班的便當分箱計數網頁，App 名稱是「飯飯之輩」。使用情境：一個人站在打飯線上，單手拿手機，每放一個便當進保麗龍箱就按一下 `+1`，程式負責記住「現在是哪一連、第幾箱、第幾層第幾格、還差幾個」。

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
  settings: { sound, haptic, theme, vegPosition, drinkPerCase },  // drinkPerCase 預設 24
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

## 配色與主題

`css/style.css` 開頭的 token 區有三組：`:root`（淺色）、媒體查詢版的 `[data-theme="auto"]`、
手動指定的 `[data-theme="dark"]`。**後兩組內容必須一模一樣**，改深色配色時兩邊都要動
（CSS 沒有 mixin，只能重複寫）。

深色不是把淺色調暗而已：橘（`--accent`）與綠（`--veg`）都要提亮才有對比，
底色用帶暖調的深墨綠灰而不是純灰。箱子格子的填色另外用
`--slot-fill` / `--slot-fill-ink` / `--slot-fill-ring` 定義，
**不要用 `color-mix(accent, surface)`** —— 亮橘混深底會變成濁掉的咖啡色。

## 容易踩到的坑

- **`[hidden]` 會被 `display` 蓋掉。** `.sheet`、`.counter-bar`、`.veg-banner` 都有自己的 `display`，所以 `css/style.css` 開頭有一條 `[hidden] { display: none !important }`。拿掉的話設定面板會隱形但擋住整個畫面的點擊。
- **CSS animation 會蓋掉一般的 `box-shadow` 宣告。** 「下一格」的呼吸光暈是動畫，所以素食版本必須用獨立的 `@keyframes breathe-veg`，光靠 `.is-veg-pending` 的 `box-shadow` 是沒用的。
- **設定畫面的數字輸入不能觸發整表重繪**，否則游標會跳掉。`setPlan(..., quiet=true)` 只存檔不 emit，由 `app.js` 手動更新那一列的小計與總覽。
- **`ui.js` 的 `keepBoxInView()`** 只在「換連隊或換箱」時捲動，而且箱子已經完整可見時不動作。同一箱內按 `+1` 不捲，否則畫面會一直跳。
- **AudioContext 要等使用者互動才能 resume**，所以 `Effects.unlock()` 綁在第一次 pointerdown 與各個按鈕上。
- **頂列是毛玻璃，左右要用負 margin 撐滿 app 寬度**，否則模糊會在左右內距處斷掉，看得出接縫。
  另外它的高度會隨 `env(safe-area-inset-top)` 變動，所以 `keepBoxInView()` 是量 `offsetHeight` 而不是寫死。
- **不要用 manifest 的 `display: fullscreen`。** Android 在 fullscreen 下會把瀏海／邊海區
  letterbox 成黑色，那塊在網頁視窗之外，CSS 完全改不到，看起來就是頂端多一條黑帶。
  正確做法是 `standalone` + 把 `theme-color` 塗成跟畫面最上緣同色（`--bg-grain`），
  時間電量就像浮在 App 背景上。`ui.js` 的 `syncThemeColor()` 負責跟著主題切換同步。
- **格子裡的 `<svg>` 一定要帶 `viewBox`。** 沒有的話固有尺寸是 300×150，而 `.slot` 是 grid item、
  `min-height` 預設 `auto`（＝內容高度），Safari 會讓它勝過 `aspect-ratio`，
  把整排格子撐長（Chromium 不會，所以只在 iPhone 上看得到）。`.slot` 另外設了 `min-height: 0` 雙重保險。
- **背景要畫在 `html` 上**，不能只靠 `body` 背景往上傳遞，否則安全區那塊可能不會被塗到。
- **駐地公版是「餐別區段制」**：`早餐`／`午餐`／`晚餐` 整行單獨出現時是**區段標題**
  （`MEAL_SECTION`），不是某個單位的數量。之後每一行「駐地+數量」都算給上一行那個單位。
  判斷 lead 是單位還是駐地，靠的是 `matchUnitId()` 有沒有命中 —— 所以
  **別名表不能塞會跟駐地撞名的短詞**（「八仙」就是因此從 admin 的別名移除的）。
- **同一個單位會在三個餐別區段各出現一次**，`parse()` 最後會依 `unitId` 合併成一筆。
- **教召公版是「總數制」**：沒有早／中／晚，只有一行「總數：130+1素」，要套用到三餐。
  `flush()` 會把 `total` 補進**沒有明確寫**的餐別，所以兩種寫法可以並存（明確的優先）。
  建置／召員／安管那些細項一律不採用，只認總數。
- **判斷單位標題前要先用 `stripParens()` 去掉括號註記。** 「五營（另外用沒貼連隊的保麗龍盒裝）」
  原本 17 字超過 10 字上限，不會被當成標題，結果它底下的早/中/晚數字會被灌進**上一個單位**。
  這個 bug 很安靜但很嚴重（戰的午餐會變成五營的 20）。
- **自訂單位的 id 用名稱決定（`u_五營`）**，不要用流水號。用流水號的話，
  今天的 `custom1` 是五營、明天的 `custom1` 是別的單位，資料會對到錯的地方。
- **午餐的標記字有兩個（`中` 和 `午`）**，所以「中午：15」會命中兩次。`parseMealLine()` 對
  同一餐是「相加」而不是覆蓋，「中」那段沒有數字算 0，加起來才會是正確的 15。
  改成覆蓋的話「中午」會變成 0。
- **`applyEntries()` 在日期不同時會清空 `progress`**（換日重新開始）。
  只有「新舊日期都有值且不相等」才清，訊息沒寫日期時不動進度，避免誤刪。
- **`unitStats().boxesSealed` 在打完時要等於 `boxesNeeded`**，不能用 `floor(packed/24)`。
  否則 64 個打完會顯示「2/3 箱」——最後那個沒裝滿的箱子其實已經封起來了。

## 驗證

```bash
node tests/parser.test.js          # 解析器，41 個案例
python3 -m http.server 8000        # 手動測 UI
```

改到解析器或裝箱邏輯時，最低限度要確認範例訊息算出來是 **306 個便當 / 21 箱**，且戰的晚餐是 64 個（63 葷 + 1 素）/ 3 箱、最後一箱 16 個。
