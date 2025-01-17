import type { MaybePromiseLike } from "@yume-chan/async";

import type {
    QueuingStrategy,
    ReadableStreamDefaultController,
    ReadableStreamDefaultReader,
} from "./stream.js";
import { ReadableStream } from "./stream.js";

export type WrapReadableStreamStart<T> = (
    controller: ReadableStreamDefaultController<T>,
) => MaybePromiseLike<ReadableStream<T>>;

export interface ReadableStreamWrapper<T> {
    start: WrapReadableStreamStart<T>;
    cancel?(reason?: unknown): MaybePromiseLike<void>;
    close?(): MaybePromiseLike<void>;
}

function getWrappedReadableStream<T>(
    wrapper:
        | ReadableStream<T>
        | WrapReadableStreamStart<T>
        | ReadableStreamWrapper<T>,
    controller: ReadableStreamDefaultController<T>,
) {
    if ("start" in wrapper) {
        return wrapper.start(controller);
    } else if (typeof wrapper === "function") {
        return wrapper(controller);
    } else {
        // Can't use `wrapper instanceof ReadableStream`
        // Because we want to be compatible with any ReadableStream-like objects
        return wrapper;
    }
}

/**
 * This class has multiple usages:
 *
 * 1. Get notified when the stream is cancelled or closed.
 * 2. Synchronously create a `ReadableStream` by asynchronously return another `ReadableStream`.
 * 3. Convert native `ReadableStream`s to polyfilled ones so they can `pipe` between.
 */
export class WrapReadableStream<T> extends ReadableStream<T> {
    readable!: ReadableStream<T>;

    #reader!: ReadableStreamDefaultReader<T>;

    constructor(
        wrapper:
            | ReadableStream<T>
            | WrapReadableStreamStart<T>
            | ReadableStreamWrapper<T>,
        strategy?: QueuingStrategy<T>,
    ) {
        super(
            {
                start: async (controller) => {
                    // `start` is invoked before `ReadableStream`'s constructor finish,
                    // so using `this` synchronously causes
                    // "Must call super constructor in derived class before accessing 'this' or returning from derived constructor".
                    // Queue a microtask to avoid this.
                    await Promise.resolve();

                    this.readable = await getWrappedReadableStream(
                        wrapper,
                        controller,
                    );
                    this.#reader = this.readable.getReader();
                },
                pull: async (controller) => {
                    const result = await this.#reader.read();
                    if (result.done) {
                        controller.close();
                        if ("close" in wrapper) {
                            await wrapper.close?.();
                        }
                    } else {
                        controller.enqueue(result.value);
                    }
                },
                cancel: async (reason) => {
                    await this.#reader.cancel(reason);
                    if ("cancel" in wrapper) {
                        await wrapper.cancel?.(reason);
                    }
                },
            },
            strategy,
        );
    }
}
