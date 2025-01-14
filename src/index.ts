import hrtime from "browser-process-hrtime";
import { EventEmitter } from "events";
import * as mathjs from "mathjs";
import { FOOTER, HEADER } from "./etc";
import { JestReporter, KarmaReporter, MochaReporter } from "./reporters";

export { JestReporter, KarmaReporter, MochaReporter };

export declare interface BenchmarkEventEmitter {
    emit(event: "record", description: Array<string>, measurement: Measurement): boolean;
    on(event: "record", listener: (description: Array<string>, measurement: Measurement) => void): this;
    once(event: "record", listener: (description: Array<string>, measurement: Measurement) => void): this;
}

export class BenchmarkEventEmitter extends EventEmitter { }

/**
 * Base error for benchmark failures, such as a function taking too long
 * to execute.
 */
export class PerformanceError extends Error {
    constructor(message?: string) {
        super(message);
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * Performance measurement result from running a benchmark.
 */
export class Measurement {
    /**
     *
     * @param durations - Durations measured, in milliseconds.
     *     The list must not be empty.
     */
    constructor(public durations: Array<number>) {
        if (durations.length === 0) {
            throw new Error("The list of durations must not be empty");
        }
    }

    /**
     * Mean of all durations measured, in milliseconds.
     */
    get mean(): number {
        return mathjs.mean(this.durations);
    }

    /**
     * Minimum duration measured, in milliseconds.
     */
    get min(): number {
        return mathjs.min(this.durations);
    }

    /**
     * Maximum duration measured, in milliseconds.
     */
    get max(): number {
        return mathjs.max(this.durations);
    }

    /**
     * Standard deviation of all durations measured, in milliseconds.
     */
    get standardDeviation(): number {
        return mathjs.std(this.durations);
    }

    /**
     * Margin of error at 95% confidence level, in milliseconds.
     */
    get marginOfError(): number {
        return mathjs.sqrt(mathjs.variance(this.durations) / this.durations.length) * 1.96;
    }
}

/**
 * Options for Benchmark.measure().
 */
export interface MeasureOptions {
    /**
     * The number of times to call the function and measure its duration.
     * @default 100
     */
    iterations: number;

    /**
     * Whether to wait for each iteration to finish before starting the next.
     * @default true
     */
    serial: boolean;

    /**
     * If the mean measured duration exceeds this many milliseconds,
     * throw a [[PerformanceError]].
     */
    meanUnder?: number;

    /**
     * If the minimum measured duration exceeds this many milliseconds,
     * throw a [[PerformanceError]].
     */
    minUnder?: number;

    /**
     * If the maximum measured duration exceeds this many milliseconds,
     * throw a [[PerformanceError]].
     */
    maxUnder?: number;

    /**
     * If the margin of error at 95% confidence level exceeds this many milliseconds,
     * throw a [[PerformanceError]].
     */
    marginOfErrorUnder?: number;

    /**
     * If the standard deviation of all durations measured exceeds this many milliseconds,
     * throw a [[PerformanceError]].
     */
    standardDeviationUnder?: number;

    /**
     * Callback to invoke before each iteration.
     */
    beforeEach?: () => any;

    /**
     * Callback to invoke after each iteration.
     */
    afterEach?: () => any;

    /**
     * Whether to make use of the options like `meanUnder` and `minUnder`.
     * @default true
     */
    verify: boolean;
}

/**
 * Default options for Benchmark.measure().
 */
const defaultMeasureOptions: MeasureOptions = {
    iterations: 100,
    serial: true,
    verify: true,
};

/**
 * Raw data collected from [[Benchmark.record]].
 */
export interface BenchmarkData {
    /**
     * Description passed to [[Benchmark.record]].
     */
    [description: string]: {
        /**
         * Durations of all measured iterations, in milliseconds.
         */
        durations: Array<number>,

        /**
         * Nested test data, such as when passing `["A", "B"]` as the
         * description to [[Benchmark.record]].
         */
        children: BenchmarkData,
    };
}

async function maybePromise(fn: () => any): Promise<void> {
    const ret = fn();
    if (ret instanceof Promise) {
        await ret;
    }
}

function round(value: number, places: number = 5): number {
    return mathjs.round(value, places) as number;
}

/**
 * Measure the time it takes for a function to execute.
 *
 * @param fn - Function to measure.
 * @param options - Options to customize the measurement.
 */
export async function measure(fn: () => any, options: Partial<MeasureOptions> = {}): Promise<Measurement> {
    const mergedOptions = { ...defaultMeasureOptions, ...options };
    const durations: Array<number> = [];
    let calls: Array<Function> = [];

    for (let i = 0; i < mergedOptions.iterations; i++) {
        calls.push(async () => {
            if (mergedOptions.beforeEach !== undefined) {
                await maybePromise(mergedOptions.beforeEach);
            }

            const startTime = hrtime();
            await maybePromise(fn);
            const [durationSec, durationNano] = hrtime(startTime);
            durations.push(durationSec * 1e3 + durationNano / 1e6);

            if (mergedOptions.afterEach !== undefined) {
                await maybePromise(mergedOptions.afterEach);
            }
        });
    }

    if (mergedOptions.serial) {
        for (const call of calls) {
            await call();
        }
    } else {
        await Promise.all(calls.map(x => x()));
    }

    const measurement = new Measurement(durations);
    verifyMeasurement(measurement, mergedOptions);
    return measurement;
}

function verifyMeasurement(measurement: Measurement, options: MeasureOptions): void {
    if (!options.verify) {
        return;
    }
    if (options.meanUnder !== undefined) {
        if (measurement.mean > options.meanUnder) {
            throw new PerformanceError(`Mean time of ${measurement.mean} ms exceeded threshold of ${options.meanUnder} ms`);
        }
    }
    if (options.minUnder !== undefined) {
        if (measurement.min > options.minUnder) {
            throw new PerformanceError(`Minimum time of ${measurement.min} ms exceeded threshold of ${options.minUnder} ms`);
        }
    }
    if (options.maxUnder !== undefined) {
        if (measurement.max > options.maxUnder) {
            throw new PerformanceError(`Maximum time of ${measurement.max} ms exceeded threshold of ${options.maxUnder} ms`);
        }
    }
    if (options.marginOfErrorUnder !== undefined) {
        if (measurement.marginOfError > options.marginOfErrorUnder) {
            throw new PerformanceError(`Margin of error time of ${measurement.marginOfError} ms exceeded threshold of ${options.marginOfErrorUnder} ms`);
        }
    }
    if (options.standardDeviationUnder !== undefined) {
        if (measurement.standardDeviation > options.standardDeviationUnder) {
            throw new PerformanceError(`Standard deviation time of ${measurement.standardDeviation} ms exceeded threshold of ${options.standardDeviationUnder} ms`);
        }
    }
}

/**
 * Aggregator for performance results of various tests.
 */
export class Benchmark {
    /**
     * Raw data collected from [[Benchmark.record]].
     */
    data: BenchmarkData = {};

    /**
     * Event emitter.
     *
     * * `record` is emitted after [[Benchmark.record]] finishes all iterations.
     *
     * Refer to [[BenchmarkEventEmitter.on]] for the event callback signatures.
     */
    events: BenchmarkEventEmitter = new BenchmarkEventEmitter();

    /**
     * Measure the time it takes for a function to execute.
     * In addition to returning the measurement itself, this method also
     * stores the result in [[Benchmark.data]] for later use/reporting.
     *
     * With this overload, since no description is provided, the data will not
     * be recorded directly. However, a `record` event will still be emitted,
     * allowing any listeners (such as reporters) to act on it.
     *
     * @param fn - Function to measure. If it returns a promise,
     *     then it will be `await`ed automatically as part of the iteration.
     * @param options - Options to customize the measurement.
     */
    async record(fn: () => any, options?: Partial<Omit<MeasureOptions, "verify">>): Promise<Measurement>;
    /**
     * Measure the time it takes for a function to execute.
     * In addition to returning the measurement itself, this method also
     * stores the result in [[Benchmark.data]] for later use/reporting,
     * and [[Benchmark.events]] emits a `record` event for any listeners.
     *
     * @param description - Name of what is being tested.
     *     This can be a series of names for nested categories.
     *     Must not be empty.
     * @param fn - Function to measure. If it returns a promise,
     *     then it will be `await`ed automatically as part of the iteration.
     * @param options - Options to customize the measurement.
     */
    async record(description: string | Array<string>, fn: () => any, options?: Partial<Omit<MeasureOptions, "verify">>): Promise<Measurement>;
    async record(a: any, b: any, c?: any): Promise<Measurement> {
        let description: string | Array<string>;
        let descriptionSpecified = false;
        let fn: () => any;
        let options: Partial<MeasureOptions>;

        if (typeof a === "function") {
            description = [];
            fn = a;
            options = b || {};
        } else {
            description = a;
            descriptionSpecified = true;
            fn = b;
            options = c || {};
        }

        const mergedOptions = { ...defaultMeasureOptions, ...options };

        if ((descriptionSpecified && description.length === 0)) {
            throw new Error("The description must not be empty");
        }
        if (typeof description === "string") {
            description = [description];
        }

        const measurement = await measure(fn, { ...mergedOptions, verify: false });

        if (description.length > 0) {
            this.incorporate(description, measurement);
        }
        this.events.emit("record", description, measurement);
        verifyMeasurement(measurement, { ...mergedOptions, verify: true });
        return measurement;
    }

    /**
     * Add a measurement directly to [[Benchmark.data]].
     *
     * @param description - Name of what is being tested.
     *     Must not be empty.
     * @param measurement - Measurement to add to the benchmark data.
     */
    incorporate(description: Array<string>, measurement: Measurement): void {
        if ((description.length === 0)) {
            throw new Error("The description must not be empty");
        }
        this.addBenchmarkDurations(this.data, description, measurement.durations);
    }

    private addBenchmarkDurations(data: BenchmarkData, categories: Array<string>, durations: Array<number>): void {
        if (!(categories[0] in data)) {
            data[categories[0]] = { durations: [], children: {} };
        }

        if (categories.length === 1) {
            data[categories[0]].durations = data[categories[0]].durations.concat(durations);
        } else {
            this.addBenchmarkDurations(data[categories[0]].children, categories.slice(1), durations);
        }
    }

    private reportLevel(level: BenchmarkData, depth: number): Array<string> {
        let lines: Array<string> = [];
        for (const [description, info] of Object.entries(level)) {
            const showMeasurement = info.durations.length > 0;
            const showChildren = Object.keys(info.children).length > 0;
            lines.push(`${"  ".repeat(depth)}${description}:`);
            if (showMeasurement) {
                const measurement = new Measurement(info.durations);
                const mean = round(measurement.mean);
                const moe = round(measurement.marginOfError);
                const iterations = measurement.durations.length;
                lines.push(`${"  ".repeat(depth + 1)}${mean} ms (+/- ${moe} ms) from ${iterations} iterations`);
            }
            if (showMeasurement && showChildren) {
                lines.push("");
            }
            if (showChildren) {
                lines = lines.concat(this.reportLevel(info.children, depth + 1));
            }
        }
        return lines;
    }

    /**
     * Create a report of all the benchmark results.
     */
    report(): string {
        const lines = this.reportLevel(this.data, 0);
        if (lines.length === 0) {
            return "";
        } else {
            return [HEADER, ...this.reportLevel(this.data, 0), FOOTER].join("\n");
        }
    }
}

/**
 * Default [[Benchmark]] instance for shared usage throughout your tests.
 * Each instance stores its own state from measurement results, so if you
 * want to avoid global state, you can create additional instances as well.
 */
export const benchmark = new Benchmark();
