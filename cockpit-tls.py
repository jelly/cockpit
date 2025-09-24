#!/usr/bin/python

import argparse
import asyncio
import socket
import ssl


def parse_args():
    parser = argparse.ArgumentParser(description="cockpit-tls")
    parser.add_argument("-p", "--port", type=int, help="Local port to bind to (9090 if unset)", default=9090)
    parser.add_argument("--no-tls", action="store_true", help="Don't use TLS")
    parser.add_argument("--idle-timeout", type=int, default=90,
                        help="time after which to exit if there are no connections; 0 to run forever (default: 90)")
    return parser.parse_args()


def create_ssl_context(certfile, keyfile):
    context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    context.load_cert_chain(certfile=certfile, keyfile=keyfile)
    return context


async def handle_client(client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter):
    print('new client')
    try:
        first_byte = await client_reader.read(1)
        if not first_byte:
            client_writer.close()
            await client_writer.wait_closed()
            return

        is_tls = first_byte[0] == 0x16
        print('is_tls', is_tls)

        # SSL verification
    finally:
        pass


async def main():
    args = parse_args()
    # FIXME: hardcoded
    # Nope, asyncio.start_sever does only TLS and we need both...
    # ssl_ctx = create_ssl_context("/etc/cockpit/ws-certs.d/0-self-signed.cert",
    #                              "/etc/cockpit/ws-certs.d/0-self-signed.key")

    server = await asyncio.start_server(
        lambda r, w: handle_client(r, w),
        host="*",
        port=args.port,
    )

    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
