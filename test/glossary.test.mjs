import test from 'node:test';
import assert from 'node:assert/strict';
import { glossaryAnswer, isDefinitionQuestion } from '../src/legal-glossary.mjs';

test('СПС is answered from the curated legal glossary outside the local corpus', () => {
  const answer = glossaryAnswer('Что такое СПС?');
  assert.match(answer, /справочная правовая система/i);
  assert.match(answer, /КонсультантПлюс/);
  assert.match(answer, /ГАРАНТ/);
  assert.match(answer, /официальн/);
  assert.equal(glossaryAnswer('Что говорит статья 5?'), null);
});

test('only short definition questions can use general consultation mode', () => {
  assert.equal(isDefinitionQuestion('Что означает аккредитация?'), true);
  assert.equal(isDefinitionQuestion('Перечисли действующие нормы и дай юридическое заключение'), false);
  assert.equal(isDefinitionQuestion('Что такое ' + 'x'.repeat(600)), false);
});
