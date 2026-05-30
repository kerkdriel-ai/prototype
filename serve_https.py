#!/usr/bin/env python3
"""
Simple HTTPS static file server for local development.

Usage:
  1) Generate a self-signed cert and key (see README) or use mkcert.
  2) Run: python3 serve_https.py --cert cert.pem --key key.pem --port 5173

This serves the current directory over HTTPS using the provided cert/key.
"""
import argparse
import http.server
import ssl
import sys


def run(port, certfile, keyfile):
    handler = http.server.SimpleHTTPRequestHandler
    server = http.server.ThreadingHTTPServer(('0.0.0.0', port), handler)
    try:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certfile=certfile, keyfile=keyfile)
        server.socket = context.wrap_socket(server.socket, server_side=True)
    except Exception as e:
        print('Failed to load cert/key:', e)
        sys.exit(1)

    print(f'Serving HTTPS on https://0.0.0.0:{port} (ctrl-C to stop)')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped')


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--port', '-p', type=int, default=5173)
    p.add_argument('--cert', required=True, help='Path to cert.pem')
    p.add_argument('--key', required=True, help='Path to key.pem')
    args = p.parse_args()
    run(args.port, args.cert, args.key)


if __name__ == '__main__':
    main()
