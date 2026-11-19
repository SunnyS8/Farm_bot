<?php
declare(strict_types=1);
// php tests/domain.php (requires mbstring and pdo_sqlite); no Bitrix or network needed.
require __DIR__ . '/../src/Domain.php';
require __DIR__ . '/../src/Storage.php';
require __DIR__ . '/../src/Application.php';
require __DIR__ . '/../src/Consultant.php';
use NormBase\Domain;
use NormBase\Consultant;
function check(bool $ok, string $name): void { if (!$ok) throw new RuntimeException($name); echo "OK $name\n"; }
function rejects(callable $fn): bool { try {$fn(); return false;} catch (InvalidArgumentException $e) {return true;} }
check(Domain::date('2024-02-29') === '2024-02-29', 'leap date');
check(rejects(fn()=>Domain::date('2026-02-29')), 'invalid date');
check(rejects(fn()=>Domain::interval('2026-11-19','2026-01-01')), 'reversed interval');
check(rejects(fn()=>Domain::text("a\0b", 20)), 'NUL');
check(Domain::htmlText('<html><script>alert(1)</script><p>Текст</p></html>') === 'Текст', 'HTML to plain text');
check(!Domain::exactQuote('Точный оригинал документа', 'придуманная цитата'), 'invented quote');
$quote='Точная длинная цитата нормативного документа.';
$context=[['id'=>1,'body'=>$quote,'title'=>'Акт','locator'=>'п.1','version_id'=>2,'document_id'=>3,'source_url'=>'','source_date'=>'2026-11-19','effective_from'=>'2026-01-01','effective_to'=>null]];
check(count(Consultant::verify(['citations'=>[['source_id'=>1,'quote'=>$quote]]],$context))===1,'verified quote');
check(Consultant::verify(['citations'=>[['source_id'=>99,'quote'=>$quote]]],$context)===[],'foreign source ID');
check(Consultant::verify(['citations'=>[['source_id'=>1,'quote'=>'Несуществующий фрагмент из выдуманного текста.']]],$context)===[],'hallucination');
// Real sqlite integration in isolated temp folder, deleted on completion.
$root=sys_get_temp_dir().'/norm-base-test-'.bin2hex(random_bytes(6)); mkdir($root,0700);
$web=$root.'-web'; mkdir($web,0700);
try {
    $s=new NormBase\Storage($root,$web);
    $s->db->exec(file_get_contents(__DIR__.'/../migrations/001.sql'));
    $s->run('INSERT INTO documents(title,created_at,created_by) VALUES(?,?,?)',['Акт',gmdate('c'),1]);
    $s->run("INSERT INTO versions(document_id,original_name,stored_name,extension,sha256,bytes,status,created_at,created_by) VALUES(1,'a.pdf',?,'pdf','hash',1,'pending_review',?,1)",[str_repeat('a',48).'.blob',gmdate('c')]);
    $app=new NormBase\Application($s,1);
    $p=['version_id'=>1,'source_date'=>'2026-11-19','source_url'=>'','effective_from'=>'2026-01-01','effective_to'=>'2026-12-31','provisions'=>[['locator'=>'п.1','body'=>$quote,'effective_from'=>'2026-02-01','effective_to'=>'2026-11-30']]];
    $app->review($p);
    check($s->rows('SELECT status FROM versions')[0]['status']==='ready','review publishes atomically');
    check(rejects(fn()=>$app->review($p)), 'published revision immutable');
    $answer=Consultant::ask($s,['ai_enabled'=>false],['question'=>'нормативного документа','date'=>'2027-01-01']);
    check($answer['citations']===[], 'expired provisions excluded');
} finally {
    unset($app,$s); foreach(glob($root.'/*') as $file) {if(is_file($file)) unlink($file);}
    @rmdir($root.'/originals'); @rmdir($root); @rmdir($web);
}
