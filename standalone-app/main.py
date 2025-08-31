import os
import sys
import tempfile
import time
from typing import List

import keyboard
from PyQt5.QtCore import Qt, QTimer, QPoint, QRect
from PyQt5.QtGui import QCursor, QPainter, QColor
from PyQt5.QtWidgets import (
    QApplication,
    QComboBox,
    QDialog,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QMainWindow,
    QMenu,
    QPushButton,
    QPlainTextEdit,
    QSystemTrayIcon,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

import ip_utils
import providers


class CountdownDialog(QDialog):
    def __init__(self, seconds: int = 3, parent=None):
        super().__init__(parent)
        self.setWindowFlags(Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint)
        self.label = QLabel("", self)
        layout = QVBoxLayout(self)
        layout.addWidget(self.label)
        self.seconds = seconds
        self.timer = QTimer(self)
        self.timer.timeout.connect(self._tick)

    def start(self, callback):
        self.callback = callback
        self._tick()
        self.timer.start(1000)
        self.exec_()

    def _tick(self):
        if self.seconds == 0:
            self.timer.stop()
            self.accept()
            if self.callback:
                self.callback()
            return
        self.label.setText(str(self.seconds))
        self.seconds -= 1


def human_type(target: QWidget, text: str):
    for ch in text:
        QTimer.singleShot(int(50 + 100 * 0.5), lambda c=ch: target.insertPlainText(c))
        QApplication.processEvents()
        time.sleep(0.05)


class RainbowModal(QDialog):
    def __init__(self, answer: str, parent=None):
        super().__init__(parent)
        self.answer = answer
        self.setWindowTitle("Rainbow Modal")
        self.setStyleSheet(
            "RainbowModal {border: 4px solid qlineargradient(spread:pad, x1:0, y1:0, x2:1, y2:0, stop:0 red, stop:0.5 green, stop:1 blue); background: #222;}"
        )
        layout = QVBoxLayout(self)
        layout.addWidget(QLabel("Answer ready"))
        btn_write = QPushButton("Write Here")
        btn_copy = QPushButton("Copy")
        layout.addWidget(btn_write)
        layout.addWidget(btn_copy)
        btn_write.clicked.connect(self.write_here)
        btn_copy.clicked.connect(self.copy)

    def write_here(self):
        self.hide()
        dlg = CountdownDialog(parent=self)
        dlg.start(lambda: human_type(self.parent().focusWidget(), self.answer))
        self.close()

    def copy(self):
        QApplication.clipboard().setText(self.answer)
        self.close()


class LastAnswerWindow(QDialog):
    def __init__(self, answer: str, parent=None):
        super().__init__(parent)
        self.answer = answer
        self.setWindowTitle("Last Answer")
        layout = QVBoxLayout(self)
        layout.addWidget(QLabel(self.answer))
        btn_typing = QPushButton("Start Typing")
        btn_manual = QPushButton("Manual Entry")
        layout.addWidget(btn_typing)
        layout.addWidget(btn_manual)
        btn_typing.clicked.connect(self.start_typing)
        btn_manual.clicked.connect(self.manual_entry)

    def start_typing(self):
        self.hide()
        dlg = CountdownDialog(parent=self)
        dlg.start(lambda: human_type(self.parent().focusWidget(), self.answer))
        self.close()

    def manual_entry(self):
        QApplication.clipboard().setText(self.answer)
        self.close()


class ScreenGrabber(QDialog):
    """Fullscreen overlay that lets the user select a region for OCR."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowFlags(Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint)
        self.setWindowState(Qt.WindowFullScreen)
        self.begin = QPoint()
        self.end = QPoint()
        self.background = QApplication.primaryScreen().grabWindow(0)

    def paintEvent(self, event):  # pragma: no cover - UI painting
        painter = QPainter(self)
        painter.drawPixmap(0, 0, self.background)
        if not self.begin.isNull() and not self.end.isNull():
            painter.setPen(QColor(255, 0, 0))
            painter.drawRect(QRect(self.begin, self.end))

    def mousePressEvent(self, event):  # pragma: no cover
        self.begin = self.end = event.pos()
        self.update()

    def mouseMoveEvent(self, event):  # pragma: no cover
        self.end = event.pos()
        self.update()

    def mouseReleaseEvent(self, event):  # pragma: no cover
        self.end = event.pos()
        self.accept()

    def selected_pixmap(self):
        rect = QRect(self.begin, self.end).normalized()
        return self.background.copy(rect)


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Standalone App")
        self.setStyleSheet("background:#222; color:#eee;")
        central = QWidget()
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)

        top_row = QHBoxLayout()
        for name in [
            "Open-ended",
            "MCQ",
            "Scale",
            "Yes/No",
            "Auto-detect",
            "OCR",
        ]:
            top_row.addWidget(QPushButton(name))
        top_row.addWidget(QPushButton("←"))
        top_row.addWidget(QPushButton("→"))
        layout.addLayout(top_row)

        self.preview = QPlainTextEdit()
        self.preview.setPlaceholderText("Preview area")
        layout.addWidget(self.preview)

        btn_row = QHBoxLayout()
        self.btn_write = QPushButton("Write Here")
        self.btn_copy = QPushButton("Copy")
        self.btn_reset = QPushButton("Reset Context")
        btn_row.addWidget(self.btn_write)
        btn_row.addWidget(self.btn_copy)
        btn_row.addWidget(self.btn_reset)
        layout.addLayout(btn_row)

        self.provider_box = QComboBox()
        self.provider_box.addItems(["OpenRouter", "Gemini", "Cerebras"])
        layout.addWidget(self.provider_box)

        self.ip_label = QLabel("IP: ...")
        layout.addWidget(self.ip_label)

        self.questions: List[str] = []
        self.list_widget = QListWidget()
        layout.addWidget(self.list_widget)

        self.btn_write.clicked.connect(self.write_last_answer)
        self.btn_copy.clicked.connect(self.copy_last_answer)
        self.btn_reset.clicked.connect(self.reset_context)

        self.preview.selectionChanged.connect(self.show_generate_btn)
        self.generate_btn = QPushButton("Generate Answer", self.preview)
        self.generate_btn.hide()
        self.generate_btn.clicked.connect(self.generate_answer)

        self.last_answer = ""

        self.tray = QSystemTrayIcon(self)
        self.tray.setVisible(True)
        menu = QMenu()
        menu.addAction("OCR Capture", self.ocr_capture)
        menu.addAction("Write Last Answer", self.write_last_answer)
        menu.addAction("Clear AI Context", self.reset_context)
        menu.addAction("IP Information", self.show_ip_info)
        self.tray.setContextMenu(menu)

        self.fetch_ip()

        # Global hotkey to generate answer from current clipboard text
        keyboard.add_hotkey(
            "ctrl+shift+g", lambda: QTimer.singleShot(0, self.generate_from_clipboard)
        )

    def fetch_ip(self):
        info = ip_utils.fetch_ip_info()
        self.ip_label.setText(
            f"IP: {info['ip']} | {info['country']} {info['city']} {info['isp']}"
        )

    def show_ip_info(self):
        self.fetch_ip()

    def reset_context(self):
        self.questions.clear()
        self.list_widget.clear()
        self.last_answer = ""
        self.preview.clear()

    def copy_last_answer(self):
        QApplication.clipboard().setText(self.last_answer)

    def write_last_answer(self):
        if not self.last_answer:
            return
        dlg = LastAnswerWindow(self.last_answer, self)
        dlg.exec_()

    def ocr_capture(self):
        grabber = ScreenGrabber(self)
        if grabber.exec_() == QDialog.Accepted:
            pixmap = grabber.selected_pixmap()
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
            tmp_path = tmp.name
            tmp.close()
            pixmap.save(tmp_path)
            text = providers.ocr_image(tmp_path)
            os.unlink(tmp_path)
            if text:
                self.generate_answer_for_text(text)

    def show_generate_btn(self):
        cursor = self.preview.textCursor()
        if cursor.hasSelection():
            rect = self.preview.cursorRect(cursor)
            self.generate_btn.move(rect.topRight())
            self.generate_btn.show()
        else:
            self.generate_btn.hide()

    def generate_answer(self):
        text = self.preview.textCursor().selectedText()
        self.generate_answer_for_text(text)

    def generate_from_clipboard(self):
        text = QApplication.clipboard().text().strip()
        if text:
            self.generate_answer_for_text(text)

    def generate_answer_for_text(self, text: str):
        if not text:
            return
        provider = self.provider_box.currentText()
        answer = providers.generate(text, provider)
        self.last_answer = answer
        self.questions.append(text)
        self.questions = self.questions[-5:]
        self.list_widget.clear()
        self.list_widget.addItems(self.questions)
        dlg = RainbowModal(answer, self)
        dlg.exec_()


if __name__ == "__main__":
    app = QApplication(sys.argv)
    w = MainWindow()
    w.resize(800, 600)
    w.show()
    sys.exit(app.exec_())
