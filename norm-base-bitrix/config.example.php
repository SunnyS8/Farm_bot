<?php
// Copy OUTSIDE DOCUMENT_ROOT. Point NORM_BASE_CONFIG environment variable to it.
return [
    'storage_dir' => '/srv/private/norm-base',
    'max_upload_bytes' => 20 * 1024 * 1024,
    // Only portal administrators ($USER->IsAdmin()) can administer the app.
    // Empty list means all authenticated INTERNAL employees. External users denied.
    'reader_group_ids' => [],
    // AI is opt-in. No outgoing calls while disabled.
    'ai_enabled' => false,
    // Obtain the exact OpenAI-compatible HTTPS endpoint from Hubris administrator.
    'ai_endpoint' => '',
    'ai_token' => '',
    'ai_model' => 'openai/gpt-4o-mini',
];
