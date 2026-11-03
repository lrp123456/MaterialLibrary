#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Strip hardcoded API keys from providers.js and merge secrets on seed."""
import re
p = "/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/src/providers.js"
s = open(p, encoding="utf-8").read()

# add require after vlm require
if "require('./secrets')" not in s:
    s = s.replace(
        "const { chatVision, resolveChatCompletionsUrl } = require('./vlm');",
        "const { chatVision, resolveChatCompletionsUrl } = require('./vlm');\nconst { loadProviderSecrets } = require('./secrets');",
        1,
    )

# blank out api_key string literals in DEFAULT_PROVIDERS block only (before DEFAULT_MODELS)
head, sep, tail = s.partition("const DEFAULT_MODELS")
if not sep:
    raise SystemExit("DEFAULT_MODELS not found")
# replace known keys and any long sk-/ark-/AIza/gsk_ keys
head2 = re.sub(r"api_key:\s*'[^']*'", "api_key: ''", head)
head2 = re.sub(
    r"secrets_json:\s*JSON\.stringify\(\{\s*masterKey:\s*'[^']*'\s*\}\)",
    "secrets_json: JSON.stringify({})",
    head2,
)
s = head2 + sep + tail

# merge secrets into seed loop
old = """  for (const p of DEFAULT_PROVIDERS) {
    insProv.run({ ...p, now });
  }"""
new = """  const secrets = loadProviderSecrets();
  for (const p of DEFAULT_PROVIDERS) {
    const sec = secrets[p.id] || {};
    const merged = {
      ...p,
      api_key: sec.api_key || p.api_key || '',
      secrets_json: sec.secrets_json || p.secrets_json || JSON.stringify({}),
      now,
    };
    if (sec.masterKey && !sec.secrets_json) {
      merged.secrets_json = JSON.stringify({ masterKey: sec.masterKey });
    }
    insProv.run(merged);
  }"""
if old not in s:
    raise SystemExit("seed loop not found")
s = s.replace(old, new, 1)

open(p, "w", encoding="utf-8").write(s)
# verify no remaining long keys in DEFAULT_PROVIDERS
head, sep, _ = s.partition("const DEFAULT_MODELS")
leftover = re.findall(r"sk-[A-Za-z0-9]{20,}|ark-[A-Za-z0-9-]{20,}|AIza[A-Za-z0-9_-]{20,}|gsk_[A-Za-z0-9]{20,}", head)
print("leftover_keys_in_defaults", leftover)
print("has_secrets_require", "loadProviderSecrets" in s)
print("has_merge_loop", "const secrets = loadProviderSecrets" in s)
