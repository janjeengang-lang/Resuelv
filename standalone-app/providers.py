import configparser
import requests

CONFIG = configparser.ConfigParser()
CONFIG.read("config.ini")


def _get_key(section):
    return CONFIG.get(section, "api_key", fallback="")


def generate(prompt: str, provider: str) -> str:
    provider = provider.lower()
    try:
        if provider == "openrouter":
            key = _get_key("openrouter")
            url = "https://openrouter.ai/api/v1/chat/completions"
            headers = {"Authorization": f"Bearer {key}"}
            data = {
                "model": "openrouter/gpt-3.5-turbo",
                "messages": [{"role": "user", "content": prompt}],
            }
            r = requests.post(url, headers=headers, json=data, timeout=60)
            return r.json().get("choices", [{}])[0].get("message", {}).get("content", "")
        if provider == "gemini":
            key = _get_key("gemini")
            url = (
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent"
                f"?key={key}"
            )
            data = {"contents": [{"parts": [{"text": prompt}]}]}
            r = requests.post(url, json=data, timeout=60)
            return (
                r.json()
                .get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "")
            )
        if provider == "cerebras":
            key = _get_key("cerebras")
            url = "https://api.cerebras.ai/v1/chat/completions"
            headers = {"Authorization": f"Bearer {key}"}
            data = {
                "model": "llama2_70b",
                "messages": [{"role": "user", "content": prompt}],
            }
            r = requests.post(url, headers=headers, json=data, timeout=60)
            return r.json().get("choices", [{}])[0].get("message", {}).get("content", "")
    except Exception:
        return ""
    return ""


def ocr_image(image_path: str, provider: str = "ocrspace") -> str:
    if provider.lower() != "ocr.space" and provider.lower() != "ocrspace":
        raise ValueError("Only OCR.space provider is supported")
    key = _get_key("ocrspace")
    url = "https://api.ocr.space/parse/image"
    try:
        with open(image_path, "rb") as f:
            files = {"file": f}
            data = {"apikey": key}
            r = requests.post(url, files=files, data=data, timeout=60)
            return r.json()["ParsedResults"][0]["ParsedText"]
    except Exception:
        return ""
