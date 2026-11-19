<?php
declare(strict_types=1);
require __DIR__ . '/src/bootstrap.php';
try {
    $db = normStore();
    $rows = $db->rows('SELECT stored_name,extension,sha256,status FROM versions WHERE id=?', [(int)($_GET['id'] ?? 0)]);
    if (!$rows || (!$isAdmin && $rows[0]['status'] !== 'ready')) { http_response_code(404); exit('Не найдено.'); }
    $v = $rows[0];
    if (!preg_match('/^[a-f0-9]{48}\.blob$/D', $v['stored_name'])) throw new RuntimeException();
    $file = $db->root . '/originals/' . $v['stored_name'];
    if (is_link($file) || !is_file($file) || !hash_equals($v['sha256'], hash_file('sha256', $file))) throw new RuntimeException();
    header("Content-Security-Policy: sandbox; default-src 'none'; frame-ancestors 'none'");
    header('Content-Type: application/octet-stream');
    header('Content-Disposition: attachment; filename="norm-version-' . (int)$_GET['id'] . '.' . $v['extension'] . '"');
    header('Content-Length: ' . filesize($file));
    readfile($file);
} catch (\Throwable $e) { http_response_code(503); echo 'Оригинал недоступен или нарушена целостность.'; }
