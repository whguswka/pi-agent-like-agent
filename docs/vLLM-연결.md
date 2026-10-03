# Jupyter용 pi — 사내 vLLM 연결

`jupyter` 설정은 **Kubeflow JupyterLab 터미널**에서 pi 를 실행하고, 사내 **vLLM**(OpenAI 호환 API)을 LLM 으로 씁니다.
설치는 [설치.md](설치.md) 의 0~2단계(풀기, Node 확인, `bash install.sh jupyter`)를 먼저 끝내세요.

## 1. models.json 수정
`~/.pi/agent/models.json` 을 열어 아래 항목을 바꿉니다.

| 항목 | 넣을 값 |
|---|---|
| `baseUrl` | vLLM 주소 + `/v1` (예: `http://10.0.0.5:8000/v1`) |
| `apiKey` | vLLM 을 `--api-key` 로 띄웠으면 그 값, 아니면 아무 값(`EMPTY`) |
| `models[].id` | vLLM 의 모델 이름. `curl -s http://주소:8000/v1/models` 결과의 `id` |
| `contextWindow` | vLLM 의 `--max-model-len` 값 |
| `maxTokens` | 답 한 번의 최대 길이 (보통 4096~8192) |

`~/.pi/agent/settings.json` 의 `defaultModel` 도 같은 모델 이름으로 바꿉니다.

## 2. 확인
```bash
curl -s http://VLLM주소:8000/v1/models      # 노트북에서 vLLM 이 보이는지
pi -p "bash 로 echo hello 를 실행하고 결과를 알려줘"
```
`hello` 를 실행했다는 답이 나오면 됩니다. 그 다음부터는 작업 폴더에서 `pi` 를 실행합니다.
```bash
cd ~/work/프로젝트이름
pi
```

## 3. 도구 호출이 안 될 때
pi 는 OpenAI 방식 **도구 호출(tool calling)** 로 파일을 읽고 명령을 실행합니다.
vLLM 서버가 도구 호출을 켠 상태로 실행되어 있어야 합니다.
```
vllm serve <모델> --enable-auto-tool-choice --tool-call-parser <모델에 맞는 파서>
```
- 파서 예: Qwen 계열 `hermes`, Llama 3.x `llama3_json`, Mistral `mistral` (vLLM 문서의 Tool Calling 참고)
- 꺼져 있으면 pi 가 명령을 실행하지 못하고 글로만 답하거나 오류가 납니다. vLLM 운영 담당에게 위 옵션을 요청하세요.
- `developer` 역할 관련 오류가 나면 `compat` 의 `supportsDeveloperRole` 이 `false` 인지 확인합니다 (기본값).

## 4. Ollama 로 시험할 때
Ollama 도 같은 형식(OpenAI 호환 `/v1`)이라 그대로 쓸 수 있습니다.
```json
"ollama": {
  "baseUrl": "http://OLLAMA주소:11434/v1",
  "api": "openai-completions",
  "apiKey": "ollama",
  "models": [{ "id": "gemma4:e4b", "contextWindow": 65536, "maxTokens": 8192 }]
}
```
- 모델이 도구 호출을 지원해야 합니다: `curl -s http://주소:11434/api/show -d '{"model":"gemma4:e4b"}'` 의 `capabilities` 에 `tools` 가 있어야 함.
- Ollama 의 문맥 길이는 모델 설정(`num_ctx`)을 따릅니다. `contextWindow` 를 그보다 크게 적지 마세요.
