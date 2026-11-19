# Локальная проверка — 19.11.2026

- Node portable: `v26.13.1`, без npm install.
- Команда: `node --test test/pilot.test.mjs test/retrieval.test.mjs test/smoke.test.mjs` (результат см. ниже).
  Unit-тесты используют синтетические токены,
  mock-транспорты либо HTTP только на `127.0.0.1`.
- Реальный vault успешно прочитан: **421 файл markdown/html, 10 856 фрагментов**.
  Поисковая smoke-проверка `44-ФЗ закупки`: 4 фрагмента (это не проверка качества юридического ответа).
- Реальный HTTP smoke на loopback с настоящим корпусом: `/health` → HTTP 200,
  `mode=offline`, `authenticationConfigured=false`, очередь/ошибки = 0.
- Git ignore проверен для `.env`, `.env.local`, `.state/test.log`.
- На исходном offline этапе внешние сообщения/LLM-запросы, регистрация бота,
  туннель, публикация и установка пакетов не выполнялись.

Не проверены: фактический payload из показанной формы Битрикс, доверенное получение её
application_token, совместимость регистрации/CLIENT_ID и нового вебхука,
HTTPS-доставка, качество/устойчивость реальной модели к prompt injection.
До устранения этих блокеров публичный/live запуск запрещён организационно и закрыто отказывает без конфигурации.

Добавлены offline-тесты настроек Hubris: полный `/v1/chat/completions`, точная модель
`dots-studio/dots-3-note-preview:free`, пустой API-ключ, offline default и отсутствие
второго запроса/fallback при ошибке модели. Первоначально доступность Hubris, качество и тариф не проверялись.

## Диагностика отказа на вопрос «Когда вступит в силу 331-ФЗ?»

- Offline воспроизведено: исходный поиск выбирал поправки к 61-ФЗ и навигацию 44-ФЗ,
  пропуская собственную карточку 331-ФЗ из-за равенства substring hits.
- Исправлено распознавание точного номера ФЗ/ФКЗ, ограничение собственной папкой,
  приоритет карточки и нормы о вступлении в силу с исключениями.
- Реальный corpus regression требует карточку и полный текст статьи 7 с обоими правилами.
  Даты и ответ в код алгоритма не зашиты; synthetic fixture использует другие даты.
- После изменений выполнен **ОДИН дополнительно разрешённый** live-запрос только к
  `https://api.hubris.pw/v1/chat/completions`, модель `dots-studio/dots-3-note-preview:free`.
  Ключ загружался Node через `--env-file=.env`, не читался инструментами и не выводился.
- HTTP 200, `finish_reason=length`, `hasContent=false`, `hasReasoning=true`,
  причина отказа **truncated_answer** при `max_tokens=1400`.
  В выдаче уже правильные источники (карточка, статья 7/полный текст).
  **Функциональный успех НЕ подтверждён.** Reasoning не выводился и не использовался как ответ.
- Новый бюджет 4096 только предложен в примере; повторного live-запроса не было.
  Нулевая стоимость этого вызова не проверялась по биллингу: суффикс free не равен подтверждённому счёту.
- `RUN_MODE` в реальном `.env` остался offline (проверен внутри процесса, файл не изменялся).
  Битрикс, туннель, регистрация не выполнялись.
- Итоговый offline suite: **23 passed, 0 failed**, включая реальный corpus regression,
  strict grounding/длину/пробелы цитат, reasoning-only, fenced JSON, усечённый ответ,
  ограниченный output budget и отсутствие автоматического повтора.

## Явно разрешённый тест Hubris / openai/gpt-4o-mini

- Добавлен `scripts/smoke.mjs`: согласие free/paid раздельно, один вызов,
  лимит max_tokens 256–1400, endpoint строго Hubris HTTPS, никаких Bitrix вызовов.
- `.env.example`: mini/1400, offline; реальный `.env` не читался инструментами,
  не менялся. Для теста модель переопределена только в памяти Node-процесса.
- **Один** разрешённый запрос: HTTP 200, `finish_reason=stop`, content присутствует,
  reasoning отсутствует. Результат **grounded=false**, причина `quote_whitespace_mismatch`.
  Цитата отличается от исходного фрагмента пробелами; строгая проверка оставлена.
  Это не функционально успешный нормативный ответ.
- Usage API: prompt_tokens=3115, completion_tokens=201, total_tokens=3316.
  Стоимость по биллингу не проверялась. Повторов и fallback не было.
- В конце **26 passed, 0 failed** offline тестов, включая consent/budget,
  безопасную фильтрацию usage, один mock-вызов и отказ на HTTP 200 с некорректным ответом.
- Сервер live не запускался, Битрикс/туннель/регистрация не выполнялись.

## Offline исправление whitespace grounding

- Добавлен `src/quotes.mjs`: только Unicode White_Space сворачивается в один пробел,
  с картой исходных UTF-16 индексов. Непрерывное совпадение возвращает исходный диапазон;
  `inspectAnswer` заменяет модельную цитату оригиналом из источника, который и выводится.
- Не используются NFKC, смена регистра, удаление пунктуации/слов или fuzzy matching.
  Невидимые не-whitespace символы не игнорируются.
- Лимиты: модельная цитата 40–500, каноническая минимум 40, исходный диапазон максимум 1000.
  Разметка/URL в цитате закрыто отклоняются, а не редактируются как якобы оригинальная цитата.
- **32 passed, 0 failed**: NBSP, multiline, UTF-16 mapping, отрицательные проверки изменённых
  дат, отрицания, пунктуации, регистра, склейки удалённых слов и невидимых не-whitespace.
- Внешних вызовов на этом этапе **ноль**. Предыдущий raw live-ответ не сохранялся;
  его прохождение после исправления **не установлено**, live-успех не подтверждён.
- Реальный `.env` не читался и не изменялся; в изменениях не было необходимости.
  Offline/default, endpoint и лимит конфигурации не переключались.

## Временный туннель (явно разрешён пользователем)

- Официальный cloudflared 2026.11.1 установлен только в user-space; SHA256
  `341deda3db5ec498a0482254d6c38c0b7cf01a30c37bb5dd95d2216d08955e35`
  совпал с опубликованным в официальном GitHub release.
- Перед запуском: **33 passed, 0 failed**, включая отсутствие выдачи/worker без auth,
  закрытые `/health`, `/`, `/.env`, `/src/server.mjs`, GET callback.
- `scripts/tunnel.mjs --prepare` запущен background; готовность получена через IPC
  после регистрации tunnel connection, без polling/sleep.
- Worker принудительно offline, на loopback:8787; реальный authReady=false,
  bootstrapBlocked=true. Ключи не передаются в окружение cloudflared.
- Одноразовый transport smoke локально и через публичный HTTPS:
  GET `/` → 404; GET `/health` → 404; POST `/bitrix/events` с `{}` → 401.
  Нормативных ответов без auth нет. Файлы/база не публикуются.
- Процессы worker/cloudflared проверены работающими; актуальные PID и тестовый URL
  находятся в игнорируемом `.state/tunnel.json`. Автоостановка через два часа.
- `.env` не редактировался и не выводился; никаких LLM или Bitrix API-вызовов,
  сообщений, регистрации бота не выполнялось.
- HTTPS доступность НЕ означает готовность формы регистрации:
  нужен заранее доверенный application_token/member_id и подтверждение bot ID/принадлежности.

## Telegram transport — подготовка без реального токена

- Новый `src/telegram.mjs`: independent long polling, без HTTP/tunnel/Bitrix-секретов.
  Новые Telegram IDs в отдельном allowlist, по умолчанию пусто; Bitrix IDs не дают доступ.
- `--bootstrap --allow-telegram-bootstrap`: только getMe/getUpdates, stdout только numeric
  from.id свежего `/start` в private-чате; ни отправок, ни LLM, ни auto-enrolment.
  Bootstrap проверен только на mock-ответах.
- Polling требует live в процессе и отдельный `--allow-telegram-polling`; без согласия/
  токена/непустого allowlist внешних вызовов нет. Вопросы/документы проходят через Telegram
  и Hubris; корпоративное согласование Telegram не предполагалось.
- Авторизованный `/start` без LLM; затем существующий retrieval/grounding/оригинальные цитаты.
  Sender/chat identity/private/staleness, rate, dedup, 20 queue/50 messages, timeout/size,
  отсутствие платного fallback/broadcast и безопасная обработка token-bearing ошибок.
- **42 passed, 0 failed** (`node --test test/*.test.mjs`), включая 9 новых Telegram тестов.
- CLI без env/token запущен offline: `telegram_offline: no network requests`.
  Реальных Telegram API/Hubris вызовов/сообщений при этой подготовке **ноль**.
- `.env` не читался инструментами и не менялся, ключи не выводились. BotFather — вручную пользователем.
  Старый Bitrix tunnel не останавливался; рекомендована остановка, если его тест больше не нужен.
- Telegram end-to-end/live пока не проверен: нужен новый токен, подтверждённые Telegram IDs
  и отдельное разрешение запуска/отправок.

## Telegram public и отмена квот, попытка запуска @zakfarm26_bot

- По последнему запросу включён явно настраиваемый `TELEGRAM_ACCESS_MODE=public`
  в примере. Default кода по-прежнему allowlist/deny-all, Битрикс 835/626 не изменён.
- Отменены Telegram per-user/day/session квоты и счётчик бюджета; persistent budget-модуль
  удалён до запуска, реальные budget-данные не создавались. Остаются лишь технические
  очередь/дедуп-кеш/таймауты/размеры. Нет rate limit/50-message/1000-poll/2-hour cap для Telegram.
- Public-ответы не содержат локальных путей/служебных имён/Obsidian ссылок: название акта,
  раздел, оригинальная проверенная цитата, официальные URL с exact-host валидацией.
- `node --test test/*.test.mjs`: **48 passed, 0 failed**, включая unknown public private,
  отказ группам, Bitrix unchanged и 60 mock LLM-вызовов одного пользователя без квот.
- Добавлен controlled worker, exclusive lock, stop-скрипт, getMe username check и
  getWebhookInfo перед polling; никакого deleteWebhook или проактивного сообщения.
- Выполнена одна разрешённая background попытка запуска; worker PID 5008 завершился
  до API-запросов: безопасная local диагностика `node --env-file=.env` показала
  `telegram_live_configuration_incomplete`, `tokenConfigured=false`, `publicMode=true`.
  Внешняя process environment не перекрывает токен пустым значением.
- **Бот не запущен.** getMe/проверка username и webhook не выполнены, Telegram/LLM вызовов
  на этапе запуска не было. Пользователю нужно сохранить непустой TELEGRAM_BOT_TOKEN
  локально в .env (Ctrl+S), не присылая ключ в чат. Повтора пока не было.
- Реальная .env не выводилась и не редактировалась, Bitrix live не включён, чужие процессы не завершались.
