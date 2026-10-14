# Source before building the engine: Rust, and clang for the C parts (SQLite, zstd).
# Tools on the PATH are used; otherwise the ones scratch/tools holds (downloaded there
# while developing: LLVM in scratch/tools/llvm, wasm-bindgen in scratch/tools/wb).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$PATH:$ROOT/scratch/tools/llvm/bin:$ROOT/scratch/tools/wb"
export CC_wasm32_unknown_unknown="${CC_wasm32_unknown_unknown:-clang}"
export AR_wasm32_unknown_unknown="${AR_wasm32_unknown_unknown:-llvm-ar}"
