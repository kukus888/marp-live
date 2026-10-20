.PHONY: web build
web:
	cd web && npm install && npm run build
build:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o marp-live .
build-windows:
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o marp-live.exe .
