// A deliberately narrow, single-request diagnostic. No Bitrix calls, no secret output.
import { configuration } from '../src/config.mjs';
import { loadCorpus, search } from '../src/retrieval.mjs';
import { generate, REFUSAL } from '../src/adapters.mjs';

try {
  if (!process.argv.includes('--allow-one-free-request')) throw new Error('explicit_opt_in_required');
  const configured = configuration();
  if (configured.mode !== 'offline' ||
      configured.endpoint !== 'https://api.hubris.pw/v1/chat/completions' ||
      configured.model !== 'dots-studio/dots-3-note-preview:free' ||
      configured.protocol !== 'openai-chat-completions' || !configured.apiKey)
    throw new Error('configuration_not_allowed');
  const question = 'Когда вступит в силу 331-ФЗ?';
  const { chunks, files } = await loadCorpus();
  const sources = search(chunks, question);
  let calls = 0;
  const transport = async (url, options) => {
    if (++calls !== 1 || url !== configured.endpoint ||
        JSON.parse(options.body).model !== configured.model) throw new Error('request_not_allowed');
    const response = await fetch(url, options);
    console.log(JSON.stringify({ httpStatus: response.status }));
    return response;
  };
  const answer = await generate({ ...configured, mode: 'live' }, question, sources, transport,
    info => console.log(JSON.stringify({ diagnostic: info })));
  console.log(JSON.stringify({
    files, sourceFiles: sources.map(s => s.file), requests: calls,
    grounded: answer !== REFUSAL, configuredRunMode: configured.mode, maxTokens: configured.maxTokens,
  }));
  // Only a validated answer on a public normative test question; never raw model reasoning.
  if (answer !== REFUSAL) console.log(answer);
  if (answer === REFUSAL) process.exitCode = 2;
} catch {
  console.error('free_test_failed: no headers, credentials or upstream error body logged');
  process.exitCode = 1;
}
