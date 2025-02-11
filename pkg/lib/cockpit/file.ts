/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2025 Red Hat, Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

'use strict';

import { join_data, StrOrBytes } from './_internal/common';
import { Channel, ChannelPayload, ChannelOptions, BaseChannelOptions } from './channel';

interface FileOptions extends BaseChannelOptions {
    binary?: false;
    max_read_size?: number;
}

// To be expanded further in the future
interface ReadOptions {
}

interface RemoveChannelOptions extends BaseChannelOptions {
    path?: string;
    tag?: string;
    binary?: false;
}

class RemoveChannel extends Channel<string> {
    constructor(options: RemoveChannelOptions) {
        super({ ...options, payload: 'fsreplace1' });
    }
}

type ReadChannelOptions<P extends ChannelPayload> = ChannelOptions<P> & {
    payload: string,
    path?: string;
    max_read_size?: number;
}

class ReadChannel<P extends ChannelPayload = string> extends Channel<P> {
    constructor(options: ReadChannelOptions<P>) {
        super({ ...options, payload: 'fsread1' });
    }
}

interface ReadData {
    data: StrOrBytes;
    tag: string;
}

// TODO: look test-channel.ts
export class File {
    filename: string;
    private options: FileOptions;

    constructor(filename: string, options: FileOptions = { max_read_size: 16 * 1024 * 1024 }) {
        this.filename = filename;
        this.options = options;
    }

    private get_options() {
        return {
            ...this.options,
            path: this.filename,
        };
    }

    async read(options?: ReadOptions): Promise<ReadData> {
        let channel;
        const opts = { ...this.get_options(), payload: 'fsread1' };
        const data: StrOrBytes[] = [];
        let binary = false;
        console.log(opts);

        // HACK: typefoolery, this is dumb
        if (opts.binary) {
            binary = true;
            channel = new ReadChannel<Uint8Array>({ ...opts, binary: true });
        } else {
            channel = new ReadChannel(opts);
        }

        channel.on('data', chunk => {
            console.log("chunk", chunk);
            data.push(chunk);
        });

        // ready
        await channel.wait();

        return new Promise((resolve, reject) => {
            channel.on('close', message => {
                if (message.problem) {
                    // TODO: BasicError
                    reject(message.problem);
                } else {
                    resolve({ tag: message.tag as string, data: join_data(data, binary) });
                }
            });
        });
    }

    async remove(tag?: string) {
        const options: RemoveChannelOptions = { ...this.get_options(), ...tag && { tag } };

        const channel = new RemoveChannel(options);
        await channel.wait();

        return new Promise((resolve, reject) => {
            channel.on('close', message => {
                if (message.problem) {
                    // TODO: BasicError
                    reject(message.problem);
                } else {
                    resolve(message.tag);
                }
            });

            channel.send_control({ command: 'done' });
        });
    }
}
