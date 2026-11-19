export function reviewPayload(versionId, values) {
  const provisions = JSON.parse(values.provisions);
  if (!Array.isArray(provisions) || !provisions.length) throw new Error('Нужен массив проверенных фрагментов.');
  return {version_id: versionId, source_url: values.source_url, source_date: values.source_date,
    effective_from: values.effective_from, effective_to: values.effective_to, provisions};
}
export function originalLink(id) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new Error('Некорректный ID');
  return `download.php?id=${Number(id)}`;
}
