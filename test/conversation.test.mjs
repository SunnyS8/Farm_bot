import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationMemory } from '../src/conversation.mjs';

test('conversation memory restores one act for a follow-up and keeps chats isolated', () => {
  let now = 1_000_000;
  const memory = createConversationMemory({ ttlMs: 60_000, clock: () => now });
  const first = 'Что меняет Федеральный закон № 331-ФЗ, статья 5?';
  assert.equal(memory.contextualize('100', first), first);
  assert.deepEqual(memory.inspect('100'), { lawId: '331-фз', article: '5' });
  assert.equal(memory.inspect('200'), null);
  const followUp = memory.contextualize('100', 'А когда она вступает в силу?');
  assert.match(followUp, /Федеральный закон № 331-ФЗ/);
  assert.match(followUp, /последняя обсуждавшаяся статья 5/);
  assert.doesNotMatch(memory.contextualize('200', 'А когда она вступает в силу?'), /Контекст диалога/);
});

test('conversation memory expires, resets, and never inherits ambiguous multi-act questions', () => {
  let now = 2_000_000;
  const memory = createConversationMemory({ ttlMs: 10_000, maxEntries: 2, clock: () => now });
  memory.contextualize('1', 'Расскажи про 331-ФЗ');
  assert.doesNotMatch(memory.contextualize('1', 'Сравни 331-ФЗ и 44-ФЗ'), /Контекст диалога/);
  memory.clear('1');
  assert.equal(memory.inspect('1'), null);
  memory.contextualize('1', 'Расскажи про 331-ФЗ');
  now += 10_000;
  assert.doesNotMatch(memory.contextualize('1', 'А подробнее?'), /Контекст диалога/);
});
