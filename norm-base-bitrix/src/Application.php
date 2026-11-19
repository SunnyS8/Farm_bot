<?php
declare(strict_types=1);
namespace NormBase;

final class Application
{
    private Storage $s;
    private int $actor;
    public function __construct(Storage $s, int $actor) { $this->s = $s; $this->actor = $actor; }

    public function upload(array $post, array $file, int $limit): array
    {
        if (($file['error'] ?? -1) !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'] ?? '')) {
            throw new \InvalidArgumentException('Загрузка не получена. Проверьте upload_max_filesize/post_max_size.');
        }
        $size = filesize($file['tmp_name']);
        if ($size < 1 || $size > $limit) throw new \InvalidArgumentException('Превышен размер файла.');
        $name = Domain::text($file['name'] ?? '', 240);
        $name = basename(str_replace('\\', '/', $name));
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        if (!in_array($ext, ['pdf','doc','docx','html','htm'], true)) throw new \InvalidArgumentException('Разрешены PDF, DOC, DOCX, HTML.');
        Domain::signature($file['tmp_name'], $ext);
        $extracted = in_array($ext, ['html','htm'], true) ? Domain::htmlText(file_get_contents($file['tmp_name'])) : '';
        if (mb_strlen($extracted) > 200000) $extracted = mb_substr($extracted, 0, 200000);
        $stored = bin2hex(random_bytes(24)) . '.blob';
        $path = $this->s->root . '/originals/' . $stored;
        $target = fopen($path, 'x+b'); // Exclusive creation; never overwrite an original.
        if (!$target) throw new \RuntimeException('Не удалось сохранить оригинал.');
        try {
            $source = fopen($file['tmp_name'], 'rb');
            if (!$source) throw new \RuntimeException('Не удалось прочитать загрузку.');
            $written = stream_copy_to_stream($source, $target);
            fclose($source); fclose($target); $target = null;
            if ($written !== $size) throw new \RuntimeException('Неполная запись.');
            chmod($path, 0600);
            $this->s->db->beginTransaction();
            $doc = filter_var($post['document_id'] ?? 0, FILTER_VALIDATE_INT);
            if ($doc) {
                if (!$this->s->rows('SELECT id FROM documents WHERE id=?', [$doc])) throw new \InvalidArgumentException('Документ не найден.');
            } else {
                $title = Domain::text($post['title'] ?? '', 500);
                $this->s->run('INSERT INTO documents(title,created_at,created_by) VALUES(?,?,?)', [$title, gmdate('c'), $this->actor]);
                $doc = (int)$this->s->db->lastInsertId();
            }
            $status = $ext === 'pdf' ? 'ocr_needed' : 'pending_review';
            $this->s->run('INSERT INTO versions(document_id,original_name,stored_name,extension,sha256,bytes,status,extracted_text,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)',
                [$doc,$name,$stored,$ext,hash_file('sha256',$path),$size,$status,$extracted,gmdate('c'),$this->actor]);
            $id = (int)$this->s->db->lastInsertId();
            $this->s->audit($this->actor, 'upload', $id);
            $this->s->db->commit();
            return ['document_id'=>$doc,'version_id'=>$id];
        } catch (\Throwable $e) {
            if (is_resource($target)) fclose($target);
            if ($this->s->db->inTransaction()) $this->s->db->rollBack();
            @unlink($path); throw $e;
        }
    }

    public function review(array $p): array
    {
        $id = (int)($p['version_id'] ?? 0);
        $from = Domain::date($p['effective_from'] ?? null, true);
        $to = Domain::date($p['effective_to'] ?? null);
        Domain::interval($from, $to);
        $sourceDate = Domain::date($p['source_date'] ?? null, true);
        $url = Domain::text($p['source_url'] ?? '', 2000, false);
        if ($url !== '' && (!filter_var($url, FILTER_VALIDATE_URL) || parse_url($url, PHP_URL_SCHEME) !== 'https' || parse_url($url, PHP_URL_USER) !== null)) {
            throw new \InvalidArgumentException('Источник: HTTPS URL без учётных данных или пустое поле.');
        }
        $items = $p['provisions'] ?? [];
        if (!is_array($items) || count($items) < 1 || count($items) > 100) throw new \InvalidArgumentException('Нужно от 1 до 100 проверенных фрагментов.');
        $valid = [];
        foreach ($items as $item) {
            if (!is_array($item)) throw new \InvalidArgumentException('Некорректный фрагмент.');
            $f = Domain::date($item['effective_from'] ?? $from, true);
            $t = Domain::date($item['effective_to'] ?? $to);
            Domain::interval($f, $t);
            if ($f < $from || ($to !== null && ($t === null || $t > $to))) throw new \InvalidArgumentException('Срок пункта должен находиться внутри срока редакции.');
            $valid[] = [Domain::text($item['locator'] ?? '', 300), Domain::text($item['body'] ?? '', 6000), $f, $t];
        }
        $this->s->db->beginTransaction();
        try {
            $this->s->run("UPDATE versions SET status='ready',source_url=?,source_date=?,effective_from=?,effective_to=?,reviewed_at=?,reviewed_by=? WHERE id=? AND status!='ready'",
                [$url,$sourceDate,$from,$to,gmdate('c'),$this->actor,$id]);
            if ($this->s->db->query('SELECT changes()')->fetchColumn() != 1) throw new \InvalidArgumentException('Редакция не найдена или уже проверена. Для исправления создайте новую редакцию.');
            foreach ($valid as $item) $this->s->run('INSERT INTO provisions(version_id,locator,body,effective_from,effective_to) VALUES(?,?,?,?,?)', array_merge([$id], $item));
            $this->s->audit($this->actor, 'review', $id);
            $this->s->db->commit(); return ['version_id'=>$id];
        } catch (\Throwable $e) { $this->s->db->rollBack(); throw $e; }
    }
}
