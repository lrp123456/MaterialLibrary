import re

config_path = '/home/lrp/my_folder/smu/KX2BFK_umbra_quick/services/litellm/config.yaml'
with open(config_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace model_list section for Google models
old_google = """  - model_name: gemini-flash-latest
    litellm_params:
      model: openai/gemini-flash-latest
      api_base: https://generativelanguage.googleapis.com/v1beta/openai
      api_key: os.environ/GEMINI_API_KEY
  - model_name: gemini-flash-lite-latest
    litellm_params:
      model: openai/gemini-flash-lite-latest
      api_base: https://generativelanguage.googleapis.com/v1beta/openai
      api_key: os.environ/GEMINI_API_KEY
  - model_name: gemma-4-31b
    litellm_params:
      model: openai/gemma-4-31b
      api_base: https://generativelanguage.googleapis.com/v1beta/openai
      api_key: os.environ/GEMINI_API_KEY
  - model_name: gemma-4-26b
    litellm_params:
      model: openai/gemma-4-26b
      api_base: https://generativelanguage.googleapis.com/v1beta/openai
      api_key: os.environ/GEMINI_API_KEY"""

new_google = """  - model_name: gemini-2.5-flash
    litellm_params:
      model: openai/gemini-2.5-flash
      api_base: https://generativelanguage.googleapis.com/v1beta/openai
      api_key: os.environ/GEMINI_API_KEY
  - model_name: gemini-flash-latest
    litellm_params:
      model: openai/gemini-flash-latest
      api_base: https://generativelanguage.googleapis.com/v1beta/openai
      api_key: os.environ/GEMINI_API_KEY
  - model_name: gemini-flash-lite-latest
    litellm_params:
      model: openai/gemini-flash-lite-latest
      api_base: https://generativelanguage.googleapis.com/v1beta/openai
      api_key: os.environ/GEMINI_API_KEY
  - model_name: gemini-2.5-flash-lite
    litellm_params:
      model: openai/gemini-2.5-flash-lite
      api_base: https://generativelanguage.googleapis.com/v1beta/openai
      api_key: os.environ/GEMINI_API_KEY
  - model_name: gemini-3.1-flash-lite
    litellm_params:
      model: openai/gemini-3.1-flash-lite
      api_base: https://generativelanguage.googleapis.com/v1beta/openai
      api_key: os.environ/GEMINI_API_KEY
  - model_name: gemma-4-26b-a4b-it
    litellm_params:
      model: openai/gemma-4-26b-a4b-it
      api_base: https://generativelanguage.googleapis.com/v1beta/openai
      api_key: os.environ/GEMINI_API_KEY"""

old_fallbacks = """  fallbacks:
    - agnes-3.0-flash: ["gemini-flash-latest", "doubao-seed-2-0-lite-260428"]
    - gemini-flash-latest: ["gemini-flash-lite-latest", "doubao-seed-2-0-lite-260428"]
    - gemini-flash-lite-latest: ["doubao-seed-2-0-lite-260428"]
    - gemma-4-31b: ["gemini-flash-latest", "doubao-seed-2-0-lite-260428"]
    - gemma-4-26b: ["gemini-flash-lite-latest", "doubao-seed-2-0-lite-260428"]"""

new_fallbacks = """  fallbacks:
    - gemini-flash-latest: ["gemini-2.5-flash", "gemini-flash-lite-latest", "doubao-seed-2-0-lite-260428"]
    - gemini-2.5-flash: ["gemini-flash-lite-latest", "gemini-3.1-flash-lite", "doubao-seed-2-0-lite-260428"]
    - gemini-flash-lite-latest: ["gemini-2.5-flash-lite", "doubao-seed-2-0-lite-260428"]
    - gemini-2.5-flash-lite: ["gemini-3.1-flash-lite", "doubao-seed-2-0-lite-260428"]
    - gemini-3.1-flash-lite: ["gemini-2.5-flash", "doubao-seed-2-0-lite-260428"]
    - gemma-4-26b-a4b-it: ["gemini-2.5-flash", "doubao-seed-2-0-lite-260428"]
    - agnes-3.0-flash: ["gemini-2.5-flash", "doubao-seed-2-0-lite-260428"]"""

if old_google in content and old_fallbacks in content:
    content = content.replace(old_google, new_google).replace(old_fallbacks, new_fallbacks)
    with open(config_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("Successfully updated services/litellm/config.yaml")
else:
    print("Pattern match failed!")
    print("old_google in content?", old_google in content)
    print("old_fallbacks in content?", old_fallbacks in content)
