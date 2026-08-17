# Техническое задание: UX-полировка и новые рабочие сценарии Advanced Graph View

Статус: draft for implementation  
Версия документа: 1.1  
Целевая версия плагина: определяется при планировании релиза  
Платформа: Obsidian Desktop 1.13+

## 1. Цель

Сделать Advanced Graph View понятнее при первом использовании, сократить число скрытых состояний и превратить существующие функции графа в завершённые рабочие сценарии без ухудшения производительности на хранилищах размером 5 000–50 000 заметок.

После реализации пользователь должен:

- понимать, что произойдёт при клике по узлу;
- отличать подсветку результатов поиска от жёсткой фильтрации;
- комфортно использовать граф в узкой панели Obsidian;
- сохранять и повторно применять раскладку и именованные фильтры;
- видеть изменения хранилища за 7 или 30 дней;
- перемещаться по истории Focus/Explore;
- экспортировать выбранную область графа в полезную Markdown-карту.

## 2. Product gate

Решение: **go**.

- Основной пользователь: владелец среднего или большого Obsidian-хранилища, который использует граф для навигации, анализа и уборки базы знаний.
- Боль: возможностей много, но часть поведения скрыта в сочетаниях инструментов, Enter, режимов камеры и технических параметров.
- Почему сейчас: нужные данные и большая часть механики уже существуют; основной объём работ приходится на состояние UI, композицию существующих функций и несколько изолированных моделей данных.
- 10-star версия: граф сам предлагает полезные действия, объясняет состояние и показывает эволюцию базы знаний.
- MVP: этап A (F-02–F-09) плюс F-01 из этапа B. Режим изменений (F-10), breadcrumb (F-11) и экспорт карты (F-12) допускаются отдельным вторым релизом.
- Антицель: переработка рендера, алгоритмов PageRank/Louvain или визуального языка узлов.
- Метрики успеха: время до первого осмысленного действия, доля поисков, завершённых жёстким фильтром, использование сохранённых фильтров, число экспортов карт темы, отсутствие переполнения UI в split-view.

## 3. Границы

### 3.1. Входит в объём

| ID | Возможность |
|---|---|
| F-01 | Компактный запуск готовых задач |
| F-02 | Исправление семантики двойного клика и онбординга |
| F-03 | Явные состояния поиска и счётчик результатов |
| F-04 | Адаптивный floating UI |
| F-05 | Сохранение правила раскладки |
| F-06 | Упрощение виджета камеры |
| F-07 | Упрощение секции Physics в Expert-панели |
| F-08 | Видимый статус активного инструмента |
| F-09 | Полноценное управление сохранёнными фильтрами |
| F-10 | Режим «Что изменилось?» |
| F-11 | Breadcrumb для Focus и Explore |
| F-12 | Экспорт карты темы в Markdown |

### 3.2. Явно не входит

- переименование режимов `Simple` и `Expert`;
- карточки-сценарии с мини-превью в Simple-панели;
- постоянная строка `Размер / Цвет / Свечение` рядом с графом;
- пункт «Почему эта заметка важна?» и расчёт трёх главных связывающих заметок;
- превращение существующего Insights dashboard в центр действий;
- изменение математических формул PageRank, Louvain и force layout;
- мобильная версия;
- облачная синхронизация, телеметрия и сетевые запросы.

## 4. Общие ограничения и инварианты

1. Все данные остаются локальными. Новые функции не выполняют сетевых запросов.
2. Основной canvas не пересоздаётся из-за раскрытия меню, смены статуса поиска или адаптивного режима UI.
3. Существующие пользовательские настройки, view presets и filter presets должны мигрировать без потери данных.
4. Любое новое пользовательское сообщение добавляется во все 12 locale-файлов. Отсутствующий перевод продолжает блокировать сборку типами.
5. Управление мышью, клавиатурой и command palette должно приводить к одному состоянию UI.
6. Состояние, влияющее на внешний вид view preset, хранится внутри `PanelState`. Состояние навигационной сессии в preset не входит.
7. На графе из 50 000 узлов ввод в поиске и обновление счётчика не должны запускать дополнительный полный проход чаще одного раза на кадр.
8. Новые фоновые записи на диск выполняются с debounce и не блокируют UI thread.

## 5. Функциональные требования

### F-01. Компактный запуск готовых задач

Добавить компактный control `Задачи…` в верхнюю область графа. Это dropdown/menu, а не карточки и не отдельный onboarding-экран.

Обязательные действия:

| Действие | Результат |
|---|---|
| Исследовать тему | Включить инструмент Links/Focus; текущий фильтр не сбрасывать |
| Найти забытые важные заметки | Применить встроенный preset Attention map |
| Почистить сироты | Применить встроенный preset Orphans |
| Найти битые ссылки | Применить встроенный preset Broken links |
| Посмотреть недавнюю активность | Применить встроенный preset Recent |
| Понять структуру хранилища | Применить встроенный preset Hubs and clusters |

Требования:

- встроенный preset определяется по стабильному `builtinId`, а не по локализованному имени или индексу;
- если требуемый встроенный preset отсутствует после ручного изменения данных, он восстанавливается из `DEFAULT_VIEW_PRESETS` перед применением;
- действие, которое меняет вид, использует существующий pipeline применения preset и показывает стандартный Notice;
- control скрывается в minimal responsive mode и остаётся доступным через command palette;
- добавить отдельную команду для каждого действия, чтобы пользователь мог назначить hotkey.

Критерии приёмки:

- выбор «Почистить сироты» включает тот же `PanelState`, что встроенный preset Orphans;
- локализация интерфейса не влияет на выбор preset;
- пользовательский hard query сбрасывается только для диагностических задач Orphans/Broken links/Attention map; перед сбросом активный запрос остаётся доступен для Undo до следующего изменения view state;
- команды недоступны только пока plugin view невозможно активировать.

### F-02. Двойной клик и онбординг

Зафиксировать обещанное поведение: **двойной клик по узлу входит в Focus mode вокруг этого узла и не открывает заметку**.

Требования:

- двойной клик имеет одинаковую семантику при любом активном cursor tool, кроме активного Explore mode;
- первый клик пары не должен выполнять действие текущего инструмента;
- в Explore mode двойной клик не создаёт два перехода и не открывает заметку;
- README, onboarding и tooltip/hint используют одинаковую формулировку;
- первый onboarding заменить статичным описанием на три коротких шага с действиями: выбрать узел, попробовать фильтр, запустить Explore;
- у onboarding должны быть `Далее`, `Назад`, `Пропустить` и `Больше не показывать`;
- onboarding можно повторно открыть из Settings и command palette;
- закрытие крестиком считается `Пропустить`, но не `Больше не показывать`.

Состояния onboarding:

```ts
type OnboardingState = "never-seen" | "dismissed" | "completed" | "disabled";
```

Миграция старого `onboardingShown: true` приводит к `disabled`, `false` — к `never-seen`.

Критерии приёмки:

- двойной клик всегда показывает focus bar с выбранным узлом;
- заметка не открывается ни в текущей вкладке, ни в side pane;
- после обычного `Пропустить` onboarding можно открыть снова;
- после `Больше не показывать` он не открывается автоматически.

### F-03. Явные состояния поиска

Ввести два визуально различимых состояния:

```ts
type SearchMode = "idle" | "highlight" | "filter";

interface SearchUiState {
  mode: SearchMode;
  query: string;
  matchedCount: number;
  totalCount: number;
  isIndexingContent: boolean;
  parseError?: { message: string; tokenStart: number; tokenEnd: number };
}
```

Поведение:

- ввод непустого запроса: `highlight`;
- Enter без активной autocomplete-подсказки: `filter`;
- Escape при открытом autocomplete закрывает autocomplete; повторный Escape очищает запрос;
- очистка: `idle`;
- при `highlight` показывать `Подсвечено: N`;
- при `filter` показывать `Показано: N из M` и удаляемый chip активного запроса;
- до первого Enter рядом с полем показывать ненавязчивую подсказку `Enter — оставить только найденное`;
- `content:` показывает состояние `Индексирование…`, не выдаёт окончательный нулевой результат до завершения индекса;
- синтаксическая ошибка не применяет новый hard filter, подсвечивает проблемный token и сохраняет последний валидный результат.

Критерии приёмки:

- пользователь визуально различает highlight и filter без знания документации;
- счётчик учитывает query, tag/folder chips, timeline и скрытые вручную узлы;
- счётчик и canvas обновляются из одного вычисленного mask, без второго полного прохода;
- Enter при выбранной autocomplete-подсказке сначала применяет подсказку, а не hard filter.

### F-04. Адаптивный floating UI

Адаптация определяется шириной контейнера view через `ResizeObserver`, а не шириной окна.

Режимы:

| Ширина view | Режим | Поведение |
|---|---|---|
| `>= 900px` | full | Текущая компоновка с уточнениями из ТЗ |
| `600–899px` | compact | Search растягивается по доступному месту; вторичные действия уходят в `…`; toolbar допускает две группы |
| `< 600px` | minimal | Только search icon/input, активный tool и overflow menu; panel открывается как overlay/drawer |

Требования:

- ширина поиска задаётся через `clamp()` и доступное пространство, без фиксированных 320 px;
- toolbar, search и Obsidian view actions не перекрываются;
- dropdown не выходит за границы контейнера и при необходимости открывается в противоположную сторону;
- focus/explore status bar переносится максимум на две строки;
- touch target иконок не меньше 28×28 CSS px;
- при переходе между режимами функциональное состояние не сбрасывается;
- resize не вызывает rebuild graph или restart layout worker.

Критерии приёмки:

- на ширинах 480, 600, 768, 900 и 1200 px нет горизонтального overflow;
- все скрытые в `…` действия остаются доступны с клавиатуры;
- canvas сохраняет размер и camera framing после изменения ширины панели.

### F-05. Сохранение правила раскладки

Добавить `layoutRule` в `PanelState`:

```ts
interface PanelState {
  // existing fields
  layoutRule: LayoutRule;
}
```

Требования:

- default и миграционное значение: `links`;
- selector всегда отражает фактическое значение;
- значение сохраняется в settings и входит в view preset;
- применение preset меняет selector и физическую раскладку атомарно;
- импорт старого settings profile добавляет `layoutRule: "links"`;
- неизвестное значение при импорте заменяется на `links` с Notice, не отклоняя весь профиль.

Критерии приёмки:

- после reload выбранные Tags/Folders/Communities остаются выбранными и применёнными;
- переключение Simple/Expert не сбрасывает правило;
- сохранённый preset воспроизводит правило на другом vault.

### F-06. Упрощение камеры

Убрать постоянно видимые X/Y sliders из `CameraWidget`.

Оставить:

- Hide/show UI;
- 3D toggle;
- Free layout toggle;
- Fit whole graph;
- Reset camera;
- Explore.

Требования:

- `Reset camera` обнуляет center offset, rotation/orbit и временный zoom, затем выполняет fit;
- `Fit whole graph` меняет только framing и не сбрасывает ориентацию 3D;
- pan остаётся доступен через существующие mouse gestures;
- программный API `onOffsetChange` можно удалить только после проверки отсутствия внешних вызовов;
- для Fit и Reset используются разные иконки и aria-label;
- в minimal mode Fit/Reset/Explore находятся в overflow menu.

Критерии приёмки:

- все сценарии X/Y sliders воспроизводятся pan-жестом и Reset;
- Reset приводит к детерминированному начальному виду;
- переключение 2D/3D синхронизировано с Expert-панелью и command palette.

### F-07. Секция Physics

Сохранить название Expert и текущие параметры, но сделать секцию Physics свёрнутой по умолчанию.

Требования:

- состояние раскрытия секции является UI preference и не входит в view preset;
- внутри секции добавить `Вернуть рекомендуемые значения`;
- рекомендуемые значения берутся из текущего применённого builtin preset, а если его нет — из `DEFAULT_3D_PANEL` для 3D и `Default 2D` для 2D;
- перед сбросом показывается краткий diff изменяемых параметров; подтверждение не требуется;
- после сброса доступен Undo через Notice до следующего изменения physics;
- `Re-form the cloud` остаётся отдельным действием и не изменяет сохранённые параметры.

Критерии приёмки:

- раскрытие/сворачивание не перезапускает layout;
- reset выполняет один restart/regroup после атомарного обновления всех physics fields;
- Undo возвращает точные предыдущие значения.

### F-08. Статус активного инструмента

Добавить текстовый status element рядом с toolbar или под ним. Существующий `ToolBar.setStatus()` следует превратить из `data-status` в реальный доступный DOM-элемент.

Минимальные тексты:

| Tool/state | Статус |
|---|---|
| Open | `Открытие — нажмите на заметку` |
| Links | `Связи — выберите заметку` |
| Path, start | `Путь — выберите начало` |
| Path, end | `Путь — выберите конечную заметку` |
| Hide | `Скрытие — нажмите на заметку` |
| Pin | `Закрепление — нажмите или перетащите заметку` |
| Follow active | Добавить badge `Follow` |
| Side pane | Добавить badge `Side pane` |

Требования:

- статус обновляется при toolbar click, command palette и входе/выходе из Focus/Explore;
- status element имеет `aria-live="polite"`;
- в compact/minimal mode показывается только короткое имя tool, инструкция доступна в tooltip;
- Escape, сбрасывающий view state, возвращает корректный статус активного tool.

Критерии приёмки:

- состояние Path однозначно показывает, какой из двух узлов ожидается;
- badge не изменяет ширину toolbar скачком; зарезервировано место либо используется overlay.

### F-09. Управление сохранёнными фильтрами

Заменить автоматическое имя из первых 24 символов на явное именование.

Модель:

```ts
interface SearchPreset {
  id: string;
  name: string;
  query: string;
  createdAt: number;
  updatedAt: number;
}
```

Требования:

- Save открывает modal с полями Name и Query;
- имя обязательно, trim, длина 1–80 символов;
- запрос проходит parser validation до сохранения;
- поддерживаются Apply, Rename, Edit query, Duplicate и Delete;
- Delete требует подтверждения с именем preset;
- одинаковые имена разрешены, идентичные `id` — нет;
- список сортируется: недавно использованные, затем по имени;
- builtin view presets и search presets остаются разными сущностями и визуально разделяются;
- миграция старых presets генерирует `id`, timestamps и сохраняет имя/запрос без изменений.

Критерии приёмки:

- preset можно переименовать без изменения query;
- удаление одного из одноимённых presets не затрагивает другой;
- импорт/экспорт settings profile сохраняет новые поля;
- невалидный query нельзя сохранить, modal показывает место ошибки.

### F-10. Режим «Что изменилось?»

Добавить внутри основного graph view открываемую панель `Изменения` с периодами `7 дней` и `30 дней`.

Категории MVP:

- новые заметки;
- изменённые заметки;
- добавленные связи;
- удалённые связи;
- выросшие хабы;
- остывающие кластеры.

Определения:

- новая/изменённая заметка определяется по `ctime`/`mtime` относительно периода;
- добавленная/удалённая связь определяется сравнением текущей topology с ближайшим snapshot не новее начала периода;
- выросший хаб: узел входит в верхние 10% по абсолютному приросту inbound links или PageRank delta и имеет положительный delta;
- остывающий кластер: в текущем составе кластера opens за период снизились минимум на 50% относительно предыдущего периода той же длины, при этом в предыдущем периоде было не менее 5 opens;
- если исторического snapshot нет, категории связей и PageRank delta показывают empty state `История начнёт накапливаться после этого открытия`; остальные категории работают.

Snapshot model:

```ts
interface GraphSnapshot {
  version: 1;
  capturedAt: number;
  paths: string[];
  edges: Array<[sourceIndex: number, targetIndex: number]>;
  pagerank: number[];
  communityByPath?: number[];
}
```

Хранение:

- отдельный файл `data/snapshots.json` или эквивалентное версионированное хранилище;
- не более 8 недельных и 6 месячных snapshots;
- жёсткий лимит 64 MB; при превышении удаляются самые старые snapshots, но не текущий baseline;
- snapshot создаётся не чаще одного раза в 24 часа после успешного расчёта metrics;
- запись атомарная через существующий persistence layer;
- reset all plugin data удаляет snapshots; reset settings — не удаляет.

UI:

- category показывает count;
- выбор category применяет временную highlight/filter mask к текущему графу;
- строка заметки открывает её обычным способом; строка связи фокусирует оба конца и подсвечивает edge;
- закрытие панели не сбрасывает выбранную категорию без явного `Сбросить изменения`;
- состояние changes overlay не входит в view preset и не сохраняется между перезапусками.

Критерии приёмки:

- режим корректно работает без snapshots в деградированном состоянии;
- snapshot не создаётся, если metrics worker завершился ошибкой;
- rename заметки между snapshots не приводит к падению; такая запись трактуется как removed + added, если надёжное сопоставление невозможно;
- расчёт diff выполняется в worker для графов свыше 10 000 узлов;
- UI остаётся интерактивным во время расчёта и показывает progress/skeleton.

### F-11. Breadcrumb Focus/Explore

Добавить breadcrumb в существующую focus/explore status bar.

Модель сессии:

```ts
interface NavigationCrumb {
  path: string;
  label: string;
}

interface NavigationTrail {
  mode: "focus" | "explore";
  items: NavigationCrumb[];
  activeIndex: number;
}
```

Требования:

- trail хранит path, а не node id;
- вход в Focus создаёт trail; переход в Focus к другому узлу добавляет crumb;
- каждый успешный Explore hop добавляет crumb;
- Backspace в Explore переводит active index назад;
- клик по crumb переводит к нему, обрезая более позднюю ветку только после следующего нового перехода;
- отсутствующая/удалённая заметка показывается disabled и может быть удалена из trail;
- максимум 50 crumbs, старые удаляются с начала;
- на узкой ширине видны первый, предпоследний и активный crumb, середина сворачивается в `…`;
- trail не сохраняется после закрытия view и не входит в settings.

Критерии приёмки:

- breadcrumb и Backspace используют одну модель истории;
- camera flight при выборе старого Explore crumb не меняет выбранный пользователем zoom;
- rebuild графа восстанавливает ids по paths или безопасно помечает crumb недоступным;
- выход из режима очищает только соответствующий trail.

### F-12. Экспорт карты темы

Добавить экспорт Markdown для одного из источников selection:

- текущий Focus neighborhood;
- текущий Explore center и его доступные связи;
- lasso selection;
- активный cluster при наличии однозначного cluster filter.

Точки входа:

- context menu selection;
- focus/explore status bar;
- command palette `Export current topic map to Markdown`.

Перед экспортом открыть modal:

- название итоговой заметки;
- папка назначения;
- глубина 1–4, если применимо;
- включить направления связей;
- включить метрики;
- включить список связей между выбранными заметками.

Формат результата:

```md
---
advanced-graph-view: topic-map
generated: 2026-08-16T12:00:00Z
source: focus
depth: 2
---

# Карта темы: [[Root note]]

## Обзор
- Заметок: 42
- Связей внутри выборки: 87

## Центральные заметки
- [[Note A]] — входящих: 12, исходящих: 4

## Уровень 1
- → [[Note B]]

## Уровень 2
- [[Note C]] — через [[Note B]]

## Связи внутри карты
- [[Note A]] → [[Note B]]
```

Требования:

- использовать wikilinks и текущую локализованную терминологию;
- экспорт не читает содержимое заметок и не генерирует AI-summary;
- ссылки включают только существующие Markdown files;
- порядок детерминирован: depth, затем locale-aware name;
- при конфликте имени предложить `Перезаписать`, `Создать копию`, `Отмена`; default — `Создать копию`;
- перезапись требует подтверждения и выполняется только по явному выбору;
- для lasso без root разделы по depth не создаются, вместо них используется общий список и внутренние связи;
- существующий `localGraphMarkdown` следует обобщить или переиспользовать, не дублировать BFS-форматирование.

Критерии приёмки:

- одинаковая selection при одинаковых options даёт детерминированный body, кроме timestamp;
- все wikilinks открываются в Obsidian;
- экспорт 5 000 выбранных узлов не блокирует UI: подготовка выполняется порциями или в worker;
- отмена modal не создаёт файл;
- failure записи показывает Notice и не оставляет пустой файл.

## 6. Изменения интерфейсов и данных

### 6.1. Settings schema

```ts
interface GraphInsightSettings {
  // existing fields
  onboardingState: OnboardingState;
  presets: SearchPreset[];
  panel: PanelState & { layoutRule: LayoutRule };
  collapsedSections?: { physics?: boolean };
}
```

Поле `onboardingShown` после миграции больше не записывается. Чтение сохраняется минимум один major/minor release для обратной совместимости profiles.

### 6.2. Runtime view state

```ts
interface GraphViewUiState {
  responsiveMode: "full" | "compact" | "minimal";
  search: SearchUiState;
  navigationTrail: NavigationTrail | null;
  changesSelection: { periodDays: 7 | 30; category: ChangeCategory | null };
}
```

Runtime state не сериализуется в view preset.

### 6.3. Persistence

- `data.json` (стандартный `Plugin.saveData`): мигрированные UI settings и filter presets;
- `snapshots.json` рядом с `usage.json`/`positions.json` через существующий слой `src/data/persistence.ts`: история графа для F-10;
- существующие `usage.json` и `positions.json` не меняют формат;
- settings profile включает settings и presets, но не topology snapshots.

## 7. Ошибки и восстановление

| Ситуация | Ожидаемое поведение |
|---|---|
| Невалидный сохранённый query после импорта | Preset сохраняется disabled с объяснением; остальные импортируются |
| Неизвестный layout rule | Fallback `links` и Notice один раз |
| Snapshot повреждён | Отправить в существующий quarantine-механизм `persistence.ts`, начать историю заново, остальной plugin работает |
| Превышен snapshot limit | Удалить старые snapshots по retention policy |
| Metrics worker недоступен | Changes работает без PageRank/cluster categories |
| Узел breadcrumb удалён | Disabled crumb, без исключения |
| Ошибка записи Markdown | Notice, никакого частично созданного файла |
| Очень узкая панель | Overflow menu, canvas остаётся доступным |

## 8. Доступность

- Все новые controls — нативные `button`, `select`, `input` или Obsidian components.
- Icon-only buttons имеют локализованный `aria-label`.
- Dropdown/menu поддерживает Arrow keys, Enter, Escape и возврат focus к opener.
- Search status и tool status используют `aria-live="polite"`, но не озвучивают изменения на каждый символ чаще 300 ms.
- Цвет не является единственным признаком highlight/filter/active tool; используются текст, форма или border.
- Focus order соответствует визуальному порядку.
- Reduced motion отключает анимацию раскрытия panel и breadcrumb, но не ломает Explore camera flight; для Explore применяется сокращённая длительность.

## 9. Производительность

- Resize handling: не чаще одного применения layout за animation frame.
- Search mask и matched count вычисляются за один проход.
- Topology diff для `>10 000` узлов выполняется вне UI thread.
- Snapshot сериализуется после idle/debounce; запрещена запись на каждом vault event.
- Экспорт больших selections не формирует повторно полный graph model.
- Проверить целевой сценарий: 50 000 nodes, 250 000 edges, split-view 600 px, активный search и changes panel.

## 10. Тестирование

### 10.1. Unit tests

- миграции onboarding, layoutRule и SearchPreset;
- переходы `idle → highlight → filter → idle`;
- parser error сохраняет последний валидный hard filter;
- stable lookup builtin preset по `builtinId`;
- snapshot retention и size cap;
- topology diff: added/removed edges, renamed/deleted nodes;
- growing hubs и cooling clusters;
- NavigationTrail: back, branch, cap 50, missing path;
- детерминированный Markdown topic map;
- collision naming для экспортируемого файла.

### 10.2. Component/DOM tests

- keyboard navigation всех новых menu/modal;
- responsive mode при изменении container width;
- toolbar status для пяти tools и Path substate;
- Search UI count/status/content indexing;
- rename/edit/delete filter preset;
- onboarding close semantics.

### 10.3. Integration tests

- двойной клик входит в Focus и не открывает note;
- command palette и toolbar синхронизируют состояния;
- layout rule переживает reload и применение preset;
- Reset camera и Fit имеют различное поведение;
- Changes category применяет mask без rebuild graph;
- Explore breadcrumb возвращает camera к выбранному узлу;
- экспорт создаёт валидную Markdown note в выбранной папке.

### 10.4. Ручная матрица

- ОС: macOS, Windows, Linux;
- темы: default light, default dark, одна сторонняя тема;
- локали: English, Russian, German, Japanese;
- размеры view: 480, 600, 768, 900, 1200 px;
- vault: пустой, 100, 10 000 и 50 000 notes;
- 2D/3D, Simple/Expert, side pane on/off.

## 11. Этапы поставки

### Этап A — устранение трения

F-02, F-03, F-04, F-05, F-06, F-07, F-08, F-09.

Gate выхода:

- миграции покрыты тестами;
- нет UI overflow в матрице ширин;
- поиск и активный tool всегда имеют видимый статус;
- `npm run verify` и production build проходят.

### Этап B — завершённые сценарии

F-01, F-11, F-12.

Gate выхода:

- все task actions работают по `builtinId`;
- Focus/Explore имеют единую проверенную историю;
- topic map экспортируется из всех четырёх источников.

### Этап C — история изменений

F-10.

Gate выхода:

- подтверждены размер snapshots и latency на vault 50k/250k;
- реализована безопасная деградация без истории и metrics;
- retention, recovery и reset data проверены интеграционными тестами.

## 12. Наблюдаемость без телеметрии

Плагин не отправляет аналитику. Для диагностики допускаются только локальные данные:

- длительность последнего snapshot/diff/export в debug log;
- размер и число snapshots в Settings;
- кнопка `Copy diagnostics`, включающая версии, размер графа, timings и состояния workers без путей и названий заметок;
- ошибки persistence содержат тип операции, но не содержимое vault.

## 13. Открытые решения перед реализацией

Эти вопросы не блокируют этап A, но должны быть закрыты до соответствующего этапа:

1. F-01: должен ли task action всегда сбрасывать timeline и manually hidden nodes? Рекомендация: диагностические задачи сбрасывают overlay/focus, но не manually hidden nodes без подтверждения.
2. F-10: подтвердить лимит snapshot storage 64 MB на реальном vault 50k/250k.
3. F-10: считать rename как removed+added или внедрять устойчивый file identity. MVP: removed+added.
4. F-12: папка экспорта по умолчанию — рядом с root note или текущая configured export folder. Рекомендация: рядом с root; для lasso — корень vault.
5. F-02: reduced-motion длительность Explore. Рекомендация: 40% от обычной, не мгновенный jump.

## 14. Handoff

Статус: **готово к декомпозиции этапа A; этап C требует короткого architecture spike по хранению snapshots**.

Рекомендуемый следующий шаг:

1. Разбить этап A на независимые implementation tickets.
2. Сначала реализовать schema migrations и тесты.
3. Затем Search/Toolbar state, responsive UI и camera/panel polish.
4. После этапа A отдельно спроектировать worker и persistence benchmark для F-10.

## 15. Приложение: карта кода (сверено с репозиторием 2026-08-17)

| Область ТЗ | Файлы |
|---|---|
| `PanelState`, layout rule selector, секция Physics | `src/ui/ControlPanel.ts` (тип `LayoutRule` — из `src/workers/layoutEngine`) |
| Settings schema, `onboardingShown`, `DEFAULT_SETTINGS` | `src/settings/schema.ts`; import/export profile — `src/settings/profile.ts` |
| `SearchPreset` (сейчас `{ name, query }`), autocomplete, chips | `src/ui/SearchBar.ts` |
| `ToolBar.setStatus()` (сейчас пишет `data-status`) | `src/ui/ToolBar.ts` |
| X/Y sliders, `onOffsetChange`, Fit | `src/ui/CameraWidget.ts` |
| `builtinId`, `DEFAULT_VIEW_PRESETS`, `DEFAULT_3D_PANEL` | `src/view/builtinPresets.ts` |
| Onboarding | `src/ui/OnboardingModal.ts`, показ — `src/main.ts` |
| Focus/Explore, обработка кликов, lasso, status bars | `src/view/GraphView.ts` |
| Query parser, `content:` | `src/query/` |
| Persistence (`usage.json`, `positions.json`, quarantine) | `src/data/persistence.ts`, `src/data/UsageTracker.ts` |
| BFS-соседство и Markdown-экспорт для F-12 | `src/analysis/neighborhood.ts`, `src/export/localGraphMarkdown.ts` |
| Локали (12) | `src/i18n/locales/` |
| Проверка | `npm run verify` = lint + typecheck + vitest |

