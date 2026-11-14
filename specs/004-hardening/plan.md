# 004 - Hardening: план правок для исполнителя

Дата: 2026-11-14. Основание: ревью кода на коммите `17e3eb1` (0.10.1).
Номера строк ниже верны для `17e3eb1`. Перед правкой находи место по имени функции, а не по номеру.

Исполнитель: агент без контекста прошлых сессий. Читай раздел 0 целиком до первой правки.

---

## 0. Общие правила (обязательны для каждого шага)

### 0.1 Старт

1. `git status` - дерево должно быть чистым. Если нет - остановись и сообщи владельцу.
2. `git fetch && git log --oneline -1 origin/main` - ожидается `17e3eb1`. Если main ушёл вперёд, перечитай затронутые функции перед правкой.
3. Ветка от `main`: `fix/hardening-0.10.2` (этап A). Для следующих этапов - отдельные ветки, названы в этапах.
4. Базовая линия: `npm ci && npm run verify && npm run build`. Ожидается: 715 тестов / 84 файла PASS, typecheck PASS, lint 0 ошибок и 12 предупреждений, build PASS. Запиши фактические числа в `specs/004-hardening/verification.md`. Если базовая линия красная - остановись.

### 0.2 Цикл одного шага

1. Прочитай перечисленные в шаге файлы целиком (не только указанную функцию).
2. Сначала регрессионный тест, который падает на текущем коде. Убедись, что он падает по ожидаемой причине.
3. Минимальная правка. Не трогай соседний код, форматирование, имена.
4. `npm run verify`. Число тестов может только расти. Число предупреждений lint не растёт.
5. Один шаг = один коммит. Формат как в истории: `fix: ...`, `perf: ...`, `refactor: ...`, `feat: ...`.
6. Отметь шаг `[x]` в этом файле, допиши строку в `verification.md` (что проверено, числа).

### 0.3 Запреты

- Не менять существующие тесты, чтобы они прошли. Исключение: правка импортов при переносе кода (этап D). Если старый тест падает - это сигнал, что сломано поведение.
- Не менять формат `data.json`, `positions.json`, `usage.json`, `snapshots.json` без записи в `normalize*` и теста на старом payload. Новые поля настроек - только с дефолтом в `DEFAULT_SETTINGS` и чтением через `normalizeSettings`.
- Не поднимать `VIEW_PRESET_VERSION`.
- Не менять id плагина (`graph-insight`), id команд, типы view.
- Любая новая строка интерфейса - ключ в `src/i18n/locales/en.ts` и во всех 11 остальных локалях (иначе сборка упадёт, это задумано).
- В коде, коммитах, CHANGELOG и release notes только короткий дефис. Длинные тире запрещены (в проекте есть forbidden-dash scan).
- Без явной просьбы владельца: не делать push, tag, release, не ставить сборку в vault Raincoat, не трогать `.plan*.md`.
- Не обновлять зависимости.

### 0.4 Когда остановиться и спросить

- Шаг требует правки файлов вне списка шага больше чем в 2 местах.
- Падает существующий тест, и причина не очевидна за 15 минут.
- Описание в плане не совпадает с кодом (план писался по чтению кода, без запуска в Obsidian).
- Шаг помечен `[NATIVE]` и нет доступа к живому Obsidian: реализуй, покрой unit-тестами, пометь в `verification.md` как "не проверено нативно" и не включай в релиз без проверки владельцем.

### 0.5 Порядок и релизы

| Этап | Ветка | Содержимое | Версия |
|---|---|---|---|
| A | `fix/hardening-0.10.2` | баги, малый риск | 0.10.2 |
| B | `perf/idle-render-0.10.3` | производительность | 0.10.3 |
| C | `chore/polish-0.10.4` | мелкая доводка | 0.10.4 |
| D | `refactor/graphview-split` | разбор GraphView, поведение не меняется | 0.11.0-beta.1 |
| E | по ветке на функцию | новые функции | 0.11.x, 0.12.x |

Этапы строго по порядку. Каждый этап вливается в main только после зелёного CI. Подготовка релиза (версия в `manifest.json`, `package.json`, `versions.json`, CHANGELOG, RELEASE_NOTES на английском) - отдельным коммитом в конце этапа, публикация - только по просьбе владельца.

---

## Этап A - баги (0.10.2)

### A1. Миграция физики срабатывает при каждом запуске
- [ ] Статус

**Проблема.** `src/main.ts`, `onload`: блок "Softer-links migration" и "Compactness migration" безусловно заменяет `linkStrength 0.4 -> 0.15`, `velocityDecay 0.4 -> 0.55`, `repel 50|40 -> 30`, `linkDistance 40 -> 25`, `centering 0.04|0.05 -> 0.09`. Все значения достижимы слайдерами (`ControlPanel.ts`, `physicsSlider`), поэтому выбор пользователя сбрасывается после перезапуска.

**Правка.**
1. `src/settings/schema.ts`: поле `physicsDefaultsVersion: number` в `GraphInsightSettings`, в `DEFAULT_SETTINGS` значение `0`.
2. `src/settings/normalize.ts`: чистая функция `migratePhysicsDefaults(settings): GraphInsightSettings`. Если `physicsDefaultsVersion >= 1` - вернуть как есть. Иначе применить текущие замены и выставить `1`. Константа `PHYSICS_DEFAULTS_VERSION = 1` рядом.
3. `normalizeSettings`: нечисловое или отсутствующее `physicsDefaultsVersion` читать как `0`.
4. `main.ts`: заменить inline-блок вызовом функции. Если версия изменилась - один `saveData` (можно объединить с сохранением после миграции пресетов, но не убирай существующий `saveData`).
5. Проверь `src/settings/profile.ts` (импорт профиля): импортированный профиль должен проходить ту же функцию. Профиль без поля считается старым.

**Тесты** (`normalize.test.ts`): payload без версии с `linkStrength 0.4` -> `0.15`, версия `1`; payload с версией `1` и `linkStrength 0.4, repel 50` -> значения не тронуты; значения, не равные старым дефолтам, не меняются при версии `0`.

**Риск.** Проверь, что текущие дефолты физики в `DEFAULT_3D_PANEL` не совпадают со "старыми" значениями, иначе свежая установка мигрирует сама себя. Если совпадают - остановись.

### A2. Отложенные вкладки (deferred views)
- [ ] Статус

**Проблема.** `main.ts`, `getGraphView()`: `leaf.view as GraphInsightView`. После рестарта фоновая вкладка графа - заглушка, а не экземпляр класса. `checkCallback`-команды (`export-topic-map`, все `addPanelToggle`, `toggle-follow-active-note`, `toggle-side-pane`) вызывают на ней методы и падают.

**Правка.** `return leaf?.view instanceof GraphInsightView ? leaf.view : null;`. Найди остальные приведения: `grep -rn "as GraphInsightView\|as LocalGraphView\|as InsightsView" src`. Каждое замени на `instanceof`. Команды, которые сначала зовут `activateView()` (она делает `revealLeaf`, что загружает вкладку), оставь как есть.

**Тест.** Вынеси выбор в чистую функцию (например `src/view/findGraphView.ts`: принимает массив `{ view: unknown }`, возвращает экземпляр или `null`) и покрой: пустой список, заглушка-объект, настоящий экземпляр.

### A3. Потерянное перестроение
- [ ] Статус

**Проблема.** `GraphView.rebuildGraph()`: `if (this.rebuilding) return;` - событие, пришедшее во время перестроения, теряется до следующего изменения vault.

**Правка.** Поле `private rebuildPending = false`. В ветке `if (this.rebuilding)` выставить `true` и выйти. В `finally` (только если `generation === this.rebuildGeneration && !this.closing`): если `rebuildPending` - сбросить и вызвать `this.rebuildDebounced()`. В `onClose` сбросить флаг.

**Тест.** По образцу `src/view/contentRefresh.test.ts` / `startupFailure.test.ts`: второй вызов во время незавершённого первого приводит к повторному перестроению после завершения.

### A4. Факты узлов устаревают при неизменной топологии
- [ ] Статус

**Проблема.** `rebuildGraph()`: `if (this.model && sameGraphModel(this.model, model)) return;` стоит до `buildFacts`. Теги, `mtime`, размер, счётчики открытий не обновляются, пока не изменится ссылка. Страдают цвет по тегу/давности, фильтры `tag:`, `edited:`, `opened:`, тултип.

**Правка.**
1. Перед правкой прочитай `handleMetricsResult` и выясни, как `pagerank` и `cluster` попадают в `this.facts`. Эти два поля при обновлении нужно перенести из старых фактов (id узлов не меняются, модель та же).
2. Новый метод `private refreshFacts(files: TFile[]): void`: строит свежие факты через `buildFacts(this.model, files)`, переносит `pagerank`/`cluster`, сравнивает со старыми. Если отличий нет - выход.
3. При отличиях: `this.facts = next`, затем `applyEncoding(panel)`, `recomputeVisual()`, обновление словаря (`collectVocabulary` -> `searchBar`/`filterChips`), `refreshTimelineData()`. Раскладку и метрики не перезапускать. `appliedLayoutRule = null; applyLayoutRule(...)` - только если изменились `tags` или `folder` хотя бы у одного узла.
4. В `rebuildGraph` ветку `sameGraphModel` заменить на: `{ this.refreshFacts(files); return; }`. Ветка должна остаться после проверки `this.rebuilding`.
5. Сравнение и перенос вынеси в чистый модуль (например `src/view/factsRefresh.ts`): `carryMetrics(prev, next)`, `diffFacts(prev, next) -> { changed: boolean; groupingChanged: boolean }`.

**Тесты.** Чистые функции: без изменений -> `changed false`; смена `mtime` -> `changed true, groupingChanged false`; смена тега -> оба `true`; `pagerank`/`cluster` переносятся.

**Риск.** В режиме Explore перестроение отложено (`rebuildDeferred`) - эту ветку не трогай, `refreshFacts` вызывается после неё. Focus-режим и Changes-подсветка держат id узлов, а id не меняются - их состояние не сбрасывай.

**Не входит.** Обновление счётчиков открытий сразу после `recordOpen` (без события vault). Запиши как отдельную задачу в `verification.md`, не делай здесь.

### A5. Переименование теряет позицию и пин
- [ ] Статус

**Проблема.** `buildSeedPositions` ищет прежнюю позицию по пути. Переименованная заметка стартует из центра; `restorePins` теряет её пин.

**Правка.**
1. В `GraphView.onOpen` рядом с остальными `registerEvent`: `this.app.vault.on("rename", (file, oldPath) => ...)` - для `TFile` класть в `private renamed = new Map<string, string>()` (новый путь -> старый). Если старый путь сам был значением цепочки (A -> B -> C до перестроения), сворачивай к исходному.
2. `buildSeedPositions`: при поиске `oldId` использовать `this.model.pathToId.get(this.renamed.get(node.path) ?? node.path)`. Для ветки `saved` (чтение с диска) - то же по ключу `saved.positions`.
3. `pinnedPaths`: заменить старые пути новыми по обратной карте.
4. После успешного перестроения (там, где `this.model = model`) - `this.renamed.clear()`. В `onClose` тоже.
5. Чистая функция для тестов: `resolvePreviousPath(path, renamed)` и свёртка цепочек.

**Тесты.** Одно переименование; цепочка из двух; переименование папки (несколько событий подряд); пин следует за заметкой.

**Не входит.** Переименование при закрытом графе (`positions.json` остаётся со старым путём) - зафиксируй как известное ограничение.

### A6. Сохранение при выходе из приложения
- [ ] Статус `[NATIVE]`

**Проблема.** Usage пишется с дебаунсом 30 с, позиции - дебаунсом. `onunload`/`onClose` при закрытии приложения не гарантированы. Незакрытый пункт в `specs/003-release-polish/release-readiness.md` про позиции после полного перезапуска - отсюда же.

**Правка.**
1. Сверь сигнатуру в `node_modules/obsidian/obsidian.d.ts`: `workspace.on('quit', (tasks: Tasks) => any)`, у `Tasks` есть `add(callback: () => Promise<any>)`. Если сигнатура другая - остановись.
2. `main.ts`: `this.registerEvent(this.app.workspace.on("quit", (tasks) => { tasks.add(() => this.flushUsage()); const view = this.getGraphView(); if (view) tasks.add(() => view.flushPositions()); }))`.
3. `GraphView`: публичный `flushPositions(): Promise<void>`, вызывает существующий приватный `savePositions()`.
4. **Защита от затирания.** Проверь, что возвращает `renderer.currentPositions` сразу после `setModel` до первого тика раскладки (в `setModel` создаётся нулевой `Float32Array`). Если до первого тика там нули - добавь флаг "позиции получены от раскладки хотя бы раз после `setModel`" и не сохраняй без него. Эта же защита должна действовать в `onClose` и в дебаунсе. Покрой тестом.

**Проверка `[NATIVE]`.** Открыть граф, дождаться раскладки, перетащить узел, сразу закрыть Obsidian (Cmd+Q), открыть - узел на месте. Открыть заметку на 6 с, сразу выйти - открытие учтено в `usage.json`.

### A7. Мелочи
- [ ] Статус

1. `main.ts`: команды `export-png`, `export-json`, `export-gexf` перевести на `checkCallback` (как `export-topic-map`): скрыты, пока графа нет.
2. `GraphView.notePreview`: regex фронтматтера `/^---\r?\n[\s\S]*?\r?\n---\r?\n/`. Тест на CRLF рядом с `stripMarkdown.test.ts` (вынеси снятие фронтматтера в `src/data/stripMarkdown.ts` функцией `stripFrontmatter`).

### A8. Закрытие этапа
- [ ] `npm run verify && npm run build`, числа в `verification.md`.
- [ ] Независимое ревью diff ветки против main (другой агент или владелец).
- [ ] CHANGELOG, версия 0.10.2 - отдельным коммитом. Публикация по просьбе владельца.

---

## Этап B - производительность (0.10.3)

Перед этапом сними замеры на стенде `bench/` (10k узлов): FPS при pan/zoom, время тика, и загрузку GPU/CPU на остывшем графе за 30 с. Запиши в `verification.md`. После каждого шага повтори.

### B1. Дебаунс записи настроек панели
- [ ] Статус

**Проблема.** `ControlPanel.physicsSlider`/слайдеры шлют `input` на каждый пиксель; `GraphView.buildPanel.onChange` на каждый вызывает `plugin.savePanelState` -> `saveData` всего `data.json`.

**Правка.**
1. `main.ts`: `savePanelState(panel)` делит на синхронное обновление `this.settings = { ...this.settings, panel }` и отложенную запись (`debounce(() => this.saveData(this.settings), 400, true)`). Метод по-прежнему возвращает Promise (можно сразу resolved) - вызывающие с `await` не должны сломаться.
2. Добавь `flushSettings(): Promise<void>` - немедленная запись, если есть несохранённое. Вызови в `onunload`, в обработчике `quit` (A6) и в `GraphView.onClose`.
3. Остальные `save*` методы не трогай.

**Критично.** Код в `GraphView` читает `this.plugin.settings.panel` сразу после вызова (например сравнение `next.physics !== this.plugin.settings.panel.physics` для `physicsUndo`, `updatePanelState`). Обновление в памяти обязано остаться синхронным и в прежнем порядке относительно `applyAllPanelState`.

**Тест.** 20 вызовов подряд -> одна запись; `flushSettings` пишет сразу; после вызова `settings.panel` обновлён синхронно.

### B2. Применять только изменившийся срез панели
- [ ] Статус

**Проблема.** `applyAllPanelState` на любое изменение пересчитывает encoding, оверлеи, пузыри, таймлайн.

**Правка.** `applyAllPanelState(state, prev?: PanelState)`. Если `prev` не передан - полное применение, как сейчас (перестроение графа, пресеты, `updatePanelState`, сброс). В `buildPanel.onChange` передавай прежнее состояние. Гейтить только четыре дорогих вызова, сравнивая по ссылке/значению:

| Вызов | Перезапуск, если изменилось |
|---|---|
| `applyEncoding` | `channels`, `colorPreset`, `nodeStyle`, `nodeScale` |
| `applyOverlays` | `overlays` |
| `redrawBubbles` | `showBubbles`, а также всё, что запускает `applyEncoding` |
| `syncTimelineAndTrail` | `showTimeline`, `showTrail` |

Перед правкой прочитай тела этих четырёх методов и дополни таблицу, если они читают другие поля `PanelState`. Остальные вызовы (`applyPhysics`, `applyLayoutRule`, `setLabelOptions`, `setEdgeStyle`, `apply3D`) оставь безусловными - у них свои дешёвые гварды.

**Тест.** Чистая функция `panelDiff(prev, next)` с флагами; тесты на каждую строку таблицы и на "prev отсутствует -> всё true".

### B3. Остановка рендера на скрытой вкладке
- [ ] Статус `[NATIVE]`

**Правка.** `GraphRenderer`: методы `pause()` / `resume()` -> `app.ticker.stop()` / `app.ticker.start()` (сверь API по `node_modules/pixi.js`, версия 8.19). `GraphView`: `IntersectionObserver` на `contentEl` (создан в `onOpen`, `disconnect` в `onClose`): невидим -> `pause`, видим -> `resume` + `renderer.resize()`. То же для `LocalGraphView`.

**Риск.** Раскладка в воркере продолжает слать позиции - `updatePositions` должен безопасно копить их при паузе (он пишет в буфер, это ок; проверь). После `resume` картинка обязана обновиться за один кадр.

**Проверка `[NATIVE]`.** Переключить вкладку и вернуться; свернуть боковую панель с локальным графом; разделить окно. Картинка не "замерзает".

### B4. Рендер по требованию на остывшем графе
- [ ] Статус `[NATIVE]` - самый рискованный шаг этапа, отдельный коммит, легко откатывается

**Проблема.** `app.ticker.add(() => this.renderFrame())` плюс встроенный рендер Pixi рисуют сцену каждый кадр, даже когда ничего не меняется.

**Правка.**
1. Изучи в документации Pixi 8, как отключить авто-рендер приложения, сохранив тикер (опции `autoStart`, `sharedTicker`, снятие `app.render` с тикера). Выбери способ, который не требует правок вне `GraphRenderer`.
2. Поле `private needsRender = true` и метод `invalidate()`. `renderFrame()` в конце: если `needsRender` или прошло больше 500 мс с последнего кадра - `app.render()`, сброс флага.
3. `invalidate()` вызывается: из каждого публичного сеттера рендерера; из колбэка `Viewport`; из обработчиков указателя (hover, drag, lasso); когда `smoothing`, `positionsDirty`, `edgesDirty`, `cullDirty` были истинны в этом кадре; из анимаций (trail replay, explore, полёт камеры, пины).
4. Страховка "не реже раза в 500 мс" остаётся навсегда: пропущенная инвалидация даст задержку, а не замёрзший экран.
5. Константа `RENDER_ON_DEMAND = true` в начале файла: `false` возвращает прежнее поведение одной строкой.
6. Экспорт PNG: перед `extract` принудительный рендер.

**Проверка `[NATIVE]`.** Hover, drag узла, lasso, zoom, 3D-облёт, Explore, таймлайн play, trail replay, смена темы, смена пресета, PNG. Нигде нет "залипшего" кадра. Замер простоя на остывшем графе до/после.

### B5. Ленивая загрузка снапшотов
- [ ] Статус

**Проблема.** `onload` ждёт чтения `snapshots.json`, хотя он нужен только панели изменений и захвату раз в сутки.

**Правка.** `main.ts`: `private snapshotsReady: Promise<void> | null`; метод `ensureSnapshots()` (мемоизированная загрузка). `snapshotStore` читать только после `await ensureSnapshots()`: в `maybeCaptureSnapshot` и в `GraphView.refreshChanges` (найди все обращения: `grep -rn snapshotStore src`).

**Критично.** `maybeCaptureSnapshot` без ожидания загрузки запишет историю из одного снапшота поверх существующей. Тест: захват до завершения загрузки не теряет прежние снапшоты.

### B6. Настройка чёткости (Retina)
- [ ] Статус `[NATIVE]`

**Правка.** Настройка `renderScale: "standard" | "high"`, дефолт `"standard"` (текущее поведение, 1x). `high`: `resolution: Math.min(window.devicePixelRatio, 2)`, `autoDensity: true` в `app.init`. Переключатель в `SettingsTab`, применяется через существующий `reopen()`. Проверь, что hit-test, `Viewport`, lasso и PNG-экспорт считают в CSS-пикселях.

**Проверка `[NATIVE]`.** На Retina: клик попадает в узел, lasso совпадает с курсором, PNG нужного размера, FPS на 10k.

### B7. Закрытие этапа
- [ ] Замеры до/после в `verification.md`, verify/build, ревью, CHANGELOG 0.10.3.

---

## Этап C - доводка (0.10.4)

### C1. Lint до нуля предупреждений
- [ ] `GraphView.ts` (4 предупреждения `prefer-create-el`): заменить на `createFragment()` / `createEl("button")`. Не использовать `--fix` на весь проект - только эти 4 места, вручную.
- [ ] `eslint.config.mjs`: блок для `src/test/**/*.ts` с `"obsidianmd/prefer-create-el": "off"` (тестовые заглушки сами реализуют `createEl`).

### C2. Новые заметки появляются рядом с соседом
- [ ] Статус

`buildSeedPositions`: узел без прежней позиции сейчас получает `(id % 20) - 10`. Прочитай `src/workers/layoutSeed.ts` и `src/util/seededRandom.ts`. Чистая функция: для узла без позиции - среднее позиций уже размещённых соседей плюс детерминированный сдвиг (seed от id); нет размещённых соседей - прежняя формула. Применять только когда есть `previous` или `saved` (первый запуск не трогать). Тесты: с соседом, без соседа, детерминизм.

### C3. Reduced motion
- [ ] Статус

Помощник `prefersReducedMotion()` (`matchMedia`). При `true`: полёт камеры (`src/explore/cameraFlight.ts`) мгновенный, trail replay рисует сразу итог, автопроигрывание таймлайна не меняется. В `styles.css` блок `@media (prefers-reduced-motion: reduce)` отключает transition/animation внутри `.graph-insight-container`. Тест на чистые функции с подменой флага.

### C4. fundingUrl
- [ ] `manifest.json`: `fundingUrl` со ссылкой Ko-fi из README (скопируй точный URL из README, не придумывай).

### C5. Popout-окна
- [ ] Статус `[NATIVE]`

**Проблема.** `GraphView`: `registerDomEvent(document, "keydown", ...)`; `GraphRenderer`: `window.addEventListener("pointermove"|"pointerup")`, `window.requestAnimationFrame`, `getComputedStyle(document.body)`.

**Правка.** Использовать окно и документ хоста: `host.win` / `host.doc` (хелперы Obsidian на элементах; сверь в `obsidian.d.ts`). При переносе вкладки в другое окно (`containerEl.onWindowMigrated`, сверь наличие в типах) - вызвать существующий `reopen()`: WebGL-контекст не переживает смену окна. Подписки на старое окно снять.

**Проверка `[NATIVE]`.** Вынести граф в отдельное окно: Esc, клавиши Explore, drag узла за пределы канваса, тултип, возврат вкладки обратно.

### C6. Закрытие этапа
- [ ] verify/build, lint 0 предупреждений, ревью, CHANGELOG 0.10.4.

---

## Этап D - разбор GraphView.ts (0.11.0-beta.1)

Цель: 2838 строк -> оркестратор плюс контроллеры. **Поведение не меняется ни на байт.**

Правила этапа:
- Только перенос кода. Никаких исправлений, переименований, "заодно улучшил".
- Один контроллер = один коммит. После каждого - verify + build.
- Существующие тесты не правятся, кроме путей импорта.
- Контроллер получает зависимости через узкий интерфейс (по образцу `src/explore/ExploreController.ts`, `src/pilot/PilotController.ts`), а не ссылку на весь `GraphView`.
- Если перенос требует изменить логику - не переноси этот кусок, оставь заметку.

Порядок (от самого изолированного):
- [ ] D1. Экспорт: `exportPngFile`, `exportJsonFile`, `exportGexfFile`, `exportCurrentTopicMap`, `createTopicMapFile`, `downloadBlob` -> `src/view/exportActions.ts`.
- [ ] D2. Меню: `showNodeMenu`, `showLassoMenu`, `showTasksMenu`, `showOverflowMenu` -> `src/view/menus.ts`.
- [ ] D3. Открытие заметок: `openNode`, `openNodeInSplit`, `revealNode`, `nodeFile`, `fileExplorer`, `asFileExplorer`, `leafId` -> `src/view/noteNavigation.ts`.
- [ ] D4. Пресеты и задачи: `savePreset`, `persistPresets`, `markPresetUsed`, `openPresetManager`, `applyViewPreset`, `saveViewPreset`, `deleteViewPreset`, `runTask`, `runTaskPreset` -> `src/view/presetActions.ts`.
- [ ] D5. Панель изменений: `toggleChangesPanel` ... `focusChangesLink` -> `src/view/changesController.ts`.
- [ ] D6. Тултип и превью: `showTooltip`, `appendNotePreview`, `notePreview` -> `src/view/tooltip.ts`.
- [ ] D7. Explore-обвязка в view (`enterExplore` ... `renderExploreBar`) - последним и только если D1-D6 прошли без сюрпризов.

Закрытие: полный нативный маршрут проверки из `specs/003-release-polish/release-readiness.md`, выпуск как beta через BRAT.

---

## Этап E - новые функции

Каждая функция - отдельная ветка, отдельная спецификация через Spec Kit (`specs/005-...`, как 001-003), отдельный релиз. Новая функция по умолчанию не меняет вид графа у существующих пользователей.

### E1. Состояние вкладки переживает рестарт
- [ ] `GraphView.getState()/setState()`: камера (центр, масштаб, 3D-поворот), активный hard-запрос. Данные в workspace.json, не в `data.json`. `setState` с неизвестными/битыми полями игнорирует их. Автофит (`autoFit.request()`) не должен перебивать восстановленную камеру.

### E2. Штатное hover-превью Obsidian
- [ ] `registerHoverLinkSource(GRAPH_INSIGHT_VIEW_TYPE, ...)` плюс `workspace.trigger("hover-link", ...)` при наведении с Cmd/Ctrl. Свой тултип остаётся. Сверь форму payload по `obsidian.d.ts` и по поведению core-графа.

### E3. Свойства frontmatter как метрика и фильтр
- [ ] Поле в `NodeFacts` (карта выбранных свойств), оператор `prop:key=value` в `src/query/QueryParser.ts`, категориальный канал цвета. Затрагивает `encoding/metrics.ts`, `metricLabels.ts`, 12 локалей. Опирается на A4 (обновление фактов).

### E4. Вложения и несуществующие заметки как узлы
- [ ] Два тумблера, оба выключены по умолчанию. Меняет `buildGraphModel` (`src/data/GraphStore.ts`) - самый широкий по охвату пункт: метрики, оверлеи, экспорт, локальный граф. Делать последним. Узлам нужен признак вида (`kind: "note" | "attachment" | "unresolved"`), весь существующий код должен продолжать видеть только заметки, пока тумблеры выключены (тест: модель при выключенных тумблерах идентична нынешней).

### E5. Подача в Community Plugins
- [ ] Действие владельца. Агент готовит: проверка README и manifest по актуальным требованиям obsidian-releases, текст PR. Сам PR - только по просьбе владельца.

---

## Известные ограничения плана

- План составлен по чтению кода и запуску lint. Тесты и Obsidian при ревью не запускались.
- Пункты с `[NATIVE]` нельзя считать готовыми по одним unit-тестам.
- Не входит: обновление счётчиков открытий в графе сразу после открытия заметки; переименование при закрытом графе; мобильная поддержка.
