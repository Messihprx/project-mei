#!/usr/bin/env python3
"""
Servidor local de desenvolvimento para o FinMEI.

Faz o rewrite de URLs limpas (sem .html) para os arquivos .html da pasta public/,
igual ao que o Netlify faz em producao via netlify.toml.

Uso:
    python server.py
    # depois acesse http://localhost:8000/planos  (em vez de /planos.html)
"""

import http.server
import socketserver
import os
from urllib.parse import unquote, urlparse

PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
PORT = 8000


class CleanURLHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def translate_path(self, path):
        """
        Recebe uma URL como /planos ou /dashboard e devolve o caminho do arquivo
        public/planos.html ou public/dashboard.html se existir.
        """
        # Remove query string e fragmentos
        path = urlparse(path).path
        path = unquote(path)

        # Se ja termina em .html, serve normalmente
        if path.endswith(".html"):
            return super().translate_path(path)

        # Se e raiz "/", serve index.html
        if path == "/" or path == "":
            return os.path.join(PUBLIC_DIR, "index.html")

        # Tenta adicionar .html no final
        candidato = path.lstrip("/") + ".html"
        caminho_completo = os.path.join(PUBLIC_DIR, candidato)

        if os.path.isfile(caminho_completo):
            return caminho_completo

        # Se nao encontrar, deixa o handler padrao retornar 404
        return super().translate_path(path)

    def guess_type(self, path):
        base = super().guess_type(path)
        if base == "text/html" or path.endswith(".html"):
            return "text/html; charset=utf-8"
        return base

    def end_headers(self):
        # Evita cache agressivo durante o desenvolvimento
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    with socketserver.TCPServer(("", PORT), CleanURLHandler) as httpd:
        print(f"Servidor rodando em http://localhost:{PORT}")
        print(f"Sirvendo a pasta: {PUBLIC_DIR}")
        print("Acesse: http://localhost:8000/  (landing page)")
        print("        http://localhost:8000/login")
        print("        http://localhost:8000/dashboard")
        print("        http://localhost:8000/planos")
        print("Pressione Ctrl+C para parar.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServidor parado.")