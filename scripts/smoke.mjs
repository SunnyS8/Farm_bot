import { pathToFileURL } from 'node:url';
import { configuration } from '../src/config.mjs';
import { loadCorpus, search } from '../src/retrieval.mjs';
import { generate, REFUSAL } from '../src/adapters.mjs';

// No env-file reads here: Node loads the key into this process with --env-file.
// Importing this module never makes a request. One explicit consent per invocation.
export async function runSmoke({
  args = process.argv.slice(2), env = process.env, transport = fetch,
  corpusLoader = loadCorpus, write = value => console.log(JSON.stringify(value)),
} = {}) {
  const flags = new Map();
  for (const arg of args) {
    const [name, ...value] = arg.split('=');
    if (!['--model', '--max-tokens', '--allow-one-free-request', '--allow-one-paid-request'].includes(name) ||
        flags.has(name)) throw new Error('invalid_smoke_arguments');
    flags.set(name, value.length ? value.join('=') : true);
  }
  const paid = flags.get('--allow-one-paid-request') === true;
  const free = flags.get('--allow-one-free-request') === true;
  if (paid === free) throw new Error('one_explicit_consent_required');
  const configured = configuration(env);
  const model = flags.get('--model') ?? configured.model;
  const maxTokens = Number(flags.get('--max-tokens') ?? 1400);
  if (configured.mode !== 'offline' || configured.endpoint !== 'https://api.hubris.pw/v1/chat/completions' ||
      configured.protocol !== 'openai-chat-completions' || !configured.apiKey ||
      typeof model !== 'string' || !/^[A-Za-z0-9_.:/-]{1,150}$/.test(model) ||
      !Number.isInteger(maxTokens) || maxTokens < 256 || maxTokens > 1400 ||
      (free && !model.endsWith(':free')) || (paid && model.endsWith(':free')))
    throw new Error('smoke_configuration_not_allowed');
  const question = 'Когда вступит в силу 331-ФЗ?';
  const { chunks, files } = await corpusLoader();
  const sources = search(chunks, question).slice(0, 4);
  let requests = 0;
  const oneRequest = async (url, options) => {
    const payload = JSON.parse(options.body);
    if (++requests !== 1 || url !== configured.endpoint || payload.model !== model ||
        payload.max_tokens !== maxTokens || options.redirect !== 'error')
      throw new Error('smoke_request_not_allowed');
    const response = await transport(url, options);
    write({ httpStatus: response.status });
    return response;
  };
  let diagnostic;
  const answer = await generate({ ...configured, mode: 'live', model, maxTokens },
    question, sources, oneRequest, info => { diagnostic = info; });
  const grounded = answer !== REFUSAL;
  write({ model, maxTokens, requests, files, sourceCount: sources.length,
    configuredRunMode: configured.mode, grounded, diagnostic });
  if (grounded) write({ answer });
  return { grounded, requests };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runSmoke();
    if (!result.grounded) process.exitCode = 2;
  } catch {
    console.error('smoke_failed: no credentials, headers, reasoning or upstream error body logged');
    process.exitCode = 1;
  }
}
