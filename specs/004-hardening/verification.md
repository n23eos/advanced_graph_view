# 004 - Проверки hardening

Дата: 2026-11-14. База: origin/main 17e3eb1. Ветка: fix/hardening-0.10.2.

## Старт

- Исходная папка: codex/release-polish, только пользовательский untracked specs/004-hardening/plan.md. Она сохранена без изменений.
- Реализация изолирована в чистом worktree advanced_graph_view-hardening от origin/main. Локальный main отставал на один коммит, не изменялся.
- npm ci, npm run verify, npm run build: PASS. 715 тестов / 84 файла; lint 0 ошибок, 12 предупреждений; typecheck/build PASS.
- Зависимости не изменены; в lockfile обновлена только корневая версия при подготовке 0.10.2. Паттерн \!notes/ присутствует.
- Этапы строго последовательны. Push/merge/release/установка в Raincoat не разрешены; переход через CI и нативную приёмку фиксируется отдельно.

## Ход работы

- A1: завершён. Миграция версионирована, сохранение объединено с миграцией пресетов. Импорт/экспорт профиля переносит версию; старый профиль мигрирует. DEFAULT_3D_PANEL не содержит старых значений. RED: 10 ожидаемых падений / 1 PASS. GREEN: verify PASS, 726 тестов / 85 файлов, lint 12 предупреждений, typecheck PASS. Старые тесты сохранены.

- A2: завершён. Команды выбирают настоящий экземпляр, в том числе после deferred leaf. Других приведений view в src нет; local export уже использует instanceof. RED: 2 FAIL / 2 PASS; verify PASS, 730 тестов / 86 файлов, lint 12 предупреждений.

- A3: завершён. События во время перестроения объединяются в один повтор; закрытие отменяет очередь. RED: 2 FAIL. verify PASS, 732 теста / 87 файлов, lint 12 предупреждений.

- A4: завершён. Факты обновляются без смены модели и запуска раскладки/метрик; pagerank/cluster сохраняются, regroup только для tags/folder. Неинициализированные факты ждут полного build. RED интеграции: 2 FAIL / 3 PASS. verify PASS, 747 тестов / 88 файлов, lint 12 предупреждений. Отдельная будущая задача: обновлять opens сразу после recordOpen без события vault.

- A5: завершён. Живые/сохранённые позиции и пины следуют за путём, цепочки сворачиваются. RED: 3 FAIL интеграции. verify PASS, 755 тестов / 89 файлов, lint 12 предупреждений. Дополнение плана: вместо безусловного clear потребляются только применённые rename; события во время await переназначаются на установленную модель. Тест проверяет эту гонку. Ограничение: rename при закрытом графе не мигрирует positions.json.

- A6: код и unit завершены. Сигнатура quit/Tasks.add совпала с планом в obsidian.d.ts. RED: 4 FAIL / 8 PASS. verify PASS, 759 тестов / 90 файлов, lint 12 предупреждений. До первого layout frame savePositions не пишет; guard общий для quit, debounce и onClose, сбрасывается при setModel. Нативно пока не проверено.

- A7: завершён. Три export команды скрыты без загруженного view, CRLF frontmatter исключается из preview. RED: 6 FAIL / 2 PASS. verify/build PASS, 765 тестов / 91 файл, lint 12 предупреждений.

- Независимое ревью A8 (routing_reviewer): найдены две P1 гонки. Обе воспроизведены: 5 новых интеграционных FAIL. Исправлено: remap путей/пинов при сохранении до rebuild; per-file очередь с объединением ожидающих снимков, flush ждёт текущую и последнюю запись. Дополнительно 2 проверки очереди. verify/build PASS: 772 теста / 92 файла, lint 12 предупреждений. Все тесты базы 17e3eb1 неизменны.
- Browser QA: адаптеру bench/ui/app.ts добавлен vault.on для новой подписки rename. Стенд загружается с реальным renderer/workers, фильтр tag:graph на 42 заметках работает.
- Native QA, Obsidian 1.13.7: создан отдельный vault /Users/nickeo23/.codex/tmp/graph-hardening-qa-20261114, владелец разрешил Trust author/enable plugins. Raincoat не обновлялся. На сборке до review fixes подтверждены отрисовка, перезапуск, запись перемещённых координат сразу после drag + Cmd+Q; Alpha opens=1 записан после 6 секунд перед Cmd+Q, раньше 30-секундного debounce. На финальной сборке подтверждён запуск графа и наличие PNG/JSON/GEXF команд после загрузки view; у deferred view они отсутствуют. Повторная проверка drag + quit после review fixes не завершена: CUA перестал надёжно направлять ввод в тестовое окно. Точное восстановление позиции после полного перезапуска остаётся нативной приёмкой владельца; публикация заблокирована до неё.

- A8, финальный запуск после версии 0.10.2: verify/build PASS, 772 теста / 92 файла; typecheck PASS, lint 0 ошибок / 12 прежних предупреждений. diff --check и проверка новых строк на запрещённые тире PASS; старые тесты неизменны.

- Повторное независимое ревью commit 028b2ab: обе P1 закрыты, новых замечаний нет; 22 целевых теста / 3 файла PASS, git show --check PASS.

## Следующий шаг

A и B завершены локально. Кандидат 0.10.3: ef01500. Ветка C: chore/polish-0.10.4, C1-C4 реализованы и проверены. Следующий шаг: получить ответ по расширению C5 согласно 0.4 плана, затем продолжить C5, C6, D и E. Mac заблокирован, запрошена ручная разблокировка для финальных native сценариев. CI и публикация не выполнялись. Разрешение владельца на локальные зависимые ветки без push/merge действует.

## Этап B

- B0: стенд расширен 30-секундным idle sample с числом реальных render и JS временем render/ticker. Эти времена не являются процентом CPU/GPU; изолированное потребление GPU недоступно в имеющемся API. Первый исходный прогон на 10k: активная раскладка 49.3 FPS, таймаут 30 с, 144 ticks; baseline среды не достигает порога 50 FPS. Замеры фиксируются как есть.

### B: замеры 10k в Chrome

Методика: bench/bench.ts, 10000 узлов / 29956 рёбер, 4 с layout/pan/zoom, 30 с idle после stop worker и 2 с ожидания smoothing. Render JS и tick JS измеряют время выполнения JS вызовов, а не GPU или процент загрузки CPU. Idle FPS измеряет rAF, не количество отрисовок. Во всех прогонах сохранён порог 50 FPS; baseline его не проходит. Раскладка не успела остыть за 30 с и остановлена стендом, поэтому idle относится к статической сцене после stop.

| Шаг | Layout FPS | Pan FPS | Zoom FPS | Tick median/p95, мс | Idle renders / 30 с | Render JS, мс | Tick JS, мс | Ошибки |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| До B | 39.1 | 19.4 | 20.1 | 187.4 / 358.8 | 1788 | 697.6 | 4.2 | 0 |

- Уточнение владельца 2026-11-14: разрешено расширять API-заглушки старых тестов без изменения их проверок. Это исключение из раздела 0.3 касается новых обязательных методов, включая flushSettings и app.render.
- B1: RED 6/6 -> GREEN 6/6 новых регрессий, 50/50 targeted старых и новых. Память обновляется синхронно, запись панели отложена на 400 мс. Общая очередь saveData защищает от гонки с немедленными сохранениями остальных настроек. Flush при quit/unload/onClose ждёт все записи; ошибка сохраняет dirty для повтора. Старые fixtures расширены, assertions сохранены.

- B1: изолированная копия staged tree, verify/build PASS: 778 тестов / 93 файла, lint 12 предупреждений. Это проверка именно B1, без параллельных подготовительных файлов B2/B3/B6.
- B1 benchmark: layout 29.7 FPS, pan 17.1, zoom 16.5; worker interval median/p95 171.2/376.2 мс; idle 1767 render/30 с, render JS 1341.8 мс, tick JS 5.5 мс, ошибок 0. Bench не включает plugin/settings, поэтому B1 не меняет исполняемый код стенда. На разброс влияют фоновые проверки; этот прогон не доказывает регрессию от B1.

- B2: таблица зависимостей подтверждена чтением методов. Чистый panelDiff: 10 новых тестов; integration RED 2 FAIL / 1 PASS до wiring. Предыдущее состояние захватывается до savePanelState, четыре дорогих эффекта gated; полное применение presets/rebuild и остальные вызовы сохранены.
- B2: изолированный staged verify/build PASS, 791 тест / 95 файлов, lint 12 прежних предупреждений. Повтор benchmark запущен; код standalone renderer/worker в B2 не меняется.

- B3: Pixi 8.19 source/TickerPlugin и Context7 подтверждают ticker.stop/start. Visibility observer подключён после успешного init в обеих views и отключается до первого await в close. Поздние callbacks игнорируются. Worker продолжает работу; скрытый renderer принимает последние координаты для save/autoFit, resume обновляет projection. 16 новых тестов с RED до реализации, нативно пока не проверено.

- B2 benchmark: layout 28.2 FPS, pan 16.8, zoom 16.5; worker interval 184.8/367.9 мс; idle 1754 render/30 с, render JS 2127.7 мс, tick JS 14.3 мс, ошибок 0. Исполняемые renderer/worker неизменны относительно B0; фоновая нагрузка не изолирована.
- B3: изолированный staged verify/build PASS, 807 тестов / 99 файлов, lint 12 прежних предупреждений.

- B3 benchmark: layout 33.1 FPS, pan 13.5, zoom 17.4; worker interval 180.4/427.3 мс; idle 1793 render/30 с, render JS 859.3 мс, tick JS 5.8 мс, ошибок 0. Стенд постоянно видим и не создаёт Obsidian views, поэтому эффект скрытия этим прогоном не измеряется.

- B3 native: сборка dba1b54 установлена только в разрешённый тестовый vault, 3 runtime-файла сверены хешами. Главная вкладка скрывается и возвращается; тег изменён в фоне, после возврата tag:fresh показывает 1 из 3. Локальный граф в боковой панели отрисован, collapse/expand возвращает изображение. Разделение основной области и перенос окна отдельно пока не проверены.
- B4: убран штатный app.render из ticker по точной паре function/context. Ручной draw после обновления сцены, инвалидации всех визуальных mutators, запасной кадр 500 мс, RENDER_ON_DEMAND для отката. PNG обновляет сцену даже при pause. Одинаковый Explore overlay не поддерживает draw loop. RED 25 ожидаемых падений; финально 29 новых регрессий, 54/54 targeted PASS. В старом PNG тесте только render API stubs, assertions сохранены.
- B4: изолированный staged verify/build PASS, 836 тестов / 100 файлов, lint 12 прежних предупреждений. Pixi Ticker настоящий в тесте регистрации callbacks; GPU заменён заглушкой, jsdom getContext сообщение не является проверкой WebGL.

- B5: onload не читает историю; ensureSnapshots объединяет загрузку, неудачу можно повторить. Capture ждёт готовность до чтения/записи; resetSnapshots инвалидирует поздний read и ждёт активную запись перед удалением. Changes ждёт историю только при первом обращении, затем сохраняет синхронный loaded path; generation guard отменяет устаревшие результаты. SettingsTab reset подключён к resetSnapshots. RED: 6 исходных FAIL, затем отдельная retry регрессия 1 FAIL, view integration 2 FAIL. GREEN: 7 main + 2 view новых теста, существующий period-race test сохранён (fixture дополнен snapshotsLoaded).
- B5: изолированный staged verify/build PASS, 845 тестов / 102 файла, lint 12 прежних предупреждений.

- B4 benchmark: layout 27.2 FPS, pan 16.6, zoom 16.8; worker interval 194.2/378.7 мс. Idle: 59 render/30 с вместо 1788 baseline, render JS 19.0 мс, tick JS 37.9 мс (теперь включает ручной render, складывать эти времена нельзя). Ошибок 0; две остановки вкладки при zoom, исключены стендом из FPS. Порог 50 FPS не пройден, baseline тоже не проходил. Снижение числа draw подтверждено; ускорение pan/zoom не заявляется.
- B6: renderScale standard/high с normalize старых/битых payload, default standard1x; high берёт DPR окна хоста с пределом2 и autoDensity. 12 локалей. После сохранения reload всех загруженных main/local views; deferred пропускаются. Local reload снимает свои подписки и сохраняет rootPath, если активной markdown-вкладки нет. RED settings6, resolution3, reloadall2 и localreload3; итог verify/build PASS: 864 теста / 107 файлов, lint 12 прежних warnings. Старые fixtures расширены, assertions не менялись. Native Retina пока ожидается.

- B5 benchmark: layout 27.0 FPS, pan 17.5, zoom 16.4; worker interval 182.7/391.4 мс; idle 59 render/30 с, render JS35.8 мс, tick JS66.1 мс, ошибок0. Renderer не менялся относительно B4.

- B review: после ошибки записи pending больше не остаётся без drain; flush дописывает последнее значение и сохраняет исходную ошибку. RED 2/4, targeted 10/10 PASS. Изолированный staged verify/build PASS: 866 тестов / 107 файлов, lint 12 прежних предупреждений.
- B6 standard benchmark: layout42.6, pan18.8, zoom19.0 FPS; tick194.4/385.6 мс; idle60 render/30с, renderJS11.4мс, tickJS18.6мс, ошибок0. DPR2.5, canvas1626x577.

- B6 high benchmark: DPR2.5 ограничен resolution2; canvas3252x1154 против1626x577 standard. Layout35.3, pan18.3, zoom17.3 FPS; tick188.9/387.4мс; idle59 render/30с, renderJS42.6мс, tickJS67.4мс, ошибок0. Порог50FPS не пройден в обоих режимах, baseline также FAIL.
- B6 native на сборке5728f74: переключение high сохраняется в data.json; основной и локальный графы заново отображаются. Drag Alpha попадает в узел, click открывает Alpha. PNG видимого графа730x1414 содержит три узла и подписи. Экспорт скрытой вкладки выявил отсутствие узлов/подписей, исправление и повторная проверка ожидаются.

- B6 review: replaceSettings перезагружает все main/local views, reload последователен внутри вызова и между вызовами. Ошибка не пропускает оставшиеся views и не блокирует следующий запрос. RED3, target21/21, isolated verify/build PASS:871 тест /108 файлов, lint12. Позиции по-прежнему общие для main views, последняя view сохраняет последней; единая модель владения layout не вводилась.

- B6 review: GraphView снимает подписки текущего открытия до ожидания save; reload больше не дублирует file-open, клавиатуру, pointer, metadata, rename и theme handlers. RED3/3, targeted37PASS, isolated verify/build PASS:874 теста/109 файлов, lint12. Старые assertions/fixtures не менялись.

- B4 native finding fixed: принудительный PNG culling использует сохранённый app.screen, потому что DOM canvas скрытой вкладки имеет0x0. RED1, targeted32PASS, verify/build PASS:875 тестов/110 файлов, lint12. Повторный native экспорт пока не выполнен: Mac заблокирован, запрос на ручную разблокировку отправлен.

- B review follow-up: синхронный throw write нормализован до await, чтобы active не зависал и flush не зацикливался. RED1/5, GREEN5/5; isolated verify/build PASS:876 тестов/110 файлов, lint12.

- B4 review follow-up: PNG выполняет culling и при уже очищенном cullDirty. Регрессия усилена сценарием hidden normal frame -> pause -> export, RED до fix, targeted32PASS. Изолированный verify/build PASS:876 тестов/110 файлов, lint12.

- B7: кандидат0.10.3 подготовлен локально, финальный verify/build PASS:876 тестов/110 файлов, typecheckPASS, lint0 ошибок/12warnings. Повторное независимое review подтвердило закрытие queue sync throw и forced PNG culling (6testsPASS). Native не завершён, Mac заблокирован; CI не запускался, push/merge/release запрещены. Следующий этап C локально поверхB.

## Этап C

- C1: ручные4DOMзамены, test-only prefer-create-el override, host API stubs createEl/createFragment расширены без изменения assertions. RED lintmaxwarnings0:12warnings. Изолированный final verify/build PASS:876 тестов/110 файлов, lint0errors/0warnings. Stubtype несовместимость исправлена по типамObsidian, globalThis разрешён толькоhoststub. Native UI не менялся.

- C2: новый узел стартует у среднего различных известных соседей с детерминированным xy-сдвигом, z равен среднему. Используются только previous/saved coordinates; без соседа точный прежний fallback, без истории seedundefined и worker seed не меняются. Live/saved rename mapping сохранён. RED integration2FAIL, targeted20PASS; isolated verify/build PASS:883 теста/112 файлов, lint0warnings. Нативно пока не проверено, Mac locked.

- C3: использован существующий prefersReducedMotion, положительная instant duration сохранена для controller. Камера сразу ставится в конечную точку без tween; trail replay отменяет предыдущийRAF и сразу рисует progress1. CSS отключает animation/transition только внутри graph container. Timeline не менялся. Новые регрессии camera entry/hop и trail прошли RED, затем7новыхGREEN; verify/build PASS:890 тестов/115 файлов, lint0warnings. Native системная настройка не проверена из-за блокировкиMac.

- C4: fundingUrl скопирован точно из README: https://ko-fi.com/n23eos. JSON и соответствие ссылке проверены; verify/build PASS: 890 тестов / 115 файлов, lint 0 ошибок / 0 предупреждений.

- Независимое ревью C1-C4: существенных замечаний нет. 31 целевой тест / 6 файлов PASS, diff --check и точное совпадение fundingUrl с README PASS. Нативная проверка не выполнялась. C5 ожидает согласования расширения области правок по 0.4; D/E ещё не начаты.

## Продолжение по разрешению владельца

2026-11-14 владелец разрешил весь оставшийся объём, коммиты, push и установку в Raincoat; запретил публикацию релиза. Дополнительного согласования C5 больше не требуется. Теги не создаются, поскольку они запускают Release workflow.

Push A/B/C выполнен. CI PASS для точных голов:
- A: 472d1ca, run43599239646.
- B: ef01500, run43599239535.
- C1-C4: 3d0a867, run43599239978.

Mac по-прежнему заблокирован. Нативные проверки не выдаются за завершённые.

## C5: owner windows and migration, 2026-11-14

- Captured host document/window for GraphRenderer, Viewport, ExploreSession, main/local view, visibility observers and UI components. Canvas creation, theme/legend, keyboard, pointer events, resize, RAF, timers and downloads use the owning window. Cleanup retains the original window after DOM migration.
- Pixi 8.19 runs with autoStart false; the host RAF calls public ticker.update. The automatic render listener remains removed. Pause/resume, demand invalidation, forced PNG draw and the 500 ms safety frame remain covered. No global Pixi DOM adapter changes.
- Migration subscriptions are released per opening. Reopens serialize and coalesce; a host-close epoch cancels queued reopening. Failed synchronous/asynchronous persistence still completes teardown; migration catches reload rejection. Stale preview/RAF callbacks cannot update a replacement view.
- RED confirmed for new two-window and lifecycle regressions. Existing API fixtures were extended. B3 ticker.start implementation assertions now check the equivalent owner RAF lifecycle without removing behavior coverage. Original baseline assertions were not weakened.
- Independent review found close/reopen resurrection, incomplete teardown on failed persistence and a legend palette mismatch. Each has regression coverage and is fixed.
- Full npm run verify: 912 tests / 124 files PASS; typecheck PASS; lint 0 errors, 0 warnings. npm run build PASS. Logs: /tmp/hardening-c5-final-verify.log and /tmp/hardening-c5-final-build.log. jsdom emits its existing canvas getContext diagnostic; no tests failed.
- Native popout, real GPU and migration interaction: not verified. CUA still reports the Mac locked. No native acceptance is inferred from iframe tests.

## C6: candidate 0.10.4, 2026-11-14

- Prepared manifest/package/lock root versions, versions.json, CHANGELOG and English draft release notes. No tag or release created.
- The closing-stage run exposed an asynchronous test-fixture omission: onDemand ticker lacked update(), and its resumed RAF outlived the test. Added the missing API stub and per-test pause cleanup without changing assertions. This was recorded in a separate test commit.
- Final verify: 912 tests / 124 files PASS, typecheck PASS, lint 0 errors/0 warnings. Build PASS. Logs: /tmp/hardening-c6-verify.log and /tmp/hardening-c6-build.log.
- Independent C5 review: 67 tests / 13 files PASS, no remaining substantial findings after lifecycle and legend fixes. Native acceptance remains incomplete.

## D1: export actions extraction, 2026-11-14

- Moved PNG/JSON/GEXF and topic-map actions into ExportActions with narrow dynamic dependencies. GraphView retains public commands and its topic-map entry wrapper. The facade initializes lazily, including for existing prototype-based fixtures.
- AST comparison confirmed all 10 moved method bodies match the prior implementation. The existing title separator uses a Unicode escape to preserve its runtime string without adding a forbidden literal character. No behavior or existing tests changed.
- verify: 912 tests / 124 files PASS, typecheck and lint zero warnings PASS; build PASS. Logs: /tmp/hardening-d1-verify.log and /tmp/hardening-d1-build.log.

## D2: menu extraction, 2026-11-14

- Moved node, lasso, task and responsive overflow menu bodies into GraphMenus with narrow live getters and callbacks. GraphView keeps all four private wrappers and lazy facade initialization for prototype-based fixtures.
- Existing menu behavior, task action ids, clipboard writes, pin and hidden-node mutations, navigation callbacks and popup positions are unchanged. No existing tests changed.
- verify: 912 tests / 124 files PASS, typecheck and lint zero warnings PASS; build PASS. Logs: /tmp/hardening-d2-verify.log and /tmp/hardening-d2-build.log.

## D3: note navigation extraction, 2026-11-14

- Moved note opening, companion pane reuse and file explorer reveal behavior into NoteNavigation with narrow live getters and state callbacks. GraphView keeps the private entry wrappers and lazy facade initialization for prototype-based fixtures.
- Graph model lookup, self-open suppression, companion leaf state and file explorer capability probing are unchanged. No existing tests changed.
- verify: 912 tests / 124 files PASS, typecheck and lint zero warnings PASS; build PASS. Logs: /tmp/hardening-d3-verify.log and /tmp/hardening-d3-build.log.

## D4: preset and task actions extraction, 2026-11-14

- Moved saved-search presets, view presets and canned task execution into PresetActions with narrow live getters and callbacks. GraphView keeps its UI entry wrappers, mutable fields and lazy facade initialization for prototype-based fixtures.
- GraphInsightView.TASK_ACTIONS remains the public static action list with the same literal ids. Preset ordering, notices, bundled preset restoration and diagnostic query clearing are unchanged. No existing tests changed.
- verify: 912 tests / 124 files PASS, typecheck and lint zero warnings PASS; build PASS. Logs: /tmp/hardening-d4-verify.log and /tmp/hardening-d4-build.log.

## D5: changes controller extraction, 2026-11-14

- Moved six Changes actions into ChangesController. Live state accessors and GraphView callbacks preserve generation checks, await boundaries and existing method overrides. Lifecycle/reset ownership remains in GraphView.
- AST comparison of method bodies passes after accounting for dependency forwarding and comment-only separator normalization. Existing tests unchanged.
- verify: 912 tests / 124 files PASS, typecheck/lint PASS with no warnings; build PASS. Logs: /tmp/hardening-d5-verify.log and /tmp/hardening-d5-build.log.

## D6: tooltip extraction, 2026-11-14

- Moved tooltip, delayed preview and timer cleanup into TooltipController. Shared tooltip fields remain in GraphView for Explore; callbacks keep notePreview overrides and generation/element identity checks intact.
- All four method bodies structurally match after dependency forwarding and comment normalization. Existing tests unchanged.
- verify: 912 tests / 124 files PASS, typecheck/lint PASS with no warnings; build PASS. Logs: /tmp/hardening-d6-verify.log and /tmp/hardening-d6-build.log.

## D7: Explore bindings extraction, 2026-11-14

- D1-D6 preserved existing tests and behavior. Moved eight Explore method bodies into ExploreBindings with live state access and callbacks; GraphView retains fields, lifecycle, keyboard dispatch and shared breadcrumbs.
- The constructor callback order, detached versus anchored checks, runtime-only panel override and distinct teardown path are preserved. All eight method bodies structurally match after dependency forwarding/comment normalization. Existing tests unchanged.
- verify: 912 tests / 124 files PASS, typecheck/lint PASS with no warnings; build PASS. Logs: /tmp/hardening-d7-verify.log and /tmp/hardening-d7-build.log.

## C5 renderer smoke and D browser acceptance, 2026-11-14

- C5 real Pixi/WebGL harness: 10000 nodes / 29956 edges, standard resolution 1626x577, DPR 2.5. No application errors; screenshot inspected. Layout 39.1 FPS, pan 16.3 FPS, zoom 18.6 FPS. The 50 FPS target remains unmet, as in the earlier baseline; no pan/zoom improvement claimed. Layout reached the 30-second timeout, then the harness stopped the worker before idle sampling. Idle: 59 draws / 30.021 seconds, render JS 59.5 ms, tick JS 102.9 ms. These are JS wall times, not OS CPU/GPU utilization. Evidence: /tmp/hardening-c5-browser-benchmark.json.
- Extended only browser host API stubs for offref, flushSettings, snapshots and containerEl so the existing UI harness can exercise the current runtime. The FuzzySuggestModal stub still does not render a real picker: that route is not accepted in this harness.
- Real GraphView, renderer and workers on 42 synthetic notes: Explore entry, opening its note, detached mode and exit; narrow 360 px/light theme; overflow menu and Changes category/open-note; committed tag:graph filter shows 6/42; broken-links task applies its preset and clears query, Undo restores query; empty-vault teardown and remount to 42 notes. No application errors in the error panel or captured app logs. Unrelated wallet extension errors were excluded by source URL. Screenshots inspected at 1200 px/dark and 360 px/light.
- D1-D7 independent reviews found no substantial defects. D6/D7 reviewer additionally ran 22 targeted tests in four files. Full native Obsidian route, actual popout and full restart remain unverified because the Mac is locked. No BRAT beta/release is published under the owner's restriction.

## D close: unpublished 0.11.0-beta.1, 2026-11-14

- Seven controllers extracted in seven commits, with separate browser adapter support. GraphView retains orchestration and shared state; no runtime behavior, settings formats or original test assertions changed by the extraction.
- Final verify: 912 tests / 124 files PASS, typecheck PASS, lint 0 errors/0 warnings. Production build PASS. Logs: /tmp/hardening-d-final-verify.log and /tmp/hardening-d-final-build.log.
- Manifest/package/lock root, versions.json, CHANGELOG and English draft notes prepared. Native full-route acceptance remains open. No tag, release or BRAT beta publication.

- D exact head f5a47ff pushed on refactor/graphview-split; CI 43603063341 success: https://github.com/n23eos/advanced_graph_view/actions/runs/43603063341. No merge/tag/release.

## E1: workspace state, 2026-11-14

- Spec Kit specs/005-workspace-state, per-leaf camera/query restoration and guarded reopen. 943 tests / 128 files, lint zero, typecheck/build PASS; independent risk review closed. Browser fresh-view 2D/3D camera and tag query round trips pass. Native app restart unverified.

## E2: native hover integration, 2026-11-14

- specs/006-native-hover, per-view native preview lifecycle, stationary hit-test and hidden-leaf cleanup. Integrated E1/E2 verify: 959 tests / 131 files, lint zero, typecheck/build PASS. Independent review closed. Native popup comparison unverified because Mac is locked.

## E3: frontmatter properties, 2026-11-14

- specs/007-frontmatter-properties, property filter/color/live refresh with defaults preserved. Integrated E1-E3 verify: 983 tests / 139 files, lint zero, typecheck/build PASS. Independent review closed; browser property color/query and workspace restoration pass. Native editing unverified.
- E1 exact head 0a4445f CI 43606035489 success.

## E4: optional graph nodes, 2026-11-14

- specs/008-extended-nodes implemented with exact legacy off/off model compatibility, including existing linked attachments. All-attachment and missing-target additions default off. Source-qualified missing identities are guarded from vault APIs; exports use safe paths/source links. Snapshots compare matching scopes with backward-compatible normalization.
- Independent review closed export labels/paths, attachment facts and inventory lifecycle issues with regression coverage. Main/local/Insights update after attachment create/delete/rename, with listener cleanup and initial-build ordering covered.
- Final integrated verify: 1012 tests / 150 files PASS, typecheck PASS, lint zero errors/warnings. Production build PASS. Logs: /tmp/hardening-e4-integrated-verify.log and /tmp/hardening-e4-integrated-build.log.
- Browser real GraphView/renderer/workers with 42 notes, one linked attachment, one isolated attachment and two missing targets: actual search counters confirm off/off 43, attachments 44, missing only 45, both 46, return to off/off 43. Controls are host-fixture settings controls calling the public reload method, not native SettingsTab.
- Property color and prop:status=active show 8/43 after a fresh view restores workspace state. Screenshots inspected at 1200 px/dark and 360 px/light. No application errors; captured wallet-extension errors are unrelated by source URL.
- Mac remains locked; native restart, hover popup, popout, actual attachment opening and display-resolution acceptance remain unverified. No tag, release or merge.
