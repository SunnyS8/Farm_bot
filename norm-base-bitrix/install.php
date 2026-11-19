<?php
declare(strict_types=1);
require __DIR__ . '/src/bootstrap.php';
if (!$isAdmin) { http_response_code(403); exit('Только администратор портала.'); }
$checks = [
    'PHP >= 7.4'=>version_compare(PHP_VERSION, '7.4', '>='),
    'PDO SQLite'=>extension_loaded('pdo_sqlite'),
    'mbstring'=>extension_loaded('mbstring'),
    'ZipArchive (DOCX)'=>class_exists('ZipArchive'),
    'cURL (ИИ)'=>function_exists('curl_init'),
];
$message = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!check_bitrix_sessid()) { http_response_code(403); exit('Недействительная сессия.'); }
    try {
        if (!$checks['PHP >= 7.4'] || !$checks['PDO SQLite'] || !$checks['mbstring']) throw new RuntimeException();
        $db = normStore();
        $db->db->exec(file_get_contents(__DIR__ . '/migrations/001.sql'));
        $message = 'Схема подготовлена. Существующие документы не изменены.';
    } catch (\Throwable $e) { $message = 'Не удалось подготовить схему. Проверьте расширения и приватное хранилище.'; }
}
?>
<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Установка нормативной базы</title><link rel="stylesheet" href="assets/app.css">
<main><h1>Диагностика / установка</h1><p>Только локальная схема. Приложение в Bitrix24 не регистрируется. Секреты и пути не выводятся.</p>
<ul><?php foreach ($checks as $label=>$ok): ?><li><?=htmlspecialchars($label, ENT_QUOTES, 'UTF-8')?>: <?=$ok ? 'доступно' : 'НЕТ'?></li><?php endforeach ?></ul>
<p><?=htmlspecialchars($message, ENT_QUOTES, 'UTF-8')?></p>
<form method="post"><?=bitrix_sessid_post()?><button>Подготовить схему</button></form><p><a href="index.php">Открыть приложение</a></p></main></html>
