#!/usr/bin/env python3
"""Gera a versão standalone de matriz_tgca_municipios.html.

O arquivo de origem é um fragmento: quem publica como Artifact fornece
<!doctype>, <head> e <body>. Para distribuir o arquivo solto (e-mail,
pendrive, anexo) ele precisa do documento completo e não pode depender
de rede, então aqui envolvemos o fragmento e embutimos as fontes.

    python3 tools/build_standalone.py
"""
import base64, re, sys, urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ORIGEM = RAIZ / "matriz_tgca_municipios.html"
DESTINO = RAIZ / "dist" / "matriz_tgca_municipios.html"
CSS = ("https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700"
       "&family=IBM+Plex+Mono:wght@400;500&display=swap")
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36"}
# Português precisa só de latin; latin-ext entra para nomes com grafia estrangeira.
SUBCONJUNTOS = ("latin", "latin-ext")


def baixar(url: str) -> bytes:
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read()


def fontes_embutidas() -> str:
    css = baixar(CSS).decode("utf-8")
    blocos, atual = [], None
    for trecho in css.split("/*"):
        nome, _, corpo = trecho.partition("*/")
        if nome.strip() in SUBCONJUNTOS and "@font-face" in corpo:
            blocos.append(corpo.strip())
    saida = []
    for bloco in blocos:
        url = re.search(r"url\((https://[^)]+)\)", bloco)
        if not url:
            continue
        dados = base64.b64encode(baixar(url.group(1))).decode("ascii")
        saida.append(bloco.replace(url.group(1), f"data:font/woff2;base64,{dados}"))
    if not saida:
        raise SystemExit("nenhuma @font-face encontrada — o formato do CSS mudou?")
    return "\n".join(saida)


def main() -> None:
    fragmento = ORIGEM.read_text(encoding="utf-8")
    titulo = re.search(r"<title>(.*?)</title>", fragmento, re.S)
    titulo = titulo.group(1).strip() if titulo else "Matriz TGCA × População"

    # Fora as <link> de rede; as fontes passam a viajar dentro do arquivo.
    fragmento = re.sub(r'^\s*<link\s[^>]*>\s*$', "", fragmento, flags=re.M)
    fragmento = fragmento.replace(f"<title>{titulo}</title>", "", 1).lstrip()

    try:
        arroba = f"<style>\n{fontes_embutidas()}\n</style>\n"
    except Exception as erro:                                  # noqa: BLE001
        print(f"aviso: fontes não embutidas ({erro}); o arquivo cairá no sans do sistema",
              file=sys.stderr)
        arroba = ""

    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    DESTINO.write_text(
        "<!doctype html>\n"
        '<html lang="pt-BR">\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>{titulo}</title>\n"
        f"{arroba}"
        "</head>\n<body>\n"
        f"{fragmento}\n"
        "</body>\n</html>\n",
        encoding="utf-8",
    )
    print(f"{DESTINO.relative_to(RAIZ)} — {DESTINO.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
