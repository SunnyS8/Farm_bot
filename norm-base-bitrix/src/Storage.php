<?php
declare(strict_types=1);
namespace NormBase;

final class Storage
{
    public \PDO $db;
    public string $root;

    public function __construct(string $root, string $documentRoot)
    {
        $real = realpath($root);
        $web = realpath($documentRoot);
        if (!$real || !$web || !is_dir($real) || !is_writable($real)) {
            throw new \RuntimeException('Private storage must exist and be writable.');
        }
        $a = strtolower(str_replace('\\', '/', $real)) . '/';
        $b = strtolower(str_replace('\\', '/', $web)) . '/';
        if (strpos($a, $b) === 0) throw new \RuntimeException('Storage must be outside DOCUMENT_ROOT.');
        $this->root = $real;
        if (!is_dir($real . '/originals') && !mkdir($real . '/originals', 0700)) throw new \RuntimeException('Cannot create originals.');
        if (is_link($real . '/originals')) throw new \RuntimeException('Symlink originals denied.');
        $this->db = new \PDO('sqlite:' . $real . '/norm-base.sqlite', null, null, [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
        ]);
        $this->db->exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    }

    public function rows(string $sql, array $params = []): array
    {
        $s = $this->db->prepare($sql); $s->execute($params); return $s->fetchAll();
    }

    public function run(string $sql, array $params = []): void
    {
        $s = $this->db->prepare($sql); $s->execute($params);
    }

    public function audit(int $actor, string $action, int $id): void
    {
        $this->run('INSERT INTO audit(actor_id,action,entity_id,happened_at) VALUES(?,?,?,?)', [$actor, $action, $id, gmdate('c')]);
    }
}
