#!/usr/bin/env python3
"""Bounded TLS/PROXY acceptance probe; emits no response bodies or credentials."""
import argparse
import ipaddress
import json
import socket
import ssl
import struct
import sys
import time


PROBE_TIMEOUT_SECONDS = 5


def proxy_frame(kind, source, destination, destination_port):
    if kind == "none":
        return b""
    if kind == "unknown":
        return b"PROXY UNKNOWN\r\n"
    signature = b"\r\n\r\n\x00\r\nQUIT\n"
    if kind == "local":
        return signature + b"\x20\x00\x00\x00"
    client = ipaddress.ip_address(source)
    target = ipaddress.ip_address(destination)
    if client.version != target.version:
        raise ValueError("PROXY source and destination families must match")
    if kind == "v1":
        return f"PROXY TCP{client.version} {client} {target} 45157 {destination_port}\r\n".encode()
    addresses = client.packed + target.packed + struct.pack("!HH", 45157, destination_port)
    family = b"\x11" if client.version == 4 else b"\x21"
    return signature + b"\x21" + family + struct.pack("!H", len(addresses)) + addresses


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("host")
    parser.add_argument("--port", type=int, default=443)
    parser.add_argument("--sni", default="sachkov.dev")
    parser.add_argument("--path", default="/")
    parser.add_argument("--proxy", choices=["none", "v1", "v2", "unknown", "local"], default="none")
    parser.add_argument("--source", default="8.8.8.8")
    parser.add_argument("--destination", default="201.24.126.23")
    parser.add_argument("--destination-port", type=int, default=443)
    parser.add_argument("--expect", default="200", help="HTTP status or rejected")
    args = parser.parse_args()
    if not args.path.startswith("/") or any(c in args.path + args.sni for c in "\r\n"):
        parser.error("invalid HTTP request target")
    frame = proxy_frame(args.proxy, args.source, args.destination, args.destination_port)
    started = time.monotonic()
    deadline = started + PROBE_TIMEOUT_SECONDS
    def remaining():
        seconds = deadline - time.monotonic()
        if seconds <= 0:
            raise TimeoutError("overall probe deadline exceeded")
        return seconds
    result = {"sni": args.sni, "target": f"{args.host}:{args.port}", "proxy": args.proxy,
              "claimed_source": args.source if args.proxy in ("v1", "v2") else None}
    try:
        with socket.create_connection((args.host, args.port), timeout=remaining()) as connection:
            connection.settimeout(remaining())
            connection.sendall(frame)
            context = ssl.create_default_context()
            connection.settimeout(remaining())
            with context.wrap_socket(connection, server_hostname=args.sni) as tls:
                result["tls"] = tls.version()
                tls.settimeout(remaining())
                tls.sendall(f"GET {args.path} HTTP/1.1\r\nHost: {args.sni}\r\nConnection: close\r\nX-Forwarded-For: 127.0.0.1\r\nX-Real-IP: 127.0.0.1\r\nX-Inside-Production-Verify: entry-probe-1575\r\n\r\n".encode())
                response = b""
                while b"\r\n\r\n" not in response and len(response) < 65536:
                    tls.settimeout(remaining())
                    chunk = tls.recv(4096)
                    if not chunk:
                        break
                    response += chunk
                result["status"] = int(response.split(b" ", 2)[1])
                result["passed"] = str(result["status"]) == args.expect
    except (OSError, ValueError, IndexError) as error:
        result["error"] = type(error).__name__
        # A timeout is inconclusive, never proof of deliberate rejection.
        result["passed"] = args.expect == "rejected" and isinstance(error, (ConnectionResetError, BrokenPipeError, ssl.SSLEOFError))
    result["seconds"] = round(time.monotonic() - started, 3)
    print(json.dumps(result, sort_keys=True))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
