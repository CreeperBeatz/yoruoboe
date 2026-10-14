/* tslint:disable */
/* eslint-disable */
/**
 * The `ReadableStreamType` enum.
 *
 * *This API requires the following crate features to be activated: `ReadableStreamType`*
 */

export type ReadableStreamType = "bytes";

export class Engine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Run a backend method. Fails with an encoded BackendError.
     */
    command(service: number, method: number, input: Uint8Array): Uint8Array;
    /**
     * DB proxy commands (JSON in and out), as pylib's db_command.
     */
    dbCommand(input: Uint8Array): Uint8Array;
    fullUploadOrDownload(input: Uint8Array): Promise<any>;
    /**
     * `init` is an encoded BackendInit.
     */
    constructor(init: Uint8Array);
    syncCollection(input: Uint8Array): Promise<any>;
    syncLogin(input: Uint8Array): Promise<any>;
    syncStatus(input: Uint8Array): Promise<any>;
}

export class IntoUnderlyingByteSource {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    pull(controller: ReadableByteStreamController): Promise<any>;
    start(controller: ReadableByteStreamController): void;
    readonly autoAllocateChunkSize: number;
    readonly type: ReadableStreamType;
}

export class IntoUnderlyingSink {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    abort(reason: any): Promise<any>;
    close(): Promise<any>;
    write(chunk: any): Promise<any>;
}

export class IntoUnderlyingSource {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    pull(controller: ReadableStreamDefaultController): Promise<any>;
}

export function buildHash(): string;

/**
 * Set up storage for Anki's databases and files, kept under `directory`
 * (an OPFS folder, or an IndexedDB database). `mode` is "opfs", "idb", or
 * "auto" (OPFS if the browser supports it). Resolves with the store used.
 * Call once per worker, before anything else.
 */
export function initStorage(directory: string, mode: string): Promise<string>;

/**
 * Names of the files in a folder.
 */
export function listDir(path: string): string[];

/**
 * A file's contents, or undefined if it doesn't exist.
 */
export function readFile(path: string): Uint8Array | undefined;

export function removeFile(path: string): void;

/**
 * [size, modified ms] of a file, or undefined.
 */
export function statFile(path: string): Float64Array | undefined;

export function writeFile(path: string, data: Uint8Array): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_engine_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingbytesource_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingsink_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingsource_free: (a: number, b: number) => void;
    readonly buildHash: () => [number, number];
    readonly engine_command: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly engine_dbCommand: (a: number, b: number, c: number) => [number, number, number, number];
    readonly engine_fullUploadOrDownload: (a: number, b: number, c: number) => any;
    readonly engine_new: (a: number, b: number) => [number, number, number];
    readonly engine_syncCollection: (a: number, b: number, c: number) => any;
    readonly engine_syncLogin: (a: number, b: number, c: number) => any;
    readonly engine_syncStatus: (a: number, b: number, c: number) => any;
    readonly initStorage: (a: number, b: number, c: number, d: number) => any;
    readonly intounderlyingbytesource_autoAllocateChunkSize: (a: number) => number;
    readonly intounderlyingbytesource_cancel: (a: number) => void;
    readonly rust_zstd_wasm_shim_calloc: (a: number, b: number) => number;
    readonly rust_zstd_wasm_shim_free: (a: number) => void;
    readonly rust_zstd_wasm_shim_malloc: (a: number) => number;
    readonly rust_zstd_wasm_shim_memcmp: (a: number, b: number, c: number) => number;
    readonly rust_zstd_wasm_shim_memcpy: (a: number, b: number, c: number) => number;
    readonly rust_zstd_wasm_shim_memmove: (a: number, b: number, c: number) => number;
    readonly rust_zstd_wasm_shim_memset: (a: number, b: number, c: number) => number;
    readonly rust_zstd_wasm_shim_qsort: (a: number, b: number, c: number, d: number) => void;
    readonly intounderlyingbytesource_pull: (a: number, b: any) => any;
    readonly intounderlyingbytesource_start: (a: number, b: any) => void;
    readonly intounderlyingbytesource_type: (a: number) => number;
    readonly intounderlyingsink_abort: (a: number, b: any) => any;
    readonly intounderlyingsink_close: (a: number) => any;
    readonly intounderlyingsink_write: (a: number, b: any) => any;
    readonly intounderlyingsource_cancel: (a: number) => void;
    readonly intounderlyingsource_pull: (a: number, b: any) => any;
    readonly listDir: (a: number, b: number) => [number, number, number, number];
    readonly readFile: (a: number, b: number) => [number, number, number, number];
    readonly removeFile: (a: number, b: number) => [number, number];
    readonly statFile: (a: number, b: number) => [number, number];
    readonly writeFile: (a: number, b: number, c: number, d: number) => [number, number];
    readonly rust_sqlite_wasm_abort: () => void;
    readonly rust_sqlite_wasm_assert_fail: (a: number, b: number, c: number, d: number) => void;
    readonly rust_sqlite_wasm_calloc: (a: number, b: number) => number;
    readonly rust_sqlite_wasm_malloc: (a: number) => number;
    readonly rust_sqlite_wasm_free: (a: number) => void;
    readonly rust_sqlite_wasm_getentropy: (a: number, b: number) => number;
    readonly rust_sqlite_wasm_localtime: (a: number) => number;
    readonly rust_sqlite_wasm_realloc: (a: number, b: number) => number;
    readonly sqlite3_os_end: () => number;
    readonly sqlite3_os_init: () => number;
    readonly wasm_bindgen_5619f68a07c0393e___convert__closures_____invoke___js_sys_efac043650367c19___Function_fn_wasm_bindgen_5619f68a07c0393e___JsValue_____wasm_bindgen_5619f68a07c0393e___sys__Undefined___js_sys_efac043650367c19___Function_fn_wasm_bindgen_5619f68a07c0393e___JsValue_____wasm_bindgen_5619f68a07c0393e___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_5619f68a07c0393e___convert__closures_____invoke___wasm_bindgen_5619f68a07c0393e___JsValue__core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_5619f68a07c0393e___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_5619f68a07c0393e___convert__closures_____invoke___web_sys_ea89da5bca7c159d___features__gen_IdbVersionChangeEvent__IdbVersionChangeEvent__core_9b3796e30d99ddb7___result__Result_____wasm_bindgen_5619f68a07c0393e___JsValue___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_5619f68a07c0393e___convert__closures_____invoke___wasm_bindgen_5619f68a07c0393e___JsValue______true_: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_5619f68a07c0393e___convert__closures_____invoke___web_sys_ea89da5bca7c159d___features__gen_Event__Event______true_: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_5619f68a07c0393e___convert__closures_____invoke_______true_: (a: number, b: number) => void;
    readonly wasm_bindgen_5619f68a07c0393e___convert__closures_____invoke_______true__1_: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
