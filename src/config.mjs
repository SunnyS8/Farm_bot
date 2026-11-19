export const VAULT_ROOT = String.raw`C:\Users\saruchevaad\Desktop\Эском\База знаний\Нормативные документы_2026-11-18`;
export const ALLOWED_USERS = Object.freeze(['835', '626']);

export function configuration(env = process.env) {
  const mode = env.RUN_MODE || 'offline';
  if (!['offline', 'live'].includes(mode)) throw new Error('invalid_mode');
  const port = Number(env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid_port');
  const domain = env.BITRIX_DOMAIN || 'crm.escom.group';
  if (domain !== 'crm.escom.group') throw new Error('invalid_portal');
  const maxTokens = Number(env.LLM_MAX_TOKENS || 1400);
  if (!Number.isInteger(maxTokens) || maxTokens < 256 || maxTokens > 8192)
    throw new Error('invalid_output_budget');
  const c = {
    mode, port, domain, memberId: env.BITRIX_MEMBER_ID || '',
    applicationToken: env.BITRIX_APPLICATION_TOKEN || '', botId: env.BITRIX_BOT_ID || '',
    webhook: env.BITRIX_WEBHOOK_URL || '', clientId: env.BITRIX_CLIENT_ID || '',
    protocol: env.LLM_PROTOCOL || '', provider: env.LLM_PROVIDER || '',
    endpoint: env.LLM_ENDPOINT || '', model: env.LLM_MODEL || '', apiKey: env.LLM_API_KEY || '', maxTokens,
  };
  c.authReady = Boolean(c.memberId && c.applicationToken.length >= 16 && /^[1-9]\d*$/.test(c.botId));
  if (mode === 'live') {
    if (!c.authReady || !c.clientId || !c.provider || !c.model || !c.apiKey ||
        c.protocol !== 'openai-chat-completions') throw new Error('live_configuration_incomplete');
    let webhook, endpoint;
    try { webhook = new URL(c.webhook); endpoint = new URL(c.endpoint); }
    catch { throw new Error('invalid_endpoint'); }
    if (webhook.origin !== `https://${domain}` ||
        !/^\/rest\/[1-9]\d*\/[A-Za-z0-9_-]+\/$/.test(webhook.pathname) ||
        webhook.search || webhook.hash || webhook.username || webhook.password)
      throw new Error('invalid_webhook');
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password ||
        endpoint.hash || endpoint.search) throw new Error('invalid_llm_endpoint');
  }
  return Object.freeze(c);
}
