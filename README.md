# marp-live

Live [Marp](https://marp.app) presentation editor: Markdown on the left, rendered slides on the right, with synced scrolling.

Features: save/load on server, PDF export (browser print dialog → "Save as PDF"), Mermaid diagrams (```` ```mermaid ````), custom CSS styles stored server-side and chosen in the UI.

## Run (target machine, no dependencies)

    ./marp-live -addr 127.0.0.1:8080 -data ./data

Data is stored in `data/presentations/*.md` and `data/styles/*.css`.

## Develop

Node.js is only needed to rebuild the frontend bundle (`web/static/dist/app.js`, committed so `go build` works alone):

    make web     # bundle frontend
    make build   # static linux/amd64 binary (frontend embedded)
