# Standalone App

A simple dark-themed application built with PyQt5. It demonstrates multiple answer types, IP lookup,
floating tools, provider selection and packaging with PyInstaller.

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
