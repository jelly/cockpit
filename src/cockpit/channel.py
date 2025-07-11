# This file is part of Cockpit.
#
# Copyright (C) 2022 Red Hat, Inc.
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

import asyncio
import codecs
import json
import logging
import traceback
import typing
from typing import BinaryIO, Callable, ClassVar, Collection, Generator, Mapping, Sequence, Type

from .jsonutil import JsonError, JsonObject, JsonValue, create_object, get_bool, get_enum, get_str
from .protocol import CockpitProblem
from .router import Endpoint, Router, RoutingRule

logger = logging.getLogger(__name__)


if typing.TYPE_CHECKING:
    _T = typing.TypeVar('_T')
    _P = typing.ParamSpec("_P")


class ChannelRoutingRule(RoutingRule):
    table: 'dict[str, list[Type[Channel]]]'

    def __init__(self, router: Router, channel_types: 'Collection[Type[Channel]]'):
        super().__init__(router)
        self.table = {}

        # Sort the channels into buckets by payload type
        for cls in channel_types:
            entry = self.table.setdefault(cls.payload, [])
            entry.append(cls)

        # Within each bucket, sort the channels so those with more
        # restrictions are considered first.
        for entry in self.table.values():
            entry.sort(key=lambda cls: len(cls.restrictions), reverse=True)

    def capabilities(self) -> JsonObject:
        result: 'dict[str, list[str]]' = {}

        for payload, impls in self.table.items():
            caps: 'list[str]' = []
            for impl in impls:
                caps.extend(impl.capabilities)
            result[payload] = caps
        return result

    def check_restrictions(self, restrictions: 'Collection[tuple[str, object]]', options: JsonObject) -> bool:
        for key, expected_value in restrictions:
            our_value = options.get(key)

            # If the match rule specifies that a value must be present and
            # we don't have it, then fail.
            if our_value is None:
                return False

            # If the match rule specified a specific expected value, and
            # our value doesn't match it, then fail.
            if expected_value is not None and our_value != expected_value:
                return False

        # Everything checked out
        return True

    def apply_rule(self, options: JsonObject) -> 'Channel | None':
        assert self.router is not None

        payload = options.get('payload')
        if not isinstance(payload, str):
            return None

        for cls in self.table.get(payload, []):
            if self.check_restrictions(cls.restrictions, options):
                return cls(self.router)
        else:
            return None

    def shutdown(self) -> None:
        pass  # we don't hold any state


class ChannelError(CockpitProblem):
    pass


class Channel(Endpoint):
    # Values borrowed from C implementation
    BLOCK_SIZE = 16 * 1024
    SEND_WINDOW = 2 * 1024 * 1024

    # Flow control book-keeping
    _send_pings: bool = False
    _out_sequence: int = 0
    _out_window: int = SEND_WINDOW
    _ack_bytes: bool

    # Task management
    _tasks: 'set[asyncio.Task]'
    _close_args: 'JsonObject | None' = None

    # Must be filled in by the channel implementation
    payload: 'ClassVar[str]'
    restrictions: 'ClassVar[Sequence[tuple[str, object]]]' = ()
    capabilities: 'ClassVar[Sequence[str]]' = ()

    # These get filled in from .do_open()
    channel = ''
    group = ''
    is_binary: bool
    decoder: 'codecs.IncrementalDecoder | None'

    # input
    def do_control(self, command: str, message: JsonObject) -> None:
        # Break the various different kinds of control messages out into the
        # things that our subclass may be interested in handling.  We drop the
        # 'message' field for handlers that don't need it.
        if command == 'open':
            self._tasks = set()
            self.channel = get_str(message, 'channel')
            if get_bool(message, 'flow-control', default=False):
                self._send_pings = True
            self._ack_bytes = get_enum(message, 'send-acks', ['bytes'], None) is not None
            self.group = get_str(message, 'group', 'default')
            self.is_binary = get_enum(message, 'binary', ['raw'], None) is not None
            self.decoder = None
            self.freeze_endpoint()
            self.do_open(message)
        elif command == 'ready':
            self.do_ready()
        elif command == 'done':
            self.do_done()
        elif command == 'close':
            self.do_close()
        elif command == 'ping':
            self.do_ping(message)
        elif command == 'pong':
            self.do_pong(message)
        elif command == 'options':
            self.do_options(message)

    def do_channel_control(self, channel: str, command: str, message: JsonObject) -> None:
        # Already closing?  Ignore.
        if self._close_args is not None:
            return

        # Catch errors and turn them into close messages
        try:
            try:
                self.do_control(command, message)
            except JsonError as exc:
                raise ChannelError('protocol-error', message=str(exc)) from exc
        except ChannelError as exc:
            self.close(exc.get_attrs())

    def do_kill(self, host: 'str | None', group: 'str | None', _message: JsonObject) -> None:
        # Already closing?  Ignore.
        if self._close_args is not None:
            return

        if host is not None:
            return
        if group is not None and self.group != group:
            return
        self.do_close()

    # At least this one really ought to be implemented...
    def do_open(self, options: JsonObject) -> None:
        raise NotImplementedError

    # ... but many subclasses may reasonably want to ignore some of these.
    def do_ready(self) -> None:
        pass

    def do_done(self) -> None:
        pass

    def do_close(self) -> None:
        self.close()

    def do_options(self, message: JsonObject) -> None:
        raise ChannelError('not-supported', message='This channel does not implement "options"')

    # 'reasonable' default, overridden in other channels for receive-side flow control
    def do_ping(self, message: JsonObject) -> None:
        self.send_pong(message)

    def send_ack(self, data: bytes) -> None:
        if self._ack_bytes:
            self.send_control('ack', bytes=len(data))

    def do_channel_data(self, channel: str, data: bytes) -> None:
        # Already closing?  Ignore.
        if self._close_args is not None:
            return

        # Catch errors and turn them into close messages
        try:
            if not self.do_data(data):
                self.send_ack(data)
        except ChannelError as exc:
            self.close(exc.get_attrs())

    def do_data(self, data: bytes) -> 'bool | None':
        """Handles incoming data to the channel.

        Return value is True if the channel takes care of send acks on its own,
        in which case it should call self.send_ack() on `data` at some point.
        None or False means that the acknowledgement is sent automatically."""
        # By default, channels can't receive data.
        del data
        self.close()
        return True

    # output
    def ready(self, **kwargs: JsonValue) -> None:
        self.thaw_endpoint()
        self.send_control(command='ready', **kwargs)

    def __decode_frame(self, data: bytes, *, final: bool = False) -> str:
        assert self.decoder is not None
        try:
            return self.decoder.decode(data, final=final)
        except UnicodeDecodeError as exc:
            raise ChannelError('protocol-error', message=str(exc)) from exc

    def done(self) -> None:
        # any residue from partial send_data() frames? this is invalid, fail the channel
        if self.decoder is not None:
            self.__decode_frame(b'', final=True)
        self.send_control(command='done')

    # tasks and close management
    def is_closing(self) -> bool:
        return self._close_args is not None

    def _close_now(self) -> None:
        self.shutdown_endpoint(self._close_args)

    def _task_done(self, task):
        # Strictly speaking, we should read the result and check for exceptions but:
        #   - exceptions bubbling out of the task are programming errors
        #   - the only thing we'd do with it anyway, is to show it
        #   - Python already does that with its "Task exception was never retrieved" messages
        self._tasks.remove(task)
        if self._close_args is not None and not self._tasks:
            self._close_now()

    def create_task(self, coroutine, name=None):
        """Create a task associated with the channel.

        All tasks must exit before the channel can close.  You may not create
        new tasks after calling .close().
        """
        assert self._close_args is None
        task = asyncio.create_task(coroutine)
        self._tasks.add(task)
        task.add_done_callback(self._task_done)
        return task

    def close(self, close_args: 'JsonObject | None' = None) -> None:
        """Requests the channel to be closed.

        After you call this method, you won't get anymore `.do_*()` calls.

        This will wait for any running tasks to complete before sending the
        close message.
        """
        if self._close_args is not None:
            # close already requested
            return
        self._close_args = close_args or {}
        if not self._tasks:
            self._close_now()

    def send_bytes(self, data: bytes) -> bool:
        """Send binary data and handle book-keeping for flow control.

        The flow control is "advisory".  The data is sent immediately, even if
        it's larger than the window.  In general you should try to send packets
        which are approximately Channel.BLOCK_SIZE in size.

        Returns True if there is still room in the window, or False if you
        should stop writing for now.  In that case, `.do_resume_send()` will be
        called later when there is more room.

        Be careful with text channels (i.e. without binary="raw"): you are responsible
        for ensuring that @data is valid UTF-8. This isn't validated here for
        efficiency reasons.
        """
        self.send_channel_data(self.channel, data)

        if self._send_pings:
            out_sequence = self._out_sequence + len(data)
            if self._out_sequence // Channel.BLOCK_SIZE != out_sequence // Channel.BLOCK_SIZE:
                self.send_control(command='ping', sequence=out_sequence)
            self._out_sequence = out_sequence

        return self._out_sequence < self._out_window

    def send_data(self, data: bytes) -> bool:
        """Send data and transparently handle UTF-8 for text channels

        Use this for channels which can be text, but are not guaranteed to get
        valid UTF-8 frames -- i.e. multi-byte characters may be split across
        frames. This is expensive, so prefer send_text() or send_bytes() wherever
        possible.
        """
        if self.is_binary:
            return self.send_bytes(data)

        # for text channels we must avoid splitting UTF-8 multi-byte characters,
        # as these can't be sent to a WebSocket (and are often confusing for text streams as well)
        if self.decoder is None:
            self.decoder = codecs.getincrementaldecoder('utf-8')(errors='strict')
        return self.send_text(self.__decode_frame(data))

    def send_text(self, data: str) -> bool:
        """Send UTF-8 string data and handle book-keeping for flow control.

        Similar to `send_bytes`, but for text data.  The data is sent as UTF-8 encoded bytes.
        """
        return self.send_bytes(data.encode())

    def send_json(self, msg: 'JsonObject | None' = None, **kwargs: JsonValue) -> bool:
        pretty = self.json_encoder.encode(create_object(msg, kwargs)) + '\n'
        return self.send_text(pretty)

    def do_pong(self, message):
        if not self._send_pings:  # huh?
            logger.warning("Got wild pong on channel %s", self.channel)
            return

        self._out_window = message['sequence'] + Channel.SEND_WINDOW
        if self._out_sequence < self._out_window:
            self.do_resume_send()

    def do_resume_send(self) -> None:
        """Called to indicate that the channel may start sending again."""
        # change to `raise NotImplementedError` after everyone implements it

    json_encoder: 'ClassVar[json.JSONEncoder]' = json.JSONEncoder(indent=2)

    def send_control(self, command: str, **kwargs: JsonValue) -> None:
        self.send_channel_control(self.channel, command, None, **kwargs)

    def send_pong(self, message: JsonObject) -> None:
        self.send_channel_control(self.channel, 'pong', message)


class ProtocolChannel(Channel, asyncio.Protocol):
    """A channel subclass that implements the asyncio Protocol interface.

    In effect, data sent to this channel will be written to the connected
    transport, and vice-versa.  Flow control is supported.

    The default implementation of the .do_open() method calls the
    .create_transport() abstract method.  This method should return a transport
    which will be used for communication on the channel.

    Otherwise, if the subclass implements .do_open() itself, it is responsible
    for setting up the connection and ensuring that .connection_made() is called.
    """
    _transport: 'asyncio.Transport | None' = None
    _send_pongs: bool = True
    _last_ping: 'JsonObject | None' = None
    _create_transport_task: 'asyncio.Task[asyncio.Transport] | None' = None
    _ready_info: 'JsonObject | None' = None

    # read-side EOF handling
    _close_on_eof: bool = False
    _eof: bool = False

    async def create_transport(self, loop: asyncio.AbstractEventLoop, options: JsonObject) -> asyncio.Transport:
        """Creates the transport for this channel, according to options.

        The event loop for the transport is passed to the function.  The
        protocol for the transport is the channel object, itself (self).

        This needs to be implemented by the subclass.
        """
        raise NotImplementedError

    def do_open(self, options: JsonObject) -> None:
        loop = asyncio.get_running_loop()
        self._create_transport_task = asyncio.create_task(self.create_transport(loop, options))
        self._create_transport_task.add_done_callback(self.create_transport_done)

    def create_transport_done(self, task: 'asyncio.Task[asyncio.Transport]') -> None:
        assert task is self._create_transport_task
        self._create_transport_task = None
        try:
            transport = task.result()
        except ChannelError as exc:
            self.close(exc.get_attrs())
            return

        self.connection_made(transport)
        if self._ready_info is not None:
            self.ready(**self._ready_info)
        else:
            self.ready()

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        assert isinstance(transport, asyncio.Transport)
        self._transport = transport

    def _get_close_args(self) -> JsonObject:
        return {}

    def connection_lost(self, exc: 'Exception | None') -> None:
        self.close(self._get_close_args())

    def do_data(self, data: bytes) -> None:
        assert self._transport is not None
        self._transport.write(data)

    def do_done(self) -> None:
        assert self._transport is not None
        if self._transport.can_write_eof():
            self._transport.write_eof()

    def do_close(self) -> None:
        if self._transport is not None:
            self._transport.close()

    def data_received(self, data: bytes) -> None:
        assert self._transport is not None
        try:
            if not self.send_data(data):
                self._transport.pause_reading()
        except ChannelError as exc:
            self.close(exc.get_attrs())

    def do_resume_send(self) -> None:
        assert self._transport is not None
        self._transport.resume_reading()

    def close_on_eof(self) -> None:
        """Mark the channel to be closed on EOF.

        Normally, ProtocolChannel tries to keep the channel half-open after
        receiving EOF from the transport.  This instructs that the channel
        should be closed on EOF.

        If EOF was already received, then calling this function will close the
        channel immediately.

        If you don't call this function, you are responsible for closing the
        channel yourself.
        """
        self._close_on_eof = True
        if self._eof:
            assert self._transport is not None
            self._transport.close()

    def eof_received(self) -> bool:
        self._eof = True
        self.done()
        return not self._close_on_eof

    # Channel receive-side flow control
    def do_ping(self, message):
        if self._send_pongs:
            self.send_pong(message)
        else:
            # we'll have to pong later
            self._last_ping = message

    def pause_writing(self) -> None:
        # We can't actually stop writing, but we can stop replying to pings
        self._send_pongs = False

    def resume_writing(self) -> None:
        self._send_pongs = True
        if self._last_ping is not None:
            self.send_pong(self._last_ping)
            self._last_ping = None


class AsyncChannel(Channel):
    """A subclass for async/await-style implementation of channels, with flow control

    This subclass provides asynchronous `read()` and `write()` calls for
    subclasses, with familiar semantics.  `write()` doesn't buffer, so the
    `done()` method on the base channel class can be used in a way similar to
    `shutdown()`.  A high-level `sendfile()` method is available to send the
    entire contents of a binary-mode file-like object.

    The subclass must provide an async `run()` function, which will be spawned
    as a task.  The task is cancelled when the channel is closed.

    On the receiving side, the channel will respond to flow control pings to
    indicate that it has received the data, but only after it has been consumed
    by `read()`.

    On the sending side, write() will block if the channel backs up.
    """

    # Receive-side flow control: intermix pings and data in the queue and reply
    # to pings as we dequeue them.  EOF is None.  This is a buffer: since we
    # need to handle do_data() without blocking, we have no choice.
    receive_queue: 'asyncio.Queue[bytes | JsonObject | None]'
    loop: asyncio.AbstractEventLoop

    # Send-side flow control
    write_waiter = None

    async def run(self, options: JsonObject) -> 'JsonObject | None':
        raise NotImplementedError

    async def run_wrapper(self, options: JsonObject) -> None:
        try:
            self.loop = asyncio.get_running_loop()
            self.close(await self.run(options))
        except asyncio.CancelledError:  # user requested close
            self.close()
        except ChannelError as exc:
            self.close(exc.get_attrs())
        except JsonError as exc:
            self.close({'problem': 'protocol-error', 'message': str(exc)})
        except BaseException:
            self.close({'problem': 'internal-error', 'cause': traceback.format_exc()})
            raise

    async def read(self) -> 'bytes | None':
        # Three possibilities for what we'll find:
        #  - None (EOF) → return None
        #  - a ping → send a pong
        #  - bytes (possibly empty) → ack the receipt, and return it
        while True:
            item = await self.receive_queue.get()
            if item is None:
                return None
            if isinstance(item, Mapping):
                self.send_pong(item)
            else:
                self.send_ack(item)
                return item

    async def write(self, data: bytes) -> None:
        if not self.send_data(data):
            self.write_waiter = self.loop.create_future()
            await self.write_waiter

    async def in_thread(self, fn: 'Callable[_P, _T]', *args: '_P.args', **kwargs: '_P.kwargs') -> '_T':
        return await self.loop.run_in_executor(None, fn, *args, **kwargs)

    async def sendfile(self, stream: BinaryIO) -> None:
        with stream:
            while True:
                data = await self.loop.run_in_executor(None, stream.read, Channel.BLOCK_SIZE)
                if data == b'':
                    break
                await self.write(data)

            self.done()

    def do_resume_send(self) -> None:
        if self.write_waiter is not None:
            self.write_waiter.set_result(None)
            self.write_waiter = None

    def do_open(self, options: JsonObject) -> None:
        self.receive_queue = asyncio.Queue()
        self._run_task = self.create_task(self.run_wrapper(options),
                                          name=f'{self.__class__.__name__}.run_wrapper({options})')

    def do_done(self) -> None:
        self.receive_queue.put_nowait(None)

    def do_close(self) -> None:
        self._run_task.cancel()

    def do_ping(self, message: JsonObject) -> None:
        self.receive_queue.put_nowait(message)

    def do_data(self, data: bytes) -> bool:
        self.receive_queue.put_nowait(data)
        return True  # we will send the 'ack' later (from read())


class GeneratorChannel(Channel):
    """A trivial Channel subclass for sending data from a generator with flow control.

    Calls the .do_yield_data() generator with the options from the open message
    and sends the data which it yields.  If the generator returns a value it
    will be used for the close message.
    """
    __generator: 'Generator[bytes, None, JsonObject]'

    def do_yield_data(self, options: JsonObject) -> 'Generator[bytes, None, JsonObject]':
        raise NotImplementedError

    def do_open(self, options: JsonObject) -> None:
        self.__generator = self.do_yield_data(options)
        self.do_resume_send()

    def do_resume_send(self) -> None:
        try:
            while self.send_data(next(self.__generator)):
                pass
        except StopIteration as stop:
            self.done()
            self.close(stop.value)
