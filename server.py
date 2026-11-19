"""本地打开言镜演示。只提供本目录网页，不上传画面。"""
import mimetypes
import os
import socket
import threading
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "web"
HOST = "127.0.0.1"
PORT_START = 8765

mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".mjs")


class DemoServer(ThreadingHTTPServer):
    allow_reuse_address = False

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def make_server(port):
    handler = partial(SimpleHTTPRequestHandler, directory=str(ROOT))
    return DemoServer((HOST, port), handler)


def choose_port():
    for port in range(PORT_START, PORT_START + 10):
        try:
            return make_server(port)
        except OSError:
            continue
    raise SystemExit("8765 到 8774 端口都被占用了")


def main():
    httpd = choose_port()
    url = f"http://{HOST}:{httpd.server_address[1]}/"
    print("言镜演示：", url, flush=True)
    print("操作：允许摄像头 → 记下自然口型 → 选「衣」或「鱼」→ 口型做明显 → F 全屏", flush=True)
    print("正式演示不要打开界面预演，不要比较「无」或「乌」", flush=True)
    if os.environ.get("YANJING_NO_BROWSER") != "1":
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("已关闭")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
