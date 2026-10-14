# LLM API 연결 (models.json)

pi 는 **OpenAI 호환 API**(`/v1/chat/completions`)로 LLM 을 씁니다. vLLM, Ollama, 사내 LLM 게이트웨이처럼 같은 형식이면 됩니다.
[README 2장](../README.md#2-설치)의 설치를 마친 뒤 이 문서대로 `~/.pi/agent/models.json` 과 `settings.json` 을 고칩니다.

## 1. 주소와 모델 이름 확인
노트북의 터미널에서:
```bash
curl -s http://VLLM주소:8000/v1/models
```
- 결과의 `"id"` 가 모델 이름입니다 (예: `"id": "Qwen/Qwen3-32B"`). `models.json` 에는 이 이름을 **그대로** 적습니다.
- 같은 클러스터 안의 서비스면 주소는 보통 `http://<서비스>.<네임스페이스>.svc.cluster.local:<포트>/v1` 입니다 (`kubectl get svc -n <네임스페이스>` 로 이름·포트 확인, 권한이 있을 때).
- 키를 받아야 하는 서버면: `curl -s -H "Authorization: Bearer <키>" http://VLLM주소:8000/v1/models`
- 아무것도 나오지 않거나 오류가 나면 pi 도 연결하지 못합니다. 주소·포트, 그 서버로 가는 사내망 경로, 프록시를 확인합니다.
- **프록시:** pi 는 노트북의 프록시 환경변수를 따릅니다 (`http_proxy`·`https_proxy`·`no_proxy`, 소문자가 있으면 소문자를 먼저 봄). `env | grep -i proxy` 에 값이 있으면 LLM 주소가 `no_proxy` 에 있어야 프록시를 거치지 않습니다.
  예: `~/.bashrc` 에 아래 한 줄을 넣고 새 터미널 (`.svc.cluster.local` 은 그 이름으로 끝나는 주소 모두, `10.0.0.5` 는 LLM 서버 주소의 예):
  ```bash
  export no_proxy="${no_proxy:-$NO_PROXY},.svc.cluster.local,10.0.0.5"; export NO_PROXY="$no_proxy"
  ```

## 2. models.json
`~/.pi/agent/models.json` (설치할 때 만든 틀이 있음) 의 `VLLM-서버-주소`, `vLLM-에-올린-모델-이름` 을 바꿉니다.
```json
{
  "providers": {
    "vllm": {
      "baseUrl": "http://10.0.0.5:8000/v1",
      "api": "openai-completions",
      "apiKey": "EMPTY",
      "compat": {
        "supportsDeveloperRole": false
      },
      "models": [
        { "id": "Qwen/Qwen3-32B", "name": "Qwen3 32B (사내 vLLM)", "contextWindow": 32768, "maxTokens": 8192 }
      ]
    }
  }
}
```

| 항목 | 넣을 값 |
|---|---|
| `baseUrl` | 서버 주소 + `/v1` (끝에 `/chat/completions` 는 붙이지 않음) |
| `api` | `openai-completions` 그대로 |
| `apiKey` | 키가 없는 서버면 아무 글(`EMPTY`). 키가 있으면 그 값, 또는 파일에 적지 않으려면 `"$VLLM_API_KEY"` 처럼 환경변수 이름 (`~/.bashrc` 에 `export VLLM_API_KEY=...`). 다른 머리글이 더 필요한 게이트웨이면 provider 에 `"headers": { "이름": "값" }` |
| `compat.supportsDeveloperRole` | `false` 그대로 (vLLM·Ollama 는 `developer` 역할을 모름) |
| `models[].id` | 1장에서 본 모델 이름 그대로 |
| `models[].name` | `/model` 목록에 보일 이름 (아무 글) |
| `models[].contextWindow` | 서버가 받는 최대 길이. vLLM 은 `--max-model-len` 값. **이보다 크게 적지 마세요** (대화가 길어질 때 pi 가 앞 대화를 요약하는 기준) |
| `models[].maxTokens` | 답 한 번의 최대 길이 (보통 4096~8192). 답이 중간에 끊기면 늘립니다 |

`~/.pi/agent/settings.json` 의 기본 모델도 같은 이름으로 바꿉니다:
```json
{
  "defaultProvider": "vllm",
  "defaultModel": "Qwen/Qwen3-32B",
  "enableInstallTelemetry": false
}
```
- 파일은 **UTF-8** 로 저장합니다. 마지막 항목 뒤에는 쉼표를 넣지 않습니다.
- pi 안에서 `/model` 을 열면 `models.json` 을 다시 읽습니다. 고르고 `Ctrl+S` 를 누르면 `settings.json` 의 기본 모델이 바뀝니다.

## 3. 확인
```bash
cd ~ && pi -p "bash 로 echo hello 를 실행하고 결과를 알려줘"
```
- `hello` 를 실행했다는 답이 나오면 됩니다. 그다음부터는 작업 폴더에서 `pi` 를 실행합니다.
- 명령을 실행하지 않고 글로만 답하거나("bash 로 실행하면 ..."), 도구 관련 오류가 나면 4장.
- 오류가 나면 7장.

## 4. 도구 호출(tool calling)이 켜져 있어야 합니다
pi 는 OpenAI 방식 **도구 호출**로 파일을 읽고 고치고 명령을 실행합니다. vLLM 서버가 도구 호출을 켠 상태로 떠 있어야 합니다.
```
vllm serve <모델> --enable-auto-tool-choice --tool-call-parser <모델에 맞는 파서>
```
- 파서는 모델 계열마다 다릅니다. 예: Qwen 계열 `hermes`, Llama 3.x `llama3_json`, Mistral `mistral` (vLLM 문서의 'Tool Calling' 에 전체 목록).
- 꺼져 있으면 pi 가 명령을 실행하지 못하고 글로만 답하거나 오류가 납니다. vLLM 운영 담당에게 위 옵션을 부탁하세요.
- 작은 모델일수록 도구 호출을 자주 틀립니다. 코딩 작업에는 도구 호출을 잘하는 모델(보통 30B 안팎 이상)을 권합니다.

## 5. 모델·서버 여러 개
- `models` 에 여러 개를 적으면 `/model`(또는 `Ctrl+L`)에서 고르고, `Ctrl+P` 로 다음 모델로 바꿉니다.
- 서버가 여러 대면 `providers` 에 이름을 달리해 더합니다 (예: `"vllm"`, `"vllm-big"`). 기본은 `settings.json` 의 `defaultProvider`·`defaultModel`.
- 시작할 때 고르기: `pi --model Qwen/Qwen3-32B`
- 생각(thinking) 기능이 있는 모델(Qwen3 등)은 모델에 `"reasoning": true`, provider 의 `compat` 에 `"thinkingFormat": "qwen-chat-template"` 을 넣으면 pi 의 `/thinking` 으로 켜고 끕니다
  (vLLM 에 `chat_template_kwargs.enable_thinking` 으로 보냄. pi 0.87.1 의 형식이며 실제 서버로는 시험하지 못했습니다).

## 6. Ollama 로 시험할 때
Ollama 도 같은 형식(OpenAI 호환 `/v1`)이라 그대로 쓸 수 있습니다. 같은 노트북 안에서 띄웠으면 주소는 `http://127.0.0.1:11434/v1`.
```json
"ollama": {
  "baseUrl": "http://OLLAMA주소:11434/v1",
  "api": "openai-completions",
  "apiKey": "ollama",
  "compat": { "supportsDeveloperRole": false },
  "models": [{ "id": "qwen3:8b", "contextWindow": 32768, "maxTokens": 8192 }]
}
```
- 모델이 도구 호출을 지원해야 합니다: `curl -s http://주소:11434/api/show -d '{"model":"qwen3:8b"}'` 의 `capabilities` 에 `tools` 가 있어야 함.
- Ollama 의 문맥 길이는 모델 설정(`num_ctx`)을 따릅니다. `contextWindow` 를 그보다 크게 적지 마세요.

## 7. 자주 나는 오류
| 증상 | 확인할 것 |
|---|---|
| `Connection error.` / 연결 시간 초과 | 1장의 `curl` 이 되는지 (주소·포트·사내망 경로). `curl` 은 되는데 pi 만 안 되면 `no_proxy` (1장의 프록시) |
| `401` / `Unauthorized` | `apiKey` (환경변수로 적었으면 그 터미널에 값이 있는지 `echo $VLLM_API_KEY`) |
| `404` / `model ... does not exist` | `models[].id` 가 1장의 `id` 와 글자 하나까지 같은지 |
| `developer` 역할 오류 | `compat.supportsDeveloperRole` 이 `false` 인지 |
| `maximum context length` / 길이 초과 | `contextWindow` 를 서버의 최대 길이(`--max-model-len`) 이하로, `maxTokens` 를 줄이기. 긴 대화는 `/compact` 또는 `/new` |
| `/model` 목록에 모델이 없음 | `models.json` 의 JSON 형식 (쉼표·따옴표), `apiKey` 가 비어 있지 않은지 |
| 명령을 실행하지 않고 글로만 답함 | 4장 (서버의 도구 호출 옵션, 모델의 도구 호출 능력) |
| 답이 중간에 끊김 | `maxTokens` 늘리기 |
