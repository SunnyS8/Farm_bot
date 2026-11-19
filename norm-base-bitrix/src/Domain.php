<?php
declare(strict_types=1);
namespace NormBase;

final class Domain
{
    public static function text($value, int $max, bool $required = true): string
    {
        if (!is_string($value) || !mb_check_encoding($value, 'UTF-8') ||
            mb_strlen($value) > $max || strpos($value, "\0") !== false) {
            throw new \InvalidArgumentException('Некорректный текст или превышен лимит.');
        }
        $value = trim($value);
        if ($required && $value === '') {
            throw new \InvalidArgumentException('Заполните обязательное поле.');
        }
        return $value;
    }

    public static function date($value, bool $required = false): ?string
    {
        if (($value === '' || $value === null) && !$required) return null;
        if (!is_string($value)) throw new \InvalidArgumentException('Некорректная дата.');
        $d = \DateTimeImmutable::createFromFormat('!Y-m-d', $value);
        if (!$d || $d->format('Y-m-d') !== $value) throw new \InvalidArgumentException('Дата должна иметь формат ГГГГ-ММ-ДД.');
        return $value;
    }

    public static function interval(string $from, ?string $to): void
    {
        if ($to !== null && $to < $from) throw new \InvalidArgumentException('Окончание раньше начала.');
    }

    public static function signature(string $path, string $ext): void
    {
        $head = file_get_contents($path, false, null, 0, 8192);
        $ok = false;
        if ($ext === 'pdf') $ok = strncmp($head, '%PDF-', 5) === 0;
        if ($ext === 'doc') $ok = substr($head, 0, 8) === hex2bin('d0cf11e0a1b11ae1');
        if ($ext === 'docx' && class_exists('\ZipArchive')) {
            $z = new \ZipArchive();
            if ($z->open($path) === true) {
                $ok = $z->locateName('[Content_Types].xml') !== false && $z->locateName('word/document.xml') !== false;
                $z->close(); // Never unpack archives; macros/embedded objects are never executed.
            }
        }
        if (in_array($ext, ['html', 'htm'], true)) {
            $ok = mb_check_encoding(file_get_contents($path), 'UTF-8') &&
                preg_match('/<(?:!doctype\s+html|html|body|head)(?:\s|>)/i', $head) === 1;
        }
        if (!$ok) throw new \InvalidArgumentException('Формат не подтверждён сигнатурой (DOCX требует ZipArchive).');
    }

    public static function htmlText(string $html): string
    {
        $html = preg_replace('~<(script|style)\b[^>]*>.*?</\1\s*>~is', '', $html);
        $html = preg_replace('~</?(?:p|div|br|li|h[1-6]|tr)\b[^>]*>~i', "\n", $html);
        return trim(html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
    }

    public static function exactQuote(string $source, $quote): bool
    {
        // Deliberately stricter than pilot whitespace-normalization: literal substring only.
        return is_string($quote) && mb_strlen($quote) >= 15 && mb_strlen($quote) <= 1500 &&
            strpos($source, $quote) !== false;
    }
}
