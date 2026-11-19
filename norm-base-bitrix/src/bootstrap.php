<?php
declare(strict_types=1);

// Authentication MUST precede private config/database access.
$prolog = rtrim($_SERVER['DOCUMENT_ROOT'] ?? '', '/') . '/bitrix/modules/main/include/prolog_before.php';
if (!is_file($prolog)) { http_response_code(503); exit('Требуется коробочный Bitrix24 на том же хосте.'); }
require_once $prolog;
global $USER;
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('Cache-Control: no-store, private');
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'self'");
if (!is_object($USER) || !$USER->IsAuthorized()) { http_response_code(401); exit('Войдите в Bitrix24.'); }
$isAdmin = (bool)$USER->IsAdmin();
// Extranet users may also have an authorized session; fail closed for all non-employees.
$u = \CUser::GetByID((int)$USER->GetID())->Fetch();
if (!$u || !empty($u['EXTERNAL_AUTH_ID'])) { http_response_code(403); exit('Только внутренние сотрудники.'); }
if (\Bitrix\Main\Loader::includeModule('extranet') && !\CExtranet::IsIntranetUser()) {
    http_response_code(403); exit('Экстранет не поддерживается.');
}
require_once __DIR__ . '/Domain.php';
require_once __DIR__ . '/Storage.php';
require_once __DIR__ . '/Application.php';
require_once __DIR__ . '/Consultant.php';
$configPath = getenv('NORM_BASE_CONFIG');
$resolved = $configPath ? realpath($configPath) : false;
$web = realpath($_SERVER['DOCUMENT_ROOT']);
if (!$resolved || !$web || strpos(strtolower(str_replace('\\', '/', $resolved)), strtolower(str_replace('\\', '/', $web)) . '/') === 0) {
    http_response_code(503); exit('Администратор должен настроить приватный NORM_BASE_CONFIG.');
}
$config = require $resolved;
if (!is_array($config)) { http_response_code(503); exit('Ошибка конфигурации.'); }
$groups = array_map('intval', $USER->GetUserGroupArray());
$allowed = array_map('intval', $config['reader_group_ids'] ?? []);
if (!$isAdmin && $allowed && !array_intersect($allowed, $groups)) { http_response_code(403); exit('Нет доступа к базе.'); }
$actor = (int)$USER->GetID();
$store = null;
function normStore(): \NormBase\Storage {
    global $store, $config;
    if ($store === null) $store = new \NormBase\Storage($config['storage_dir'] ?? '', $_SERVER['DOCUMENT_ROOT']);
    return $store;
}
