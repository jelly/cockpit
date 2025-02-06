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

import { Channel, ChannelPayload, ChannelOptions, BaseChannelOptions } from './channel';

interface FileOptions extends BaseChannelOptions {
    binary?: false;
    max_read_size?: number;
}

// To be expanded further in the future
interface ReadOptions {
}

interface RemoveChannelOptions extends BaseChannelOptions {
    tag?: string;
    binary?: false;
}

class RemoveChannel extends Channel<string> {
    constructor(options: RemoveChannelOptions) {
        super({ ...options, payload: 'fsreplace1' });
    }
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
            payload: "fsread1",
            path: this.filename,
        };
    }

    async read(options?: ReadOptions) {
        const channel = new Channel(this.get_options());
        await channel.wait();
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
