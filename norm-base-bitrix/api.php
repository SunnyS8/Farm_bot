<?php
declare(strict_types=1);
require __DIR__ . '/src/bootstrap.php';
header('Content-Type: application/json; charset=utf-8');
try {
    $action = $_GET['action'] ?? '';
    $method = $_SERVER['REQUEST_METHOD'];
    if ($method === 'POST') {
        if (!check_bitrix_sessid()) { http_response_code(403); echo json_encode(['error'=>'Недействительная сессия. Обновите страницу.']); exit; }
        if (in_array($action, ['upload','review'], true) && !$isAdmin) { http_response_code(403); exit('{"error":"Только администратор"}'); }
        if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > (int)($config['max_upload_bytes'] ?? 20971520) + 1000000) throw new InvalidArgumentException('Слишком большой запрос.');
        $db = normStore();
        $app = new \NormBase\Application($db, $actor);
        if ($action === 'upload') {
            $f = $_FILES['file'] ?? null;
            if (!is_array($f) || ($f['error'] ?? -1) !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) throw new InvalidArgumentException('Ошибка загрузки. Проверьте upload_max_filesize/post_max_size.');
            if (filesize($f['tmp_name']) < 1 || filesize($f['tmp_name']) > (int)($config['max_upload_bytes'] ?? 20971520)) throw new InvalidArgumentException('Недопустимый размер файла.');
            $result = $app->upload($_POST, $f, (int)($config['max_upload_bytes'] ?? 20971520));
        } elseif ($action === 'review') {
            $p = json_decode(\NormBase\Domain::text($_POST['payload'] ?? '', 700000), true, 16, JSON_THROW_ON_ERROR);
            if (!is_array($p)) throw new InvalidArgumentException('Некорректная редакция.');
            $result = $app->review($p);
        } elseif ($action === 'ask') {
            // Session serializes calls; additionally cap per-user outgoing attempts.
            $last = (int)($_SESSION['norm_base_last_ask'] ?? 0);
            if (time() - $last < 15) { http_response_code(429); exit('{"error":"Повторите через 15 секунд"}'); }
            $_SESSION['norm_base_last_ask'] = time();
            $p = json_decode(\NormBase\Domain::text($_POST['payload'] ?? '', 4000), true, 8, JSON_THROW_ON_ERROR);
            if (!is_array($p)) throw new InvalidArgumentException('Некорректный вопрос.');
            $result = \NormBase\Consultant::ask($db, $config, $p);
        } else { http_response_code(404); exit('{"error":"Неизвестный маршрут"}'); }
    } elseif ($method === 'GET') {
        $db = normStore();
        if ($action === 'list') {
            $result = ['documents'=>$db->rows('SELECT d.id,d.title,d.created_at,COUNT(v.id) AS version_count FROM documents d LEFT JOIN versions v ON v.document_id=d.id GROUP BY d.id ORDER BY d.id DESC LIMIT 200')];
        } elseif ($action === 'detail') {
            $id = (int)($_GET['id'] ?? 0);
            $docs = $db->rows('SELECT * FROM documents WHERE id=?', [$id]);
            if (!$docs) { http_response_code(404); exit('{"error":"Документ не найден"}'); }
            $columns = 'id,document_id,original_name,extension,sha256,bytes,status,source_url,source_date,effective_from,effective_to,created_at,reviewed_at';
            if ($isAdmin) $columns .= ',extracted_text';
            $versions = $db->rows("SELECT $columns FROM versions WHERE document_id=? ORDER BY id DESC", [$id]);
            foreach ($versions as &$v) $v['provisions'] = $db->rows('SELECT locator,body,effective_from,effective_to FROM provisions WHERE version_id=? ORDER BY id', [$v['id']]);
            unset($v); $result = ['document'=>$docs[0], 'versions'=>$versions];
        } else { http_response_code(404); exit('{"error":"Неизвестный маршрут"}'); }
    } else { http_response_code(405); header('Allow: GET, POST'); exit('{"error":"Метод запрещён"}'); }
    echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
} catch (\InvalidArgumentException | \JsonException $e) {
    http_response_code(422); echo json_encode(['error'=>$e->getMessage()], JSON_UNESCAPED_UNICODE);
} catch (\Throwable $e) {
    // Do not disclose paths, tokens, document contents, upstream bodies, or stack traces.
    http_response_code(503); echo json_encode(['error'=>'Операция недоступна. Проверьте конфигурацию, схему и зависимости; для ИИ — подключение Hubris.'], JSON_UNESCAPED_UNICODE);
}
