# Standalone App

A standalone PyQt5 application styled to match the browser extension's dark theme. It demonstrates multiple answer types, IP lookup,
floating tools, provider selection and packaging with PyInstaller.

Additional features include:

- **Global Hotkey** `Ctrl+Shift+G` to generate an answer for any text copied to the clipboard.
- **OCR Capture** from the system tray to select a screen region, run OCR.space and feed the text back into the generator.
- **In-app API Key manager** to store keys for OpenRouter, Gemini, Cerebras and OCR.space without editing files.

## Setup

```
pip install -r requirements.txt
```

## Run

```
python main.py
```

## Build Windows Executable

Use PyInstaller to create a standalone exe:

```
pyinstaller --noconsole --onefile --name StandaloneApp main.py
```
