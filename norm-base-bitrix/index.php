<?php
declare(strict_types=1);
require __DIR__ . '/src/bootstrap.php';
?>
<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="csrf-token" content="<?=htmlspecialchars(bitrix_sessid(), ENT_QUOTES, 'UTF-8')?>">
<title>Нормативная база · Эском</title><link rel="stylesheet" href="assets/app.css"></head>
<body data-admin="<?=$isAdmin ? '1' : '0'?>">
<header><span class="brand">ЭСКОМ / ЗНАНИЯ</span><h1>Нормативная база</h1><p>Документы, история редакций и проверяемые цитаты — в одном месте.</p></header>
<main><nav aria-label="Разделы"><a href="#documents">Документы</a><a href="#consultant">Консультант</a><?php if ($isAdmin): ?><a href="install.php">Диагностика</a><?php endif ?></nav>
<p id="notice" role="status" aria-live="polite"></p>
<section id="documents"><div class="heading"><h2>Документы</h2><button id="refresh" type="button">Обновить</button></div>
<p class="muted">Последние 200 документов. Загрузка новой редакции сама по себе не подтверждает её действие.</p>
<div class="table-wrap"><table><thead><tr><th>Документ</th><th>Редакций</th><th>Действие</th></tr></thead><tbody id="document-list"></tbody></table></div>
<?php if ($isAdmin): ?>
<details><summary>Загрузить документ / новую редакцию</summary><form id="upload-form" enctype="multipart/form-data">
<label>Название нового документа<input name="title" maxlength="500"></label>
<label>ID существующего документа (пусто — новый)<input name="document_id" type="number" min="1"></label>
<label>Оригинал · PDF, DOC, DOCX, HTML<input name="file" type="file" accept=".pdf,.doc,.docx,.html,.htm" required></label>
<p>PDF/сканы требуют внешнего извлечения или ручной сверки. Оригиналы не перезаписываются.</p><button>Загрузить в очередь проверки</button></form></details>
<?php endif ?>
</section>
<section id="detail" hidden aria-labelledby="detail-title"><h2 id="detail-title">История документа</h2><div id="version-list"></div></section>
<section id="consultant"><span class="eyebrow">С ОПОРОЙ НА ИСТОЧНИКИ</span><h2>Нормативный консультант</h2><p>Подбирает дословные выдержки из проверенных пунктов на указанную дату. Это не юридическое заключение.</p>
<form id="ask-form"><label>Ваш вопрос<textarea name="question" required maxlength="2000" rows="3" placeholder="Какие требования установлены к…"></textarea></label>
<label>По состоянию на дату<input type="date" name="date" required></label><p class="muted">При включённом ИИ вопрос и до 6 фрагментов отправляются внешнему провайдеру Hubris.</p><button>Найти подтверждённые цитаты</button></form><div id="answer" aria-live="polite"></div></section>
<footer>Первый рабочий срез · неизвестные и пересекающиеся сроки не трактуются как действующая норма.</footer>
</main><script type="module" src="assets/app.js"></script></body></html>
